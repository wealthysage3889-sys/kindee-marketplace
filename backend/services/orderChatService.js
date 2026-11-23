import { supabaseAdmin } from '../config/supabase.js';
import { getOrCreateConversation, sendMessage } from './chatService.js';

// Order-to-Chat integration.
//
// When a customer completes an order (COD at creation, KBZPay after the slip is
// submitted successfully) we post a summary message into the 1:1 conversation
// between that customer and the store that fulfils the order. Each store_order
// is posted only into its own store's conversation, so a multi-store checkout
// never leaks one store's items into another store's chat.
//
// Design guarantees:
//   * Idempotent: every message carries a deterministic client_message_id
//     derived from (store_order_id, event, status). chatService.sendMessage
//     enforces uniqueness via ux_messages_client_id and returns the existing
//     row on a retry, so retries/refreshes/socket replays never duplicate.
//   * Non-fatal: orderChat never throws into the order/payment flow. A failure
//     to post is logged and swallowed so it can never block or roll back an
//     order or a payment. A later successful call (or the status-sync hook)
//     re-posts the same idempotent message.
//   * Store-isolated: the conversation is resolved per store_order via
//     getOrCreateConversation(customerId, storeId, storeOrderId), and only that
//     store's items/totals are read for the message.
//   * Access-safe: sendMessage verifies the sender is a conversation member.
//     We post as the customer (who performed the action); both the customer and
//     the store owner are members, so both see the same message.

// Message types already defined by the schema (message_type enum).
const ORDER_MESSAGE_TYPE = 'order_update';

// Build the deterministic idempotency key for one order-chat message. Keeping
// status in the key means a status change (e.g. pending -> confirmed) produces a
// new, separate card while a retry of the same state collapses to one message.
const buildClientMessageId = (storeOrderId, event, status) =>
  `order-chat:${storeOrderId}:${event}:${status || 'na'}`;

// Format a Thai-baht amount for display without pulling in extra deps.
const formatTHB = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '฿0.00';
  return `฿${n.toFixed(2)}`;
};

// Human-readable labels for order + payment statuses (Thai, matching the UI).
const ORDER_STATUS_LABELS = {
  pending: 'รอร้านค้ายืนยัน',
  confirmed: 'ร้านค้ายืนยันแล้ว',
  preparing: 'กำลังเตรียมสินค้า',
  ready_for_pickup: 'พร้อมรับสินค้า',
  picked_up: 'รับสินค้าแล้ว',
  in_transit: 'กำลังจัดส่ง',
  delivered: 'จัดส่งสำเร็จ',
  cancelled: 'ยกเลิก',
  refunded: 'คืนเงิน',
  failed: 'จัดส่งไม่สำเร็จ',
};

const PAYMENT_STATUS_LABELS = {
  pending: 'รอชำระเงิน',
  awaiting_review: 'รอตรวจสอบสลิป',
  paid: 'ชำระแล้ว',
  failed: 'ชำระเงินไม่สำเร็จ',
  refunded: 'คืนเงินแล้ว',
  partially_refunded: 'คืนเงินบางส่วน',
};

const PAYMENT_METHOD_LABELS = {
  cod: 'เก็บเงินปลายทาง (COD)',
  kbzpay: 'KBZPay',
  transfer: 'โอนเงิน',
  promptpay: 'พร้อมเพย์',
  card: 'บัตรเครดิต/เดบิต',
  wallet: 'กระเป๋าเงิน',
};

const orderStatusLabel = (s) => ORDER_STATUS_LABELS[s] || s || '-';
const paymentStatusLabel = (s) => PAYMENT_STATUS_LABELS[s] || s || '-';
const paymentMethodLabel = (m) => PAYMENT_METHOD_LABELS[m] || m || '-';

// Build a plain-text summary body. The frontend renders the rich card from
// metadata; this content is the accessible fallback (and what notifications use).
const buildSummaryText = ({ storeOrderNumber, items, total, shippingFee, paymentMethod, orderStatus, paymentStatus }) => {
  const itemLines = items
    .map((it) => `• ${it.product_name} × ${it.quantity}`)
    .join('\n');
  const lines = [
    `คำสั่งซื้อ #${storeOrderNumber}`,
    itemLines,
    `ยอดรวม: ${formatTHB(total)} (ค่าจัดส่ง ${formatTHB(shippingFee)})`,
    `ชำระเงิน: ${paymentMethodLabel(paymentMethod)}`,
    `สถานะ: ${orderStatusLabel(orderStatus)} • ${paymentStatusLabel(paymentStatus)}`,
  ].filter(Boolean);
  return lines.join('\n');
};

// Event labels shown as the card headline.
const EVENT_HEADLINES = {
  order_created: 'คำสั่งซื้อใหม่',
  slip_submitted: 'แนบสลิปการชำระเงินแล้ว',
  status_updated: 'อัปเดตสถานะคำสั่งซื้อ',
  payment_confirmed: 'ยืนยันการชำระเงินแล้ว',
  payment_rejected: 'สลิปการชำระเงินถูกปฏิเสธ',
};

// Load exactly the data needed to render one store_order's order-chat card,
// scoped to a single store so multi-store orders never mix data. Returns null
// when the store_order does not belong to the given store (caller skips).
const loadStoreOrderForChat = async (storeOrderId, storeId) => {
  const { data, error } = await supabaseAdmin
    .from('store_orders')
    .select(`
      id,
      store_order_number,
      status,
      subtotal,
      shipping_fee,
      tax_amount,
      total_amount,
      parent_order_id,
      store_id,
      store_snapshot,
      store:stores!store_id(id, name, owner_id),
      order_items:order_items(product_name, quantity, total_price),
      parent_order:orders!parent_order_id(
        id,
        order_number,
        status,
        payment_status,
        payment_method,
        total_amount,
        created_at
      )
    `)
    .eq('id', storeOrderId)
    .single();

  if (error || !data) return null;

  // Multi-store isolation: if a storeId was provided, refuse to build a card
  // for a store_order that belongs to a different store.
  const soStoreId = data.store_id || data.store?.id || null;
  if (storeId && soStoreId && String(soStoreId) !== String(storeId)) {
    return null;
  }

  return data;
};

// Core poster. Posts one order_update card for a single store_order into that
// store's customer<->store conversation. Never throws.
//
//   storeOrderId  - store_orders.id (the per-store slice of the order)
//   customerId    - the customer who owns the order
//   storeId       - the store this store_order belongs to (isolation guard)
//   event         - one of EVENT_HEADLINES keys
//   forceStatus   - optional status override for the card (defaults to the
//                   store_order status)
const postStoreOrderChat = async ({ storeOrderId, customerId, storeId, event = 'order_created', forceStatus }) => {
  try {
    if (!storeOrderId || !customerId) return null;

    const so = await loadStoreOrderForChat(storeOrderId, storeId);
    if (!so) {
      // Store order missing or not owned by this store: nothing to post.
      return null;
    }

    const store = so.store || {};
    const ownerId = store.owner_id || null;
    // Without an owner there is no one to converse with; skip rather than
    // create a memberless conversation.
    if (!ownerId) return null;

    // Resolve (or create) the customer<->store conversation for THIS store.
    // storeOrderId links the conversation to the specific order slice.
    const conversation = await getOrCreateConversation(customerId, so.store_id, storeOrderId);
    if (!conversation || !conversation.id) return null;

    const orderStatus = forceStatus || so.status;
    const parent = so.parent_order || {};
    const paymentStatus = parent.payment_status || 'pending';
    const paymentMethod = parent.payment_method || 'cod';
    const items = Array.isArray(so.order_items) ? so.order_items : [];
    const total = so.total_amount ?? parent.total_amount ?? 0;
    const shippingFee = so.shipping_fee ?? 0;

    const headline = EVENT_HEADLINES[event] || EVENT_HEADLINES.status_updated;
    const content = buildSummaryText({
      storeOrderNumber: so.store_order_number,
      items,
      total,
      shippingFee,
      paymentMethod,
      orderStatus,
      paymentStatus,
    });

    // Rich card payload consumed by the frontend ChatRoom order_update renderer.
    const metadata = {
      kind: 'order_chat',
      event,
      headline,
      order_id: parent.id || null,
      order_number: parent.order_number || null,
      store_order_id: so.id,
      store_order_number: so.store_order_number,
      store_id: so.store_id || storeId || null,
      store_name: store.name || so.store_snapshot?.name || null,
      items: items.map((it) => ({
        product_name: it.product_name,
        quantity: it.quantity,
        total_price: it.total_price,
      })),
      subtotal: so.subtotal ?? null,
      shipping_fee: shippingFee,
      tax_amount: so.tax_amount ?? null,
      total_amount: total,
      payment_method: paymentMethod,
      payment_method_label: paymentMethodLabel(paymentMethod),
      order_status: orderStatus,
      order_status_label: orderStatusLabel(orderStatus),
      payment_status: paymentStatus,
      payment_status_label: paymentStatusLabel(paymentStatus),
      ordered_at: parent.created_at || null,
      // Frontend deep link to the order detail page.
      order_url: parent.id ? `/orders/${parent.id}` : null,
    };

    const clientMessageId = buildClientMessageId(storeOrderId, event, orderStatus);

    // Post as the customer: they performed the action, and both parties are
    // members so both see the same message. sendMessage is idempotent on
    // client_message_id, so retries collapse to a single message.
    const message = await sendMessage(conversation.id, customerId, {
      type: ORDER_MESSAGE_TYPE,
      content,
      metadata,
      client_message_id: clientMessageId,
    });

    return message;
  } catch (error) {
    // Never let chat posting break order creation or payment. The idempotent
    // key means a later retry/status-sync re-posts the same card safely.
    console.error('[orderChat] failed to post order message:', {
      storeOrderId,
      customerId,
      storeId,
      event,
      error: error?.message || String(error),
    });
    return null;
  }
};

