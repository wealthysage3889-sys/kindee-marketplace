import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

// Create delivery for store order
export const createDelivery = async (storeOrderId) => {
  const { data: storeOrder } = await supabaseAdmin
    .from('store_orders')
    .select(`
      *,
      store:stores!store_id(id, name, address, phone, delivery_type),
      order:orders!parent_order_id(id, customer_id, customer_snapshot)
    `)
    .eq('id', storeOrderId)
    .single();
  
  if (!storeOrder) {
    throw new NotFoundError('Store order');
  }
  
  // Get customer destination
  const { data: destination } = await supabaseAdmin
    .from('customer_destinations')
    .select('*')
    .eq('order_id', storeOrder.order.id)
    .single();
  
  // Get store coordinates
  const storeCoords = storeOrder.store.address?.coordinates;
  const customerCoords = destination?.coordinates;
  
  if (!storeCoords || !customerCoords) {
    throw new ValidationError('Missing coordinates for delivery');
  }
  
  // Create delivery record
  const { data: delivery, error } = await supabaseAdmin
    .from('deliveries')
    .insert({
      store_order_id: storeOrderId,
      delivery_type: storeOrder.store.delivery_type,
      pickup_address: storeOrder.store.address,
      pickup_coordinates: `POINT(${storeCoords.lng} ${storeCoords.lat})`,
      delivery_address: destination?.address || storeOrder.order.customer_snapshot?.address,
      delivery_coordinates: customerCoords ? `POINT(${customerCoords.lng} ${customerCoords.lat})` : null,
      status: 'pending'
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Delivery creation failed: ${error.message}`, 500);
  }
  
  // If platform courier, find available couriers
  if (storeOrder.store.delivery_type === 'platform_courier') {
    await assignCourier(delivery.id);
  }
  
  return delivery;
};

// Assign courier to delivery
export const assignCourier = async (deliveryId) => {
  const { data: delivery } = await supabaseAdmin
    .from('deliveries')
    .select('*')
    .eq('id', deliveryId)
    .single();
  
  if (!delivery) {
    throw new NotFoundError('Delivery');
  }
  
  // Get pickup coordinates
  const pickupCoords = delivery.pickup_coordinates;
  
  // Find nearby available couriers
  const { data: couriers } = await supabaseAdmin.rpc('find_available_couriers', {
    p_lat: pickupCoords.y,
    p_lng: pickupCoords.x,
    p_radius_km: 5,
    p_limit: 10
  });
  
  if (!couriers || couriers.length === 0) {
    // No couriers available, keep as pending
    return { success: false, message: 'No couriers available' };
  }
  
  // Offer to first courier
  const courier = couriers[0];
  const expiresAt = new Date(Date.now() + 60000); // 1 minute
  
  const { error } = await supabaseAdmin
    .from('delivery_assignments')
    .insert({
      delivery_id: deliveryId,
      courier_id: courier.id,
      status: 'offered',
      expires_at: expiresAt.toISOString()
    });
  
  if (error) {
    throw new AppError(`Courier assignment failed: ${error.message}`, 500);
  }
  
  // Update delivery status
  await supabaseAdmin
    .from('deliveries')
    .update({ status: 'assigned', assigned_at: new Date().toISOString() })
    .eq('id', deliveryId);
  
  return { success: true, courier_id: courier.id };
};

// Courier accepts assignment
export const acceptAssignment = async (courierId, assignmentId) => {
  const { data: assignment } = await supabaseAdmin
    .from('delivery_assignments')
    .select('*')
    .eq('id', assignmentId)
    .eq('courier_id', courierId)
    .eq('status', 'offered')
    .single();
  
  if (!assignment) {
    throw new NotFoundError('Assignment');
  }
  
  // Check if expired
  if (new Date(assignment.expires_at) < new Date()) {
    await supabaseAdmin
      .from('delivery_assignments')
      .update({ status: 'expired', responded_at: new Date().toISOString() })
      .eq('id', assignmentId);
    
    throw new ValidationError('Assignment expired');
  }
  
  // Accept assignment
  await supabaseAdmin
    .from('delivery_assignments')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', assignmentId);
  
  // Update delivery
  await supabaseAdmin
    .from('deliveries')
    .update({ 
      courier_id: courierId,
      status: 'assigned'
    })
    .eq('id', assignment.delivery_id);
  
  // Reject other pending assignments for this delivery
  await supabaseAdmin
    .from('delivery_assignments')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('delivery_id', assignment.delivery_id)
    .neq('id', assignmentId)
    .eq('status', 'offered');
  
  return { success: true };
};

// Courier rejects assignment
export const rejectAssignment = async (courierId, assignmentId) => {
  const { data: assignment } = await supabaseAdmin
    .from('delivery_assignments')
    .select('*')
    .eq('id', assignmentId)
    .eq('courier_id', courierId)
    .eq('status', 'offered')
    .single();
  
  if (!assignment) {
    throw new NotFoundError('Assignment');
  }
  
  await supabaseAdmin
    .from('delivery_assignments')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('id', assignmentId);
  
  // Try next courier
  await assignCourier(assignment.delivery_id);
  
  return { success: true };
};

// Courier picks up order
export const pickupOrder = async (courierId, deliveryId) => {
  const { data: delivery } = await supabaseAdmin
    .from('deliveries')
    .select('*')
    .eq('id', deliveryId)
    .eq('courier_id', courierId)
    .single();
  
  if (!delivery) {
    throw new NotFoundError('Delivery');
  }
  
  if (delivery.status !== 'assigned') {
    throw new ValidationError('Delivery not in assigned status');
  }
  
  await supabaseAdmin
    .from('deliveries')
    .update({ 
      status: 'picked_up', 
      picked_up_at: new Date().toISOString() 
    })
    .eq('id', deliveryId);
  
  // Update store order
  await supabaseAdmin
    .from('store_orders')
    .update({ 
      status: 'picked_up', 
      picked_up_at: new Date().toISOString() 
    })
    .eq('id', delivery.store_order_id);
  
  return { success: true };
};

// Courier delivers order
export const deliverOrder = async (courierId, deliveryId, proofImage = null) => {
  const { data: delivery } = await supabaseAdmin
    .from('deliveries')
    .select('*')
    .eq('id', deliveryId)
    .eq('courier_id', courierId)
    .single();
  
  if (!delivery) {
    throw new NotFoundError('Delivery');
  }
  
  if (delivery.status !== 'picked_up' && delivery.status !== 'in_transit') {
    throw new ValidationError('Delivery not in transit');
  }
  
  await supabaseAdmin
    .from('deliveries')
    .update({ 
      status: 'delivered', 
      delivered_at: new Date().toISOString() 
    })
    .eq('id', deliveryId);
  
  // Update store order
  await supabaseAdmin
    .from('store_orders')
    .update({ 
      status: 'delivered', 
      delivered_at: new Date().toISOString() 
    })
    .eq('id', delivery.store_order_id);
  
  // Update courier stats
  await supabaseAdmin.rpc('increment_courier_deliveries', { p_courier_id: courierId });
  
  return { success: true };
};

// Update courier location (real-time tracking)
export const updateCourierLocation = async (courierId, deliveryId, coordinates, metadata = {}) => {
  const { data: delivery } = await supabaseAdmin
    .from('deliveries')
    .select('courier_id')
    .eq('id', deliveryId)
    .single();
  
  if (!delivery || delivery.courier_id !== courierId) {
    throw new AppError('Not authorized to update this delivery location', 403);
  }
  
  // Insert live location
  await supabaseAdmin
    .from('courier_live_locations')
    .insert({
      delivery_id: deliveryId,
      courier_id: courierId,
      coordinates: `POINT(${coordinates.lng} ${coordinates.lat})`,
      accuracy: metadata.accuracy,
      speed_kmh: metadata.speed,
      heading: metadata.heading,
      is_active: true
    });
  
  // Update courier current location
  await supabaseAdmin
    .from('couriers')
    .update({ 
      current_location: `POINT(${coordinates.lng} ${coordinates.lat})`,
      last_location_update: new Date().toISOString()
    })
    .eq('id', courierId);
  
  // Update delivery status to in_transit if picked_up
  if (delivery.status === 'picked_up') {
    await supabaseAdmin
      .from('deliveries')
      .update({ status: 'in_transit' })
      .eq('id', deliveryId);
  }
  
  return { success: true };
};

// Get delivery with tracking info
export const getDelivery = async (deliveryId, userId, userRole) => {
  let query = supabaseAdmin
    .from('deliveries')
    .select(`
      *,
      store_order:store_orders(
        *,
        store:stores(id, name, address, phone),
        order:orders!parent_order_id(id, customer_id, customer_snapshot)
      ),
      courier:couriers(
        profile_id, vehicle_type, vehicle_plate,
        profile:profiles(id, name, avatar_url, phone)
      )
    `)
    .eq('id', deliveryId);
  
  const { data: delivery, error } = await query.single();
  
  if (error || !delivery) {
    throw new NotFoundError('Delivery');
  }
  
  // Check authorization
  const isCustomer = delivery.store_order.order.customer_id === userId;
  const isStoreOwner = delivery.store_order.store.owner_id === userId;
  const isCourier = delivery.courier_id === userId;
  const isAdmin = ['admin', 'owner'].includes(userRole);
  
  if (!isCustomer && !isStoreOwner && !isCourier && !isAdmin) {
    throw new AppError('Not authorized to view this delivery', 403);
  }
  
  // Get live locations if in transit
  if (['picked_up', 'in_transit'].includes(delivery.status)) {
    const { data: locations } = await supabaseAdmin
      .from('courier_live_locations')
      .select('*')
      .eq('delivery_id', deliveryId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(100);
    
    delivery.live_locations = locations;
  }
  
  return delivery;
};

// Get courier's active deliveries
export const getCourierDeliveries = async (courierId, status = null) => {
  let query = supabaseAdmin
    .from('deliveries')
    .select(`
      *,
      store_order:store_orders(
        *,
        store:stores(id, name, address, phone),
        order:orders!parent_order_id(id, customer_id, customer_snapshot)
      )
    `)
    .eq('courier_id', courierId);
  
  if (status) {
    query = query.eq('status', status);
  }
  
  query = query.order('created_at', { ascending: false });
  
  const { data, error } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch deliveries: ${error.message}`, 500);
  }
  
  return data;
};

