import { supabaseAdmin } from '../config/supabase.js';
import { normalizeStoragePath, getSignedUrl } from '../middleware/upload.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { resolveEffectivePrice, roundMoney } from '../utils/productPricing.js';
import { emitNewOrder, emitOrderUpdate, emitToStore, emitToUser, emitNotification } from './socketService.js';
import { createSystemNotification } from './notificationService.js';
import { sendOrderChatForOrder, sendOrderChatForStoreOrder } from './orderChatService.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { v4 as uuidv4 } from 'uuid';

// Price charged for one unit. Rules live in utils/productPricing.js so the
// product forms and the checkout can never disagree.
//   NULL/undefined -> regular price, 0 -> regular price (legacy rows are never
//   turned into free items), 0 < d < price -> discount price.
export const calculateEffectivePrice = (price, discountPrice) =>
  resolveEffectivePrice(price, discountPrice);

const MAX_QUANTITY = 9999;

// Minimum interval between inline expired-reservation cleanups. The cleanup RPC
// is an unbounded per-row loop (meant for cron); throttle it so order creation
// does not scan the whole backlog on every request.
const RESERVATION_CLEANUP_INTERVAL_MS = 60 * 1000;
let lastReservationCleanupAt = 0;

// VAT default (7%) used only when the `vat_rate` setting has not been configured yet.
const VAT_DEFAULT_RATE = 7;

// Read the configured VAT rate (percent) from the settings table.
// Falls back to the default when unset or invalid. This is the single source of
// truth for VAT — frontend must never dictate the rate.
const getVatRate = async () => {
  const { data: setting } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'vat_rate')
    .maybeSingle();

  if (!setting || setting.value === null || setting.value === undefined) {
    return VAT_DEFAULT_RATE;
  }

  const rate = Number(setting.value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return VAT_DEFAULT_RATE;
  }

  return rate;
};

// Read the configured customer wallet toggle (boolean) from the settings table.
// Defaults to false (disabled) when unset or invalid — safe default that does not
// touch any existing wallet balances or transaction history.
const getCustomerWalletEnabled = async () => {
  const { data: setting } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'customer_wallet_enabled')
    .maybeSingle();

  if (!setting || setting.value === null || setting.value === undefined) {
    return false;
  }

  const raw = setting.value;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw === 'true' || raw === '1';
  return Boolean(raw);
};

// Resolve every line from the database. Only product_id and quantity are ever
// read from the client, so a tampered price in the request body can never lower
// the amount charged. Used by both the checkout preview and order creation so
// the confirmed total and the stored total always agree.
const buildOrderPlan = async (items) => {
  if (!items || items.length === 0) {
    throw new ValidationError('Order must have at least one item');
  }

  // Best-effort cleanup of expired stock reservations. This RPC is an unbounded
  // per-row loop meant to run via cron; running it inline on every order creation
  // would scan the whole backlog and take product row locks under load. Throttle
  // it to run at most once per interval per process and never fail the order if
  // it errors.
  const now = Date.now();
  if (now - lastReservationCleanupAt >= RESERVATION_CLEANUP_INTERVAL_MS) {
    lastReservationCleanupAt = now;
    try {
      await supabaseAdmin.rpc('cleanup_expired_reservations');
    } catch (cleanupError) {
      console.error('cleanup_expired_reservations failed:', cleanupError?.message || cleanupError);
    }
  }

  const itemsByStore = {};
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new ValidationError(`Invalid quantity for product ${item.product_id}`);
    }

    const { data: product } = await supabaseAdmin
      .from('products')
      .select('id, store_id, name, price, discount_price, stock, reserved_stock, images, is_active')
      .eq('id', item.product_id)
      .single();

    if (!product) {
      throw new NotFoundError(`Product ${item.product_id}`);
    }

    if (!product.is_active) {
      throw new ValidationError(`Product ${product.name} is not available`);
    }

    const availableStock = (product.stock || 0) - (product.reserved_stock || 0);
    if (availableStock < quantity) {
      throw new ValidationError(`Insufficient stock for ${product.name} (available: ${availableStock})`);
    }

    // Never price an item at 0. A zero total cannot be paid (payments.amount
    // requires > 0) and would leave a pending order holding reserved stock.
    const unitPrice = roundMoney(calculateEffectivePrice(product.price, product.discount_price));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new ValidationError(
        `Product ${product.name} has an invalid price (${product.price}) and cannot be ordered`
      );
    }

    const storeId = product.store_id;
    if (!itemsByStore[storeId]) {
      itemsByStore[storeId] = [];
    }
    itemsByStore[storeId].push({ ...item, quantity, unitPrice, product });
  }

  const storeOrdersData = [];
  let totalSubtotal = 0;
  let totalShippingFee = 0;
  let totalTax = 0;

  // Fetch the VAT rate once so every store order in the same parent order uses
  // an identical rate (frontend must not supply its own rate).
  const vatRate = await getVatRate();

  for (const [storeId, storeItems] of Object.entries(itemsByStore)) {
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id, name, address, phone, delivery_fee, minimum_order, estimated_delivery_time, delivery_type')
      .eq('id', storeId)
      .single();

    if (!store) {
      throw new NotFoundError(`Store ${storeId}`);
    }

    // Check minimum order
    const storeSubtotal = roundMoney(storeItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    ));

    if (store.minimum_order && storeSubtotal < store.minimum_order) {
      throw new ValidationError(`Minimum order for ${store.name} is ${store.minimum_order}`);
    }

    const shippingFee = roundMoney(store.delivery_fee || 0);
    const taxAmount = roundMoney(storeSubtotal * (vatRate / 100)); // VAT per admin-configured rate

    totalSubtotal = roundMoney(totalSubtotal + storeSubtotal);
    totalShippingFee = roundMoney(totalShippingFee + shippingFee);
    totalTax = roundMoney(totalTax + taxAmount);

    storeOrdersData.push({
      store_id: storeId,
      store,
      items: storeItems,
      subtotal: storeSubtotal,
      shipping_fee: shippingFee,
      tax_amount: taxAmount,
      vat_rate: vatRate,
      total_amount: roundMoney(storeSubtotal + shippingFee + taxAmount),
      delivery_type: store.delivery_type,
      estimated_delivery_time: store.estimated_delivery_time
    });
  }

  const discountAmount = 0; // TODO: Apply coupons
  const totalAmount = roundMoney(totalSubtotal + totalShippingFee + totalTax - discountAmount);

  // A zero (or negative) total cannot be paid: payments.amount is CHECK (amount > 0).
  // Reject before anything is written so no order row and no stock reservation is
  // left behind for an order that could never be completed.
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new ValidationError(
      'Order total must be greater than 0. This usually means a product is priced at 0.'
    );
  }

  return {
    storeOrdersData,
    subtotal: totalSubtotal,
    shippingFee: totalShippingFee,
    taxAmount: totalTax,
    discountAmount,
    totalAmount,
    vatRate
  };
};

// Server-verified checkout preview. The frontend must show these values, not
// its own localStorage cart totals, so a stale price or stock change is caught
// before the customer confirms.
export const quoteOrder = async (items) => {
  const plan = await buildOrderPlan(items);

  return {
    stores: plan.storeOrdersData.map((storeOrder) => ({
      storeId: storeOrder.store_id,
      storeName: storeOrder.store.name,
      storeLogo: storeOrder.store.logo_url || null,
      subtotal: storeOrder.subtotal,
      shippingFee: storeOrder.shipping_fee,
      taxAmount: storeOrder.tax_amount,
      totalAmount: storeOrder.total_amount,
      deliveryType: storeOrder.delivery_type,
      estimatedDeliveryTime: storeOrder.estimated_delivery_time,
      items: storeOrder.items.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        image: item.product.images?.[0] || null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: roundMoney(item.unitPrice * item.quantity),
        stock: item.product.stock
      }))
    })),
    subtotal: plan.subtotal,
    shippingFee: plan.shippingFee,
    taxAmount: plan.taxAmount,
    discountAmount: plan.discountAmount,
    totalAmount: plan.totalAmount
  };
};

// Double-submit protection. A client retry with the same idempotency key within
// the TTL returns the order that was already created instead of creating a
// second one. This is process-local, so it complements (not replaces) the
// frontend submit lock.
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyCache = new Map();

const pruneIdempotencyCache = () => {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (entry.expiresAt <= now) idempotencyCache.delete(key);
  }
};

// Create order from cart (Parent Order + Store Orders)
export const createOrder = async (customerId, orderData) => {
  const { idempotency_key } = orderData;
  const cacheKey = idempotency_key ? `${customerId}:${idempotency_key}` : null;

  if (cacheKey) {
    pruneIdempotencyCache();
    const cached = idempotencyCache.get(cacheKey);
    if (cached) {
      return cached.orderId
        ? getOrderById(cached.orderId)
        : cached.promise;
    }
  }

  const promise = createOrderInternal(customerId, orderData);

  if (cacheKey) {
    idempotencyCache.set(cacheKey, { promise, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
  }

  try {
    const order = await promise;
    if (cacheKey) {
      idempotencyCache.set(cacheKey, { orderId: order.id, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
    }
    return order;
  } catch (error) {
    if (cacheKey) idempotencyCache.delete(cacheKey);
    throw error;
  }
};

const createOrderInternal = async (customerId, orderData) => {
  const { items, payment_method, customer_notes, delivery_address, customer_coordinates,
    exchange_rate, exchange_rate_source, exchange_rate_updated_at, amount_mmk } = orderData;

  // Normalize delivery phone to E.164 so frontend (E.164 from PhoneInput) and
  // backend store a canonical value without duplicating the country code.
  if (delivery_address && delivery_address.phone) {
    const normalizedPhone = normalizePhoneE164(delivery_address.phone);
    if (normalizedPhone) delivery_address.phone = normalizedPhone;
  }

  // Block new wallet payments when the customer wallet system is disabled.
  // This is enforced server-side (not just hidden in UI). Existing orders and
  // wallet balances/history are never modified or deleted by this toggle.
  if (payment_method === 'wallet') {
    const walletEnabled = await getCustomerWalletEnabled();
    if (!walletEnabled) {
      throw new ValidationError('ระบบวอเลทลูกค้าถูกปิดใช้งาน ขณะนี้ไม่สามารถชำระเงินด้วยวอเลทได้');
    }
  }

  const plan = await buildOrderPlan(items);
  const { storeOrdersData, subtotal: totalSubtotal, shippingFee: totalShippingFee, taxAmount: totalTax, discountAmount, totalAmount, vatRate } = plan;

  // Verify amount_thb matches backend-calculated total (server is source of truth)
  const backendTotalThb = roundMoney(totalAmount);
  
  // Verify amount_mmk if provided (KBZPay)
  let verifiedAmountMmk = null;
  if (payment_method === 'kbzpay') {
    if (!exchange_rate || !Number.isFinite(exchange_rate) || exchange_rate <= 0) {
      throw new ValidationError('Valid exchange rate is required for KBZPay');
    }
    if (!exchange_rate_source || !exchange_rate_source.trim()) {
      throw new ValidationError('Exchange rate source is required for KBZPay');
    }
    if (!exchange_rate_updated_at) {
      throw new ValidationError('Exchange rate timestamp is required for KBZPay');
    }
    // Calculate expected MMK amount from backend THB total
    const expectedAmountMmk = roundMoney(backendTotalThb * exchange_rate);
    if (amount_mmk !== null && amount_mmk !== undefined) {
      const frontendAmountMmk = roundMoney(amount_mmk);
      // Allow small rounding difference (0.5 MMK tolerance)
      if (Math.abs(frontendAmountMmk - expectedAmountMmk) > 0.5) {
        throw new ValidationError(`Amount MMK mismatch: expected ~${expectedAmountMmk}, got ${frontendAmountMmk}`);
      }
    }
    verifiedAmountMmk = expectedAmountMmk;
  }

  // Get customer snapshot
  const { data: customer } = await supabaseAdmin
    .from('profiles')
    .select('name, phone, email, avatar_url')
    .eq('id', customerId)
    .single();
  
  const customerSnapshot = {
    name: customer?.name,
    phone: customer?.phone,
    email: customer?.email,
    avatar_url: customer?.avatar_url,
    address: delivery_address
  };
  
  // Generate order number
  const orderNumber = await generateOrderNumber('ORD');
  
  // Start transaction
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .insert({
      customer_id: customerId,
      order_number: orderNumber,
      status: 'pending',
      payment_status: 'pending', // Always pending initially - COD and KBZPay both need confirmation
      payment_method,
      subtotal: totalSubtotal,
      shipping_fee: totalShippingFee,
      tax_amount: totalTax,
      vat_rate: vatRate,
      discount_amount: discountAmount,
      total_amount: backendTotalThb, // amount_thb (server-verified)
      exchange_rate: payment_method === 'kbzpay' ? exchange_rate : null,
      exchange_rate_source: payment_method === 'kbzpay' ? exchange_rate_source : null,
      exchange_rate_updated_at: payment_method === 'kbzpay' ? exchange_rate_updated_at : null,
      amount_mmk: verifiedAmountMmk,
      customer_snapshot: customerSnapshot,
      delivery_type: storeOrdersData.some(so => so.delivery_type === 'platform_courier') ? 'platform_courier' : 'store_delivery',
      customer_notes
    })
    .select()
    .single();
  
  if (orderError) {
    throw new AppError(`Order creation failed: ${orderError.message}`, 500);
  }

  const createdStoreOrderIds = [];

  // Every step below writes rows. If one of them fails (for example the payment
  // insert, which rejects amount <= 0), release the stock that was already
  // reserved and cancel the order, so a failed checkout never leaves reserved
  // stock or a pending order that can never be paid.
  try {
    // Create customer destination if coordinates provided
    if (customer_coordinates) {
      const { error: destinationError } = await supabaseAdmin
        .from('customer_destinations')
        .insert({
          order_id: order.id,
          coordinates: `POINT(${customer_coordinates.lng} ${customer_coordinates.lat})`,
          address: delivery_address,
          place_name: delivery_address?.place_name || delivery_address?.name
        });

      if (destinationError) {
        throw new AppError(`Customer destination creation failed: ${destinationError.message}`, 500);
      }
    }

    // Create store orders and order items
    for (const storeOrderData of storeOrdersData) {
      const storeOrderNumber = await generateStoreOrderNumber('SO');

      const { data: storeOrder, error: soError } = await supabaseAdmin
        .from('store_orders')
        .insert({
          parent_order_id: order.id,
          store_id: storeOrderData.store_id,
          store_order_number: storeOrderNumber,
          status: 'pending',
          subtotal: storeOrderData.subtotal,
          shipping_fee: storeOrderData.shipping_fee,
          tax_amount: storeOrderData.tax_amount,
          vat_rate: storeOrderData.vat_rate,
          discount_amount: 0,
          total_amount: storeOrderData.total_amount,
          delivery_type: storeOrderData.delivery_type,
          estimated_delivery_time: storeOrderData.estimated_delivery_time,
          store_snapshot: {
            name: storeOrderData.store.name,
            address: storeOrderData.store.address,
            phone: storeOrderData.store.phone
          }
        })
        .select()
        .single();

      if (soError) {
        throw new AppError(`Store order creation failed: ${soError.message}`, 500);
      }

      createdStoreOrderIds.push(storeOrder.id);

      // Create order items. unitPrice was resolved from the products row earlier,
      // so the charged price and the displayed price share one rule.
      const orderItems = storeOrderData.items.map(item => ({
        store_order_id: storeOrder.id,
        product_id: item.product.id,
        product_name: item.product.name,
        product_image: item.product.images?.[0],
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_price: item.product.discount_price,
        total_price: roundMoney(item.unitPrice * item.quantity),
        product_snapshot: {
          name: item.product.name,
          description: item.product.description,
          price: item.product.price,
          discount_price: item.product.discount_price,
          images: item.product.images
        }
      }));
    
    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItems);
    
    if (itemsError) {
      throw new AppError(`Order items creation failed: ${itemsError.message}`, 500);
    }
    
    // Reserve stock
    const reservationItems = storeOrderData.items.map(item => ({
      product_id: item.product.id,
      quantity: item.quantity
    }));

    await reserveStock(storeOrder.id, reservationItems);
  }

    // Create payment record (COD and KBZPay are paid on delivery/confirmation, so no payment row yet)
    if (!['cod', 'kbzpay'].includes(payment_method)) {
      await createPaymentRecord(order.id, null, backendTotalThb, payment_method);
    }
  } catch (error) {
    for (const storeOrderId of createdStoreOrderIds) {
      await releaseStockReservation(storeOrderId);
    }

    try {
      await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', order.id);
    } catch (cancelError) {
      console.error('Failed to cancel the order after a failed checkout:', cancelError);
    }

    throw error;
  }

  // Order-to-Chat: post the order summary into each store's customer<->store
  // conversation. For COD the order is complete now, so we post immediately.
  // KBZPay must wait until the customer's slip is submitted successfully
  // (see submitStorePaymentSlips), so we do NOT post here for kbzpay.
  // Best-effort and idempotent: a failure never blocks or rolls back the order.
  if (payment_method === 'cod') {
    try {
      await sendOrderChatForOrder(order.id, { event: 'order_created' });
    } catch (chatError) {
      console.error('Failed to post COD order to chat:', chatError);
    }
  }

  // Return full order with store orders
  return getOrderById(order.id);
};

// Reserve stock for store order
export const reserveStock = async (storeOrderId, items) => {
  const { data, error } = await supabaseAdmin.rpc('check_and_reserve_stock', {
    p_store_order_id: storeOrderId,
    p_items: items
  });
  
  if (error) {
    throw new AppError(`Stock reservation failed: ${error.message}`, 500);
  }
  
  const failed = data.filter(r => !r.success);
  if (failed.length > 0) {
    // Release any successful reservations
    await releaseStockReservation(storeOrderId);
    throw new ValidationError(`Stock reservation failed: ${failed.map(f => f.message).join(', ')}`);
  }
  
  return data;
};

// Release stock reservation
export const releaseStockReservation = async (storeOrderId) => {
  const { error } = await supabaseAdmin.rpc('release_stock_reservation', {
    p_store_order_id: storeOrderId
  });
  
  if (error) {
    console.error('Failed to release stock reservation:', error);
  }
};

// Fulfill stock reservation (when order confirmed)
export const fulfillStockReservation = async (storeOrderId) => {
  const { error } = await supabaseAdmin.rpc('fulfill_stock_reservation', {
    p_store_order_id: storeOrderId
  });
  
  if (error) {
    throw new AppError(`Stock fulfillment failed: ${error.message}`, 500);
  }
};

// Generate order number
const generateOrderNumber = async (prefix) => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { data, error } = await supabaseAdmin.rpc('generate_order_number', {
    prefix
  });
  
  if (error) {
    // Fallback
    const seq = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `${prefix}${datePart}${seq}`;
  }
  
  return data;
};

// Generate store order number
const generateStoreOrderNumber = async (prefix) => {
  const { data, error } = await supabaseAdmin.rpc('generate_store_order_number', {
    prefix
  });
  
  if (error) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `${prefix}${datePart}${seq}`;
  }
  
  return data;
};

// Create payment record
export const createPaymentRecord = async (orderId, storeOrderId, amount, method) => {
  const numericAmount = roundMoney(amount);

  // payments.amount is CHECK (amount > 0). Fail with a clear message instead of
  // letting the database raise a constraint error after the order was created.
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new AppError('Payment amount must be greater than 0', 400);
  }

  const paymentNumber = await generatePaymentNumber();
  
  const { data: payment, error } = await supabaseAdmin
    .from('payments')
    .insert({
      order_id: orderId,
      store_order_id: storeOrderId,
      payment_number: paymentNumber,
      amount: numericAmount,
      method,
      status: 'pending'
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Payment record creation failed: ${error.message}`, 500);
  }
  
  return payment;
};

const generatePaymentNumber = async () => {
  const { data, error } = await supabaseAdmin.rpc('generate_payment_number');
  if (error) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `PAY${datePart}${seq}`;
  }
  return data;
};

// Get order by ID
export const getOrderById = async (orderId, userId = null, userRole = null) => {
  let query = supabaseAdmin
    .from('orders')
    .select(`
      *,
      store_orders:store_orders(
        *,
        order_items:order_items(
          *,
          product:products(id, name, images)
        ),
        store:stores(id, name, slug, logo_url, address, phone, delivery_type),
        delivery:deliveries(
          *,
          courier:couriers(profile_id, vehicle_type)
        )
      ),
      payments(*),
      payment_slips(*)
    `)
    .eq('id', orderId);
  
  // Apply RLS-like filtering
  if (userId && userRole !== 'admin' && userRole !== 'owner') {
    query = query.eq('customer_id', userId);
  }
  
  const { data: order, error } = await query.single();
  
  if (error || !order) {
    throw new NotFoundError('Order');
  }

  // Decorate payment slips with a freshly signed view URL so the Admin order
  // detail can render the private slip object. slip_url alone may be a bare
  // storage path (multi-order flow) or an expired public URL (legacy flow).
  if (Array.isArray(order.payment_slips) && order.payment_slips.length > 0) {
    order.payment_slips = await withSignedUrls(order.payment_slips);
  }

  return order;
};

// Get orders for customer
export const getCustomerOrders = async (customerId, filters = {}, pagination = {}) => {
  const { status, page = 1, limit = 20 } = filters;
  
  let query = supabaseAdmin
    .from('orders')
    .select(`
      *,
      store_orders:store_orders(
        id, store_order_number, status, total_amount,
        store:stores(id, name, slug, logo_url)
      )
    `, { count: 'exact' })
    .eq('customer_id', customerId);
  
  if (status) query = query.eq('status', status);
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch orders: ${error.message}`, 500);
  }
  
  return {
    orders: data,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// Get store orders for seller
export const getStoreOrders = async (storeId, ownerId, filters = {}, pagination = {}) => {
  // Verify ownership
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Store not found or not authorized', 403);
  }
  
  const { status, page = 1, limit = 20 } = filters;
  
  let query = supabaseAdmin
    .from('store_orders')
    .select(`
      *,
      order:orders!parent_order_id(
        id, order_number, customer_id, customer_snapshot, payment_method, payment_status, customer_notes
      ),
      order_items:order_items(
        *,
        product:products(id, name, images)
      ),
      delivery:deliveries(
        *,
        courier:couriers(profile_id, vehicle_type)
      )
    `, { count: 'exact' })
    .eq('store_id', storeId);
  
  if (status) query = query.eq('status', status);
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch store orders: ${error.message}`, 500);
  }
  
  return {
    storeOrders: data,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// Update order status (customer cancels)
export const cancelOrder = async (orderId, customerId, reason) => {
  const order = await getOrderById(orderId, customerId);
  
  if (order.customer_id !== customerId) {
    throw new AppError('Not authorized to cancel this order', 403);
  }
  
  if (!['pending', 'confirmed'].includes(order.status)) {
    throw new ValidationError('Order cannot be cancelled at this stage');
  }
  
  // Release stock reservations for all store orders
  for (const storeOrder of order.store_orders) {
    await releaseStockReservation(storeOrder.id);
  }
  
  const { data: updatedOrder, error } = await supabaseAdmin
    .from('orders')
    .update({ 
      status: 'cancelled', 
      cancelled_at: new Date().toISOString(),
      admin_notes: reason 
    })
    .eq('id', orderId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Order cancellation failed: ${error.message}`, 500);
  }
  
  // Update all store orders
  await supabaseAdmin
    .from('store_orders')
    .update({ 
      status: 'cancelled', 
      cancelled_at: new Date().toISOString() 
    })
    .eq('parent_order_id', orderId);
  
  return updatedOrder;
};

// Update store order status (seller updates)
export const updateStoreOrderStatus = async (storeOrderId, ownerId, newStatus, notes = '') => {
  const { data: storeOrder } = await supabaseAdmin
    .from('store_orders')
    .select(`
      *,
      store:stores!store_id(owner_id)
    `)
    .eq('id', storeOrderId)
    .single();
  
  if (!storeOrder) {
    throw new NotFoundError('Store order');
  }
  
  if (storeOrder.store.owner_id !== ownerId) {
    throw new AppError('Not authorized to update this store order', 403);
  }
  
  const validTransitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready_for_pickup', 'cancelled'],
    ready_for_pickup: ['picked_up', 'cancelled'],
    picked_up: ['in_transit', 'cancelled'],
    in_transit: ['delivered', 'failed'],
    delivered: [],
    cancelled: [],
    failed: []
  };
  
  if (!validTransitions[storeOrder.status]?.includes(newStatus)) {
    throw new ValidationError(`Invalid status transition from ${storeOrder.status} to ${newStatus}`);
  }
  
  // Fulfill stock when confirmed
  if (newStatus === 'confirmed') {
    await fulfillStockReservation(storeOrderId);
  }
  
  // Release stock if cancelled
  if (newStatus === 'cancelled') {
    await releaseStockReservation(storeOrderId);
  }
  
  // Set session variable for trigger to capture rejection/cancellation reason
  const reasonForHistory = notes && (newStatus === 'cancelled' || newStatus === 'failed') ? notes : null;
  
  const { data: updatedOrder, error } = await supabaseAdmin.rpc('update_store_order_status_with_reason', {
    p_store_order_id: storeOrderId,
    p_new_status: newStatus,
    p_reason: reasonForHistory
  });
  
  if (error) {
    throw new AppError(`Status update failed: ${error.message}`, 500);
  }
  
  // Check if all store orders have same status, update parent order
  await syncParentOrderStatus(storeOrder.parent_order_id);

  // Order-to-Chat: reflect the new status in the order card inside this store's
  // customer<->store conversation. Idempotent per (store_order, event, status),
  // so repeated transitions or retries never duplicate cards. Best-effort.
  try {
    await sendOrderChatForStoreOrder(storeOrderId, { event: 'status_updated' });
  } catch (chatError) {
    console.error('Failed to sync store order status to chat:', chatError);
  }

  return updatedOrder;
};

// Sync parent order status based on store orders
export const syncParentOrderStatus = async (parentOrderId) => {
  const { data: storeOrders } = await supabaseAdmin
    .from('store_orders')
    .select('status')
    .eq('parent_order_id', parentOrderId);
  
  if (!storeOrders || storeOrders.length === 0) return;
  
  const statuses = storeOrders.map(so => so.status);
  
  let parentStatus;
  if (statuses.every(s => s === 'delivered')) {
    parentStatus = 'delivered';
  } else if (statuses.every(s => s === 'cancelled')) {
    parentStatus = 'cancelled';
  } else if (statuses.some(s => s === 'in_transit' || s === 'picked_up')) {
    parentStatus = 'in_transit';
  } else if (statuses.some(s => s === 'ready_for_pickup' || s === 'preparing')) {
    parentStatus = 'preparing';
  } else if (statuses.some(s => s === 'confirmed')) {
    parentStatus = 'confirmed';
  } else {
    parentStatus = 'pending';
  }
  
  const updateData = { status: parentStatus };
  if (parentStatus === 'delivered') {
    updateData.delivered_at = new Date().toISOString();
    // payment_status is NOT automatically set to 'paid' here.
    // COD: requires manual confirmation of cash collection.
    // KBZPay: requires payment gateway confirmation.
    // Other methods: require webhook/callback confirmation.
  } else if (parentStatus === 'cancelled') {
    updateData.cancelled_at = new Date().toISOString();
  }
  
  await supabaseAdmin
    .from('orders')
    .update(updateData)
    .eq('id', parentOrderId);
};

// Get order status history
export const getOrderStatusHistory = async (orderId) => {
  const { data, error } = await supabaseAdmin
    .from('order_status_history')
    .select(`
      *,
      changed_by_user:profiles!changed_by(id, name, role)
    `)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  
  if (error) {
    throw new AppError(`Failed to fetch status history: ${error.message}`, 500);
  }
  
  return data;
};

// Get store order status history (for sellers)
export const getStoreOrderStatusHistory = async (storeOrderId, ownerId) => {
  // Verify ownership
  const { data: storeOrder } = await supabaseAdmin
    .from('store_orders')
    .select(`
      id,
      parent_order_id,
      store:stores!store_id(owner_id)
    `)
    .eq('id', storeOrderId)
    .single();
  
  if (!storeOrder) {
    throw new NotFoundError('Store order');
  }
  
  if (storeOrder.store.owner_id !== ownerId) {
    throw new AppError('Not authorized to view this store order history', 403);
  }
  
  const { data, error } = await supabaseAdmin
    .from('order_status_history')
    .select(`
      *,
      changed_by_user:profiles!changed_by(id, name, role)
    `)
    .eq('store_order_id', storeOrderId)
    .order('created_at', { ascending: false });
  
  if (error) {
    throw new AppError(`Failed to fetch store order status history: ${error.message}`, 500);
  }
  
  return data;
};

// Create refund
export const createRefund = async (orderId, storeOrderId, amount, reason, adminId) => {
  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .in('status', ['paid', 'partially_refunded'])
    .single();
  
  if (!payment) {
    throw new NotFoundError('Paid payment');
  }
  
  const { data: refundRows, error: refundRowsError } = await supabaseAdmin
    .from('refunds')
    .select('amount')
    .eq('payment_id', payment.id)
    .neq('status', 'failed');
  
  if (refundRowsError) {
    throw new AppError(`Refund validation failed: ${refundRowsError.message}`, 500);
  }
  
  const alreadyRefunded = (refundRows || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );
  
  if (amount > Number(payment.amount) - alreadyRefunded) {
    throw new ValidationError('Refund amount exceeds paid amount');
  }
  
  const refundNumber = await generateRefundNumber();
  
  const { data: refund, error } = await supabaseAdmin
    .from('refunds')
    .insert({
      payment_id: payment.id,
      order_id: orderId,
      store_order_id: storeOrderId,
      refund_number: refundNumber,
      amount,
      reason,
      status: 'pending',
      approved_by: adminId
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Refund creation failed: ${error.message}`, 500);
  }
  
  const newRefundedAmount = alreadyRefunded + Number(amount);
  const newPaymentStatus = newRefundedAmount >= Number(payment.amount)
    ? 'refunded'
    : 'partially_refunded';
  
  const { error: paymentUpdateError } = await supabaseAdmin
    .from('payments')
    .update({
      refunded_amount: newRefundedAmount,
      status: newPaymentStatus
    })
    .eq('id', payment.id);
  
  if (paymentUpdateError) {
    throw new AppError(`Refund payment update failed: ${paymentUpdateError.message}`, 500);
  }
  
  return refund;
};

const generateRefundNumber = async () => {
  const { data, error } = await supabaseAdmin.rpc('generate_refund_number');
  if (error) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `REF${datePart}${seq}`;
  }
  return data;
};

// Admin: Get all orders
export const getAllOrders = async (filters = {}, pagination = {}) => {
  const { status, payment_status, customer_id, date_from, date_to, page = 1, limit = 20 } = filters;
  
  let query = supabaseAdmin
    .from('orders')
    .select(`
      *,
      customer:profiles!customer_id(id, name, email, phone),
      store_orders:store_orders(
        id, store_order_number, status, total_amount,
        store:stores(id, name, slug)
      )
    `, { count: 'exact' });
  
  if (status) query = query.eq('status', status);
  if (payment_status) query = query.eq('payment_status', payment_status);
  if (customer_id) query = query.eq('customer_id', customer_id);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', date_to);
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch orders: ${error.message}`, 500);
  }
  
  return {
    orders: data,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// ---------------------------------------------------------------------------
// Order status transitions (shared by the admin order-status endpoint)
// ---------------------------------------------------------------------------
// The parent order follows the fulfilment lifecycle. A transition is only
// allowed to one of the explicitly listed next states, so an admin cannot skip
// steps (e.g. pending -> delivered) without a supporting rule. Payment status
// is intentionally NOT part of this map: changing the order status must never
// confirm a payment (see approveStorePaymentSlip / approvePaymentSlip for that).
export const ORDER_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['picked_up', 'cancelled'],
  picked_up: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: []
};

export const getAllowedOrderStatusTransitions = (status) =>
  ORDER_STATUS_TRANSITIONS[status] || [];

// Admin: update a parent order status with workflow validation.
// - Verifies the order exists.
// - Rejects transitions that are not allowed by ORDER_STATUS_TRANSITIONS.
// - Persists to the DB (never React-only).
// - For COD orders delivered, automatically sets payment_status to 'paid'.
export const updateOrderStatusAdmin = async (orderId, newStatus, notes) => {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('orders')
    .select('id, status, payment_method, payment_status')
    .eq('id', orderId)
    .single();

  if (fetchError || !current) {
    throw new NotFoundError('Order');
  }

  // Idempotent no-op: the order is already in the requested status. This
  // happens when a client re-sends the status the order already has — e.g. a
  // stale order card in chat that still shows "รับออเดอร์" after the order was
  // accepted elsewhere. Return the existing row WITHOUT writing to the DB,
  // WITHOUT posting to chat, and WITHOUT emitting notifications, so no
  // duplicate history/notification is created. Genuinely illegal transitions
  // (a *different*, disallowed status) are still rejected below.
  if (current.status === newStatus) {
    return current;
  }

  const allowed = getAllowedOrderStatusTransitions(current.status);
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(
      `Invalid status transition from ${current.status} to ${newStatus}`
    );
  }

  const updateData = {
    status: newStatus,
    ...(notes !== undefined && { admin_notes: notes }),
    ...(newStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
    ...(newStatus === 'cancelled' && { cancelled_at: new Date().toISOString() }),
    ...(newStatus === 'refunded' && { cancelled_at: new Date().toISOString() }),
    ...(newStatus === 'delivered' && current.payment_method === 'cod' && { payment_status: 'paid' }),
  };

  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .update(updateData)
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    throw new AppError(`Order status update failed: ${error.message}`, 500);
  }

  // Order-to-Chat: sync the new status into every affected store conversation.
  // The admin updates the parent order, so each store_order card is refreshed.
  try {
    await sendOrderChatForOrder(orderId, { event: 'status_updated' });
  } catch (chatError) {
    console.error('Failed to sync admin order status to chat:', chatError);
  }

  return order;
};