// Public: post an order-chat card for EVERY store_order of a parent order.
// Each store_order goes only into its own store's conversation. Returns the
// list of created/returned messages (best-effort; failures are swallowed).
//
// When `storeId` is provided, only that store's store_order(s) are posted — used
// by the payment-slip approve/reject hooks so a multi-store order never posts
// one store's card into another store's chat.
//
// Used after COD order creation and after a successful KBZPay slip submission.
export const sendOrderChatForOrder = async (orderId, { event = 'order_created', storeId = null } = {}) => {
  const results = [];
  try {
    if (!orderId) return results;

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, customer_id, store_orders:store_orders(id, store_id)')
      .eq('id', orderId)
      .single();

    if (error || !order) return results;

    const customerId = order.customer_id;
    const storeOrders = Array.isArray(order.store_orders) ? order.store_orders : [];

    for (const so of storeOrders) {
      if (storeId && String(so.store_id) !== String(storeId)) continue;
      const msg = await postStoreOrderChat({
        storeOrderId: so.id,
        customerId,
        storeId: so.store_id,
        event,
      });
      if (msg) results.push(msg);
    }
  } catch (error) {
    console.error('[orderChat] sendOrderChatForOrder failed:', error?.message || String(error));
  }
  return results;
};

// Public: post an order-chat card for a SINGLE store_order. Used when a store
// order status changes so the card in that store's chat reflects the new status.
export const sendOrderChatForStoreOrder = async (storeOrderId, { event = 'status_updated' } = {}) => {
  try {
    if (!storeOrderId) return null;

    const { data: so, error } = await supabaseAdmin
      .from('store_orders')
      .select('id, store_id, parent_order_id, parent_order:orders!parent_order_id(customer_id)')
      .eq('id', storeOrderId)
      .single();

    if (error || !so) return null;

    const customerId = so.parent_order?.customer_id || null;
    if (!customerId) return null;

    return await postStoreOrderChat({
      storeOrderId: so.id,
      customerId,
      storeId: so.store_id,
      event,
    });
  } catch (error) {
    console.error('[orderChat] sendOrderChatForStoreOrder failed:', error?.message || String(error));
    return null;
  }
};