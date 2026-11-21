import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { resolveEffectivePrice, roundMoney } from '../utils/productPricing.js';
import { emitNewOrder, emitOrderUpdate } from './socketService.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { v4 as uuidv4 } from 'uuid';

// Price charged for one unit. Rules live in utils/productPricing.js so the
// product forms and the checkout can never disagree.
//   NULL/undefined -> regular price, 0 -> regular price (legacy rows are never
//   turned into free items), 0 < d < price -> discount price.
export const calculateEffectivePrice = (price, discountPrice) =>
  resolveEffectivePrice(price, discountPrice);

const MAX_QUANTITY = 9999;

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

// Resolve every line from the database. Only product_id and quantity are ever
// read from the client, so a tampered price in the request body can never lower
// the amount charged. Used by both the checkout preview and order creation so
// the confirmed total and the stored total always agree.
const buildOrderPlan = async (items) => {
  if (!items || items.length === 0) {
    throw new ValidationError('Order must have at least one item');
  }

  const itemsByStore = {};
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new ValidationError(`Invalid quantity for product ${item.product_id}`);
    }

    const { data: product } = await supabaseAdmin
      .from('products')
      .select('id, store_id, name, price, discount_price, stock, images, is_active')
      .eq('id', item.product_id)
      .single();

    if (!product) {
      throw new NotFoundError(`Product ${item.product_id}`);
    }

    if (!product.is_active) {
      throw new ValidationError(`Product ${product.name} is not available`);
    }

    if (product.stock < quantity) {
      throw new ValidationError(`Insufficient stock for ${product.name}`);
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
    .getPublicUrl(uploadData.path);

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
    slips: data || [],
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