// ---------------------------------------------------------------------------
// Payment slip upload (Existing Order Payment — Phase 1)
// ---------------------------------------------------------------------------

// Extract the Storage object path (within the payment-slips bucket) from a slip URL.
// Returns null when the URL cannot be safely parsed.
function extractPaymentSlipStoragePath(slipUrl) {
  if (!slipUrl || typeof slipUrl !== 'string') return null;
  const match = slipUrl.match(/payment-slips\/.+$/);
  if (!match) return null;
  try {
    const url = new URL(slipUrl);
    const pathname = url.pathname;
    const idx = pathname.indexOf('payment-slips/');
    if (idx === -1) return null;
    return decodeURIComponent(pathname.slice(idx));
  } catch {
    return match[0];
  }
}

// Customer uploads a payment slip for an existing unpaid order.
// One slip per order (UNIQUE on order_id). Concurrency-safe: explicit
// pre-check + ON CONFLICT backstop prevents duplicate slips.
export const uploadPaymentSlip = async (
  customerId,
  orderId,
  { fileBuffer, fileName, mimeType, amountThb, note }
) => {
  // 1. Verify order exists, belongs to customer, and is unpaid
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, customer_id, payment_status, total_amount, order_number')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new NotFoundError('ไม่พบคำสั่งซื้อ');
  }

  if (order.customer_id !== customerId) {
    throw new AppError('ไม่มีสิทธิ์อัปโหลดสลิปสำหรับคำสั่งซื้อนี้', 403);
  }

  if (order.payment_status !== 'pending') {
    throw new ValidationError('คำสั่งซื้อนี้ได้รับการชำระเงินแล้วหรือไม่อยู่ในสถานะที่รอการชำระเงิน');
  }

  // 2. Check for existing slip (pre-check; UNIQUE constraint is the backstop)
  const { data: existingSlip } = await supabaseAdmin
    .from('payment_slips')
    .select('id, slip_status, slip_url')
    .eq('order_id', orderId)
    .maybeSingle();

  if (existingSlip) {
    if (existingSlip.slip_status === 'uploaded') {
      throw new ValidationError(
        'ได้อัปโหลดสลิปสำหรับคำสั่งซื้อนี้แล้ว กรุณารอการตรวจสอบจากแอดมิน'
      );
    }
    if (existingSlip.slip_status === 'approved') {
      throw new ValidationError(
        'สลิปนี้ได้รับการอนุมัติแล้ว ไม่สามารถอัปโหลดซ้ำได้'
      );
    }
    // slip_status === 'rejected': allow re-upload — remove old slip file and record first
    const oldStoragePath = extractPaymentSlipStoragePath(existingSlip.slip_url);
    if (oldStoragePath) {
      const { error: removeError } = await supabaseAdmin.storage
        .from('payment-slips')
        .remove([oldStoragePath]);
      if (removeError) {
        throw new AppError(
          `ลบไฟล์สลิปเดิมไม่สำเร็จ: ${removeError.message}`,
          500
        );
      }
    }
    const { error: deleteError } = await supabaseAdmin
      .from('payment_slips')
      .delete()
      .eq('id', existingSlip.id);
    if (deleteError) {
      throw new AppError(
        `ลบบันทึกสลิปเดิมไม่สำเร็จ: ${deleteError.message}`,
        500
      );
    }
  }

  // 3. Upload file to storage bucket
  const timestamp = Date.now();
  const safeFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `payment-slips/${orderId}/${timestamp}-${safeFileName}`;

  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from('payment-slips')
    .upload(filePath, fileBuffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    throw new AppError(`อัปโหลดไฟล์สลิปไม่สำเร็จ: ${uploadError.message}`, 500);
  }

  const { data: { publicUrl } } = await supabaseAdmin.storage
    .from('payment-slips')
    .getPublicUrl(normalizeStoragePath('payment-slips', uploadData.path));

  // 4. Create payment slip record (ON CONFLICT DO NOTHING as race backstop)
  const { data: slip, error: slipError } = await supabaseAdmin
    .from('payment_slips')
    .insert({
      order_id: orderId,
      customer_id: customerId,
      slip_url: publicUrl,
      slip_filename: safeFileName,
      slip_status: 'uploaded',
      amount_thb: Number(amountThb),
      note: note || null
    })
    .select()
    .single();

  if (slipError) {
    // Clean up uploaded file if DB insert fails
    await supabaseAdmin.storage.from('payment-slips').remove([uploadData.path]);
    throw new AppError(`สร้างบันทึกสลิปไม่สำเร็จ: ${slipError.message}`, 500);
  }

  return { slip, order: { id: order.id, order_number: order.order_number, total_amount: order.total_amount } };
};

// Admin: List payment slips (all, with filters)
export const getPaymentSlips = async (filters = {}, pagination = {}) => {
  const { slip_status, customer_id, page = 1, limit = 20 } = filters;

  let query = supabaseAdmin
    .from('payment_slips')
    .select(`
      *,
      order:orders(id, order_number, total_amount, payment_status, customer_id),
      customer:profiles!customer_id(id, name, email, phone)
    `, { count: 'exact' });

  if (slip_status) query = query.eq('slip_status', slip_status);
  if (customer_id) query = query.eq('customer_id', customer_id);

  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError(`Failed to fetch payment slips: ${error.message}`, 500);
  }

  return {
    slips: await withSignedUrls(data || []),
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// Admin: Approve a payment slip — sets order payment_status='paid'
export const approvePaymentSlip = async (adminId, slipId) => {
  // 1. Verify slip exists and is in 'uploaded' state
  const { data: slip, error: slipError } = await supabaseAdmin
    .from('payment_slips')
    .select('*, order:orders(id, payment_status, customer_id)')
    .eq('id', slipId)
    .single();

  if (slipError || !slip) {
    throw new NotFoundError('ไม่พบสลิปการชำระเงิน');
  }

  if (slip.slip_status !== 'uploaded') {
    throw new ValidationError(
      slip.slip_status === 'approved'
        ? 'สลิปนี้ได้รับการอนุมัติแล้ว'
        : 'สลิปนี้ถูกปฏิเสธแล้ว ไม่สามารถอนุมัติซ้ำได้'
    );
  }

  // 2. Verify the order is still pending (defense in depth)
  if (slip.order.payment_status !== 'pending') {
    throw new ValidationError('คำสั่งซื้อนี้ได้รับการชำระเงินแล้ว');
  }

  // 3. Update slip to approved
  const { error: updateSlipError } = await supabaseAdmin
    .from('payment_slips')
    .update({
      slip_status: 'approved',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', slipId);

  if (updateSlipError) {
    throw new AppError(`อนุมัติสลิปไม่สำเร็จ: ${updateSlipError.message}`, 500);
  }

  // 4. Update order payment_status to 'paid'
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .update({ payment_status: 'paid' })
    .eq('id', slip.order_id)
    .select('id, order_number, payment_status, customer_id')
    .single();

  if (orderError) {
    throw new AppError(`อัปเดตสถานะคำสั่งซื้อไม่สำเร็จ: ${orderError.message}`, 500);
  }

  return { slip: { id: slipId, slip_status: 'approved' }, order };
};

// Admin: Reject a payment slip — order stays 'pending', customer can re-upload
export const rejectPaymentSlip = async (adminId, slipId, rejectReason) => {
  // 1. Verify slip exists and is in 'uploaded' state
  const { data: slip, error: slipError } = await supabaseAdmin
    .from('payment_slips')
    .select('*, order:orders(id, payment_status)')
    .eq('id', slipId)
    .single();

  if (slipError || !slip) {
    throw new NotFoundError('ไม่พบสลิปการชำระเงิน');
  }

  if (slip.slip_status !== 'uploaded') {
    throw new ValidationError(
      slip.slip_status === 'approved'
        ? 'สลิปนี้ได้รับการอนุมัติแล้ว ไม่สามารถปฏิเสธได้'
        : 'สลิปนี้ถูกปฏิเสธแล้ว'
    );
  }

  // 2. Update slip to rejected
  const { error: updateSlipError } = await supabaseAdmin
    .from('payment_slips')
    .update({
      slip_status: 'rejected',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      reject_reason: rejectReason || null
    })
    .eq('id', slipId);

  if (updateSlipError) {
    throw new AppError(`ปฏิเสธสลิปไม่สำเร็จ: ${updateSlipError.message}`, 500);
  }

  return { slip: { id: slipId, slip_status: 'rejected', reject_reason: rejectReason } };
};

// ===========================================================================
// Payment slip upload — multi-order, single transfer (Existing Order Payment)
// ---------------------------------------------------------------------------
// One file covers one or more KBZPay orders that belong to the SAME store.
// The customer uploads once; we create one payment_slips row per order (all
// sharing a submission_id and slip_path), flip each order to 'awaiting_review',
// and notify the store owner. Money math (amount_mmk / total_amount) is read
// from the database, never trusted from the client.
// ===========================================================================

const SLIP_BUCKET = 'payment-slips';
const SLIP_SIGNED_URL_TTL = 60 * 60; // seconds

// Generate a short-lived signed URL for a private slip object. Never returns a
// public URL: the bucket is private, so only holders of a signed URL can read it.
//
// Uses getSignedUrl() from upload.js so the stored object key is normalized
// (bucket prefix stripped) before createSignedUrl() is called. Without this,
// a stored key like `payment-slips/<orderId>/file.jpg` would be signed as
// `payment-slips/payment-slips/<orderId>/file.jpg` — a double-prefixed key that
// does not exist in the bucket (same class of bug fixed for chat attachments).
export const signPaymentSlipUrl = async (slipPath, expiresIn = SLIP_SIGNED_URL_TTL) => {
  if (!slipPath || typeof slipPath !== 'string') return null;
  try {
    return await getSignedUrl(supabaseAdmin, SLIP_BUCKET, slipPath, expiresIn);
  } catch {
    return null;
  }
};

// Decorate raw slip rows with a freshly signed view URL derived from slip_path
// (falling back to the legacy slip_url path if slip_path is missing).
const withSignedUrls = (slips) =>
  Promise.all((slips || []).map(async (slip) => {
    const path = slip.slip_path || extractPaymentSlipStoragePath(slip.slip_url);
    const signedUrl = await signPaymentSlipUrl(path);
    return { ...slip, slip_view_url: signedUrl };
  }));

// Submit one transfer slip for one or more orders of a single store.
export const submitStorePaymentSlips = async (
  customerId,
  storeId,
  orderIds,
  { fileBuffer, fileName, mimeType, note }
) => {
  if (!storeId) throw new ValidationError('กรุณาระบุร้านค้า');
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    throw new ValidationError('กรุณาเลือกคำสั่งซื้ออย่างน้อยหนึ่งรายการ');
  }
  const uniqueOrderIds = Array.from(new Set(orderIds));
  if (uniqueOrderIds.length === 0) {
    throw new ValidationError('กรุณาเลือกคำสั่งซื้ออย่างน้อยหนึ่งรายการ');
  }
  if (!fileBuffer || !fileName) {
    throw new ValidationError('กรุณาแนบไฟล์สลิป');
  }

  // 1) Load the orders with their store membership and store owner.
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select(`
      id, customer_id, order_number, payment_status, payment_method,
      total_amount, amount_mmk,
      store_orders:store_orders(store_id, store:stores!store_id(id, name, owner_id))
    `)
    .in('id', uniqueOrderIds);

  if (ordersError) {
    throw new AppError(`โหลดคำสั่งซื้อไม่สำเร็จ: ${ordersError.message}`, 500);
  }

  if (!orders || orders.length === 0) {
    throw new NotFoundError('ไม่พบคำสั่งซื้อที่เลือก');
  }
  if (orders.length !== uniqueOrderIds.length) {
    const foundIds = new Set((orders || []).map((o) => o.id));
    const missingIds = uniqueOrderIds.filter((id) => !foundIds.has(id));
    throw new NotFoundError(`ไม่พบคำสั่งซื้อบางรายการ (ID ที่ไม่พบ: ${missingIds.join(', ')})`);
  }

  let storeOwnerId = null;
  let storeName = null;
  const payableOrders = [];

  for (const order of orders) {
    if (order.customer_id !== customerId) {
      throw new AppError('ไม่มีสิทธิ์อัปโหลดสลิปสำหรับคำสั่งซื้อนี้', 403);
    }
    if (order.payment_method !== 'kbzpay') {
      throw new ValidationError(`คำสั่งซื้อ #${order.order_number} ไม่ใช่การชำระเงินผ่าน KBZPay`);
    }
    if (!['pending', 'awaiting_review'].includes(order.payment_status)) {
      throw new ValidationError(
        `คำสั่งซื้อ #${order.order_number} ไม่อยู่ในสถานะรอชำระเงิน (สถานะ: ${order.payment_status})`
      );
    }
    const soList = order.store_orders || [];
    const match = soList.find((so) => {
      if (so.store_id === storeId) return true;
      if (so.store?.id === storeId) return true;
      if (so.store_snapshot?.store_id === storeId) return true;
      return false;
    });
    if (!match) {
      throw new ValidationError(`คำสั่งซื้อ #${order.order_number} ไม่ได้สังกัดร้านค้าที่เลือก`);
    }
    const ownerId = match.store?.owner_id || null;
    if (!storeOwnerId && ownerId) storeOwnerId = ownerId;
    if (!storeName && match.store?.name) storeName = match.store.name;
    payableOrders.push(order);
  }

  // 2) Duplicate guard: any order that already has a non-rejected slip for THIS
  //    store is locked. Scoped by store_id so a single parent order spanning
  //    multiple stores can carry one slip per store (see 022 migration).
  const { data: existingSlips, error: existingError } = await supabaseAdmin
    .from('payment_slips')
    .select('id, order_id, slip_status')
    .in('order_id', uniqueOrderIds)
    .eq('store_id', storeId)
    .neq('slip_status', 'rejected');

  if (existingError) {
    throw new AppError(`ตรวจสอบสลิปเดิมไม่สำเร็จ: ${existingError.message}`, 500);
  }
  if (existingSlips && existingSlips.length > 0) {
    const locked = new Set(existingSlips.map((s) => s.order_id));
    const names = payableOrders
      .filter((o) => locked.has(o.id))
      .map((o) => `#${o.order_number}`)
      .join(', ');
    throw new ValidationError(`มีการส่งสลิปสำหรับคำสั่งซื้อ ${names} แล้ว กรุณารอการตรวจสอบ`);
  }

  // 2b) Clear any previously REJECTED slips for these orders at this store so a
  //     re-upload after rejection can insert cleanly. Without this the insert in
  //     step 5 collides with the surviving rejected row under the
  //     UNIQUE(order_id, store_id) index and the customer gets permanently stuck
  //     (order back to pending, yet no new slip can be attached). The old storage
  //     objects are intentionally left in place: a rejected submission's file may
  //     be shared across several orders (same submission_id), so deleting it here
  //     could break other orders' slip views. Orphan cleanup is out of scope.
  const { error: clearRejectedError } = await supabaseAdmin
    .from('payment_slips')
    .delete()
    .in('order_id', uniqueOrderIds)
    .eq('store_id', storeId)
    .eq('slip_status', 'rejected');

  if (clearRejectedError) {
    throw new AppError(`ล้างสลิปเดิมที่ไม่อนุมัติไม่สำเร็จ: ${clearRejectedError.message}`, 500);
  }

  // 3) Money math from the DB (never trust a client-supplied amount).
  let amountMmk = 0;
  let amountThb = 0;
  for (const order of payableOrders) {
    const mmk = Number(order.amount_mmk);
    amountMmk += Number.isFinite(mmk) ? mmk : 0;
    amountThb += Number(order.total_amount) || 0;
  }
  amountMmk = roundMoney(amountMmk);
  amountThb = roundMoney(amountThb);
  if (!(amountMmk > 0) && !(amountThb > 0)) {
    throw new ValidationError('ยอดชำระเงินไม่ถูกต้อง');
  }

  // 4) Upload the single file under the first order's folder.
  const primaryOrderId = payableOrders[0].id;
  const timestamp = Date.now();
  const safeFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const slipPath = `${SLIP_BUCKET}/${primaryOrderId}/${timestamp}-${safeFileName}`;
  const submissionId = uuidv4();

  const { error: uploadError } = await supabaseAdmin.storage
    .from(SLIP_BUCKET)
    .upload(slipPath, fileBuffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    throw new AppError(`อัปโหลดไฟล์สลิปไม่สำเร็จ: ${uploadError.message}`, 500);
  }

  // 5) Create one slip row per order, all sharing submission_id + slip_path.
  const rows = payableOrders.map((order) => ({
    order_id: order.id,
    customer_id: customerId,
    store_id: storeId,
    submission_id: submissionId,
    slip_path: slipPath,
    slip_url: slipPath,
    slip_filename: safeFileName,
    slip_mime: mimeType || null,
    slip_status: 'uploaded',
    currency: 'MMK',
    amount: roundMoney(Number(order.amount_mmk) || 0),
    amount_thb: roundMoney(Number(order.total_amount) || 0),
    note: note || null
  }));

  const { data: insertedSlips, error: insertError } = await supabaseAdmin
    .from('payment_slips')
    .insert(rows)
    .select();

  if (insertError) {
    // Roll back the uploaded file so a failed insert leaves no orphan object.
    await supabaseAdmin.storage.from(SLIP_BUCKET).remove([slipPath]);
    // A unique violation on payment_slips.order_id means a concurrent submit
    // already created a slip for one of these orders — surface it as 409
    // instead of a generic 500 so the client knows the order is already locked.
    if (insertError.code === '23505') {
      throw new ConflictError('มีการส่งสลิปสำหรับคำสั่งซื้อบางรายการแล้ว กรุณารอการตรวจสอบ');
    }
    throw new AppError(`บันทึกสลิปไม่สำเร็จ: ${insertError.message}`, 500);
  }

  // 6) Flip every order to 'awaiting_review' — guarded on still being 'pending'
  //    so a concurrent approval cannot be overwritten back to awaiting review.
  const { data: updatedOrders, error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ payment_status: 'awaiting_review' })
    .in('id', uniqueOrderIds)
    .eq('payment_status', 'pending')
    .select('id, order_number, payment_status');

  if (updateError) {
    throw new AppError(`อัปเดตสถานะคำสั่งซื้อไม่สำเร็จ: ${updateError.message}`, 500);
  }

  // 6b) Order-to-Chat: the slip is now submitted successfully, so post the
  //     order summary into the customer<->store conversation for each affected
  //     order. This is the ONLY point KBZPay orders enter chat — never at order
  //     creation. Best-effort and idempotent; never fails the slip submission.
  for (const updated of updatedOrders || []) {
    try {
      await sendOrderChatForOrder(updated.id, { event: 'slip_submitted' });
    } catch (chatError) {
      console.error('Failed to post KBZPay order to chat:', chatError);
    }
  }

  const result = {
    submissionId,
    slipPath,
    amount: amountMmk,
    amountThb,
    currency: 'MMK',
    storeId,
    storeName,
    slips: insertedSlips || [],
    orders: updatedOrders || []
  };

  // 7) Notify the store owner (best-effort: never fail the upload on notify).
  try {
    await notifyStoreOwnerOfSlip({
      storeId,
      storeName,
      ownerId: storeOwnerId,
      orders: payableOrders,
      amount: amountMmk,
      currency: 'MMK',
      submittedAt: new Date().toISOString()
    });
  } catch (notifyError) {
    console.error('Failed to notify store owner of payment slip:', notifyError);
  }

  return result;
};

// Notify the store owner (and store room) that a slip is awaiting review.
const notifyStoreOwnerOfSlip = async ({ storeId, storeName, ownerId, orders, amount, currency, submittedAt }) => {
  const orderNumbers = orders.map((o) => `#${o.order_number}`).join(', ');
  const orderIds = orders.map((o) => o.id);
  const primaryOrderId = orderIds[0] || null;

  if (ownerId) {
    await createSystemNotification(
      ownerId,
      'payment',
      'มีการแนบสลิปการชำระเงินใหม่',
      `ลูกค้าส่งสลิป KBZPay สำหรับ ${orderNumbers} จำนวน ${amount.toLocaleString('en-US')} ${currency} เมื่อ ${submittedAt} รอตรวจสอบ`,
      primaryOrderId,
      'order',
      {
        kind: 'payment_slip_uploaded',
        store_id: storeId,
        store_name: storeName,
        order_ids: orderIds,
        order_numbers: orderNumbers,
        amount,
        currency,
        submitted_at: submittedAt,
      }
    );
  }

  // Real-time: tell the store room and the owner so the order list refreshes.
  emitToStore(storeId, 'paymentSlipUploaded', {
    storeId,
    orderIds,
    orderNumbers,
    amount,
    currency,
    submittedAt
  });
  if (ownerId) {
    emitToUser(ownerId, 'paymentSlipUploaded', { storeId, orderIds, orderNumbers, amount, currency, submittedAt });
  }
};

// Verify a user owns (or manages, or is platform admin of) the given store.
const assertStoreAccess = async (storeId, userId, userRole) => {
  if (['admin', 'owner'].includes(userRole)) return true;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, owner_id')
    .eq('id', storeId)
    .maybeSingle();
  if (!store) return false;
  if (store.owner_id === userId) return true;
  const { data: member } = await supabaseAdmin
    .from('store_memberships')
    .select('id')
    .eq('store_id', storeId)
    .eq('profile_id', userId)
    .is('left_at', null)
    .is('suspended_at', null)
    .in('role', ['manager', 'staff'])
    .maybeSingle();
  return Boolean(member);
};

// Store owner: list payment slips for their own store, with signed view URLs.
export const getStorePaymentSlips = async (storeId, user, filters = {}, pagination = {}) => {
  const hasAccess = await assertStoreAccess(storeId, user.id, user.role);
  if (!hasAccess) {
    throw new AppError('ไม่มีสิทธิ์เข้าถึงสลิปของร้านค้านี้', 403);
  }

  const { slip_status, page = 1, limit = 20 } = filters;
  let query = supabaseAdmin
    .from('payment_slips')
    .select(`
      *,
      order:orders(id, order_number, payment_status, customer_id, total_amount, amount_mmk,
        customer:profiles!customer_id(id, name, phone)),
      store:stores(id, name)
    `, { count: 'exact' })
    .eq('store_id', storeId);

  if (slip_status) query = query.eq('slip_status', slip_status);

  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;
  if (error) {
    throw new AppError(`โหลดสลิปไม่สำเร็จ: ${error.message}`, 500);
  }

  const slips = await withSignedUrls(data);
  return {
    slips,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// Store owner: approve one slip — verify store ownership, then set the order
// to 'paid' (manual confirmation by the store owner, never automatic).
export const approveStorePaymentSlip = async (userId, userRole, slipId) => {
  const { data: slip, error: slipError } = await supabaseAdmin
    .from('payment_slips')
    .select('*, order:orders(id, order_number, payment_status, customer_id, store_orders:store_orders(store_id))')
    .eq('id', slipId)
    .single();

  if (slipError || !slip) {
    throw new NotFoundError('ไม่พบสลิปการชำระเงิน');
  }

  const storeId = slip.store_id || slip.order?.store_orders?.[0]?.store_id;
  if (storeId) {
    const hasAccess = await assertStoreAccess(storeId, userId, userRole);
    if (!hasAccess) throw new AppError('ไม่มีสิทธิ์อนุมัติสลิปของร้านค้านี้', 403);
  } else if (!['admin', 'owner'].includes(userRole)) {
    throw new AppError('ไม่มีสิทธิ์อนุมัติสลิปนี้', 403);
  }

  if (slip.slip_status !== 'uploaded') {
    throw new ValidationError(
      slip.slip_status === 'approved'
        ? 'สลิปนี้ได้รับการอนุมัติแล้ว'
        : 'สลิปนี้ถูกปฏิเสธแล้ว ไม่สามารถอนุมัติซ้ำได้'
    );
  }

  const { error: updateSlipError } = await supabaseAdmin
    .from('payment_slips')
    .update({ slip_status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq('id', slipId);
  if (updateSlipError) {
    throw new AppError(`อนุมัติสลิปไม่สำเร็จ: ${updateSlipError.message}`, 500);
  }

  // Finalize the parent order as 'paid' only once EVERY non-rejected slip for
  // the order is approved. A single parent order can span multiple stores (each
  // pays separately), so one store's approval must not mark the whole order paid.
  const { data: siblingSlips, error: siblingError } = await supabaseAdmin
    .from('payment_slips')
    .select('id, slip_status')
    .eq('order_id', slip.order_id)
    .neq('slip_status', 'rejected');
  if (siblingError) {
    throw new AppError(`ตรวจสอบสถานะสลิปไม่สำเร็จ: ${siblingError.message}`, 500);
  }
  const allApproved =
    (siblingSlips || []).length > 0 &&
    siblingSlips.every((s) => s.slip_status === 'approved');

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .update({ payment_status: allApproved ? 'paid' : 'awaiting_review' })
    .eq('id', slip.order_id)
    .select('id, order_number, payment_status, customer_id')
    .single();
  if (orderError) {
    throw new AppError(`อัปเดตสถานะคำสั่งซื้อไม่สำเร็จ: ${orderError.message}`, 500);
  }

  // Only tell the customer the payment is fully confirmed once the whole order
  // is paid; per-store approvals that leave the order in awaiting_review are not
  // a final confirmation.
  if (allApproved) {
    try {
      await createSystemNotification(
        slip.customer_id,
        'payment',
        'การชำระเงินได้รับการยืนยัน',
        `ร้านค้าได้ยืนยันการชำระเงินสำหรับคำสั่งซื้อ #${order.order_number} แล้ว`,
        order.id,
        'order',
        { kind: 'payment_slip_approved', order_number: order.order_number }
      );
    } catch (notifyError) {
      console.error('Failed to notify customer of slip approval:', notifyError);
    }
  }

  // Order-to-Chat: update the order card to reflect the confirmed payment.
  try {
    await sendOrderChatForOrder(slip.order_id, {
      event: 'payment_confirmed',
      storeId: storeId || slip.store_id || null,
    });
  } catch (chatError) {
    console.error('Failed to sync payment approval to chat:', chatError);
  }

  return { slip: { id: slipId, slip_status: 'approved' }, order };
};

// Store owner: reject one slip — the order returns to 'pending' so the customer
// can re-submit. Never sets a paid status.
export const rejectStorePaymentSlip = async (userId, userRole, slipId, reason) => {
  const { data: slip, error: slipError } = await supabaseAdmin
    .from('payment_slips')
    .select('*, order:orders(id, order_number, payment_status, customer_id, store_orders:store_orders(store_id))')
    .eq('id', slipId)
    .single();

  if (slipError || !slip) {
    throw new NotFoundError('ไม่พบสลิปการชำระเงิน');
  }

  const storeId = slip.store_id || slip.order?.store_orders?.[0]?.store_id;
  if (storeId) {
    const hasAccess = await assertStoreAccess(storeId, userId, userRole);
    if (!hasAccess) throw new AppError('ไม่มีสิทธิ์ปฏิเสธสลิปของร้านค้านี้', 403);
  } else if (!['admin', 'owner'].includes(userRole)) {
    throw new AppError('ไม่มีสิทธิ์ปฏิเสธสลิปนี้', 403);
  }

  if (slip.slip_status !== 'uploaded') {
    throw new ValidationError(
      slip.slip_status === 'approved'
        ? 'สลิปนี้ได้รับการอนุมัติแล้ว ไม่สามารถปฏิเสธได้'
        : 'สลิปนี้ถูกปฏิเสธแล้ว'
    );
  }

  const { error: updateSlipError } = await supabaseAdmin
    .from('payment_slips')
    .update({
      slip_status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      reject_reason: reason || null
    })
    .eq('id', slipId);
  if (updateSlipError) {
    throw new AppError(`ปฏิเสธสลิปไม่สำเร็จ: ${updateSlipError.message}`, 500);
  }

  // Return the order to pending ONLY if no other non-rejected slips remain for
  // the order (i.e. this was the only active slip). If sibling stores still have
  // uploaded/approved slips, keep the order in awaiting_review.
  const { data: remainingSlips, error: remainingError } = await supabaseAdmin
    .from('payment_slips')
    .select('id')
    .eq('order_id', slip.order_id)
    .neq('slip_status', 'rejected');
  if (remainingError) {
    throw new AppError(`ตรวจสอบสถานะสลิปไม่สำเร็จ: ${remainingError.message}`, 500);
  }
  if ((remainingSlips || []).length === 0) {
    await supabaseAdmin
      .from('orders')
      .update({ payment_status: 'pending' })
      .eq('id', slip.order_id)
      .eq('payment_status', 'awaiting_review');
  }

  try {
    await createSystemNotification(
      slip.customer_id,
      'payment',
      'สลิปการชำระเงินถูกปฏิเสธ',
      `ร้านค้าปฏิเสธสลิปสำหรับคำสั่งซื้อ #${slip.order?.order_number || ''}${reason ? ` เหตุผล: ${reason}` : ''} กรุณาส่งสลิปใหม่`,
      slip.order_id,
      'order',
      { kind: 'payment_slip_rejected', order_id: slip.order_id, reason: reason || null }
    );
  } catch (notifyError) {
    console.error('Failed to notify customer of slip rejection:', notifyError);
  }

  // Order-to-Chat: reflect the returned-to-pending state in the order card.
  try {
    await sendOrderChatForOrder(slip.order_id, {
      event: 'payment_rejected',
      storeId: storeId || slip.store_id || null,
    });
  } catch (chatError) {
    console.error('Failed to sync payment rejection to chat:', chatError);
  }

  return { slip: { id: slipId, slip_status: 'rejected', reject_reason: reason || null } };
};