// Get store's deliveries
export const getStoreDeliveries = async (storeId, ownerId, filters = {}) => {
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
  
  let query = supabaseAdmin
    .from('deliveries')
    .select(`
      *,
      store_order:store_orders(
        *,
        store:stores(id, name),
        order:orders!parent_order_id(id, customer_id, customer_snapshot)
      ),
      courier:couriers(
        profile_id, vehicle_type,
        profile:profiles(id, name, avatar_url, phone)
      )
    `);
  
  // Join with store_orders to filter by store
  const { data: storeOrders } = await supabaseAdmin
    .from('store_orders')
    .select('id')
    .eq('store_id', storeId);
  
  const storeOrderIds = storeOrders.map(so => so.id);
  
  query = query.in('store_order_id', storeOrderIds);
  
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  
  query = query.order('created_at', { ascending: false });
  
  if (filters.limit) {
    query = query.limit(filters.limit);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch deliveries: ${error.message}`, 500);
  }
  
  return data;
};

// End courier shift (deactivate live tracking)
export const endCourierShift = async (courierId) => {
  // Deactivate all live locations for this courier
  await supabaseAdmin
    .from('courier_live_locations')
    .update({ is_active: false })
    .eq('courier_id', courierId)
    .eq('is_active', true);
  
  // Set courier as unavailable
  await supabaseAdmin
    .from('couriers')
    .update({ is_available: false })
    .eq('id', courierId);
  
  return { success: true };
};

// Get delivery route (using external routing service)
export const getDeliveryRoute = async (deliveryId) => {
  const { data: delivery } = await supabaseAdmin
    .from('deliveries')
    .select('pickup_coordinates, delivery_coordinates, route_geometry')
    .eq('id', deliveryId)
    .single();
  
  if (!delivery) {
    throw new NotFoundError('Delivery');
  }
  
  // If route already calculated, return it
  if (delivery.route_geometry) {
    return delivery.route_geometry;
  }
  
  // TODO: Call external routing API (OSRM, Google Maps, Mapbox)
  // For now, return straight line
  return {
    type: 'LineString',
    coordinates: [
      [delivery.pickup_coordinates.x, delivery.pickup_coordinates.y],
      [delivery.delivery_coordinates.x, delivery.delivery_coordinates.y]
    ]
  };
};

// Calculate distance and duration
export const calculateRoute = async (pickupLat, pickupLng, deliveryLat, deliveryLng) => {
  // TODO: Call external routing API
  // Using Haversine formula for straight-line distance
  const R = 6371; // Earth radius in km
  const dLat = (deliveryLat - pickupLat) * Math.PI / 180;
  const dLng = (deliveryLng - pickupLng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(pickupLat * Math.PI / 180) * Math.cos(deliveryLat * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  // Estimate duration (assuming 30 km/h average)
  const duration = Math.round((distance / 30) * 60); // minutes
  
  return { distance_km: distance, duration_min: duration };
};