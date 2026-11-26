import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError } from '../middleware/errorHandler.js';

// Route detection for the in-chat "ดูเส้นทาง" feature.
//
// Rules:
//  - The origin is ALWAYS the store's own saved coordinate (stores.address.coordinates).
//    There is no default/fallback city centre: without a real store pin the route
//    is reported as unavailable instead of being guessed.
//  - The destination comes from data that actually belongs to this conversation:
//      1. the linked store order's verified GPS snapshot (customer_destinations),
//      2. the linked order's saved delivery address coordinates,
//      3. the most recent location the customer shared in THIS chat.
//    Coordinates that fail range validation are ignored, never repaired.
//  - Both points must be present and valid; otherwise `available:false` with a
//    machine-readable `reason` so the UI can hide the button.

const EARTH_RADIUS_M = 6371000;
const ESTIMATE_SPEED_KMH = 30;

// OSRM (Open Source Routing Machine) - ถนนจริงจาก OpenStreetMap, โปรไฟล์ driving.
// ใช้ผ่าน Backend เท่านั้น ไม่เปิดเผย API Key ใน Frontend (ไม่จำเป็นต้องมี Key สำหรับ
// เซิร์ฟเวอร์เดโมสาธารณะ แต่ระบบ production ควรโฮสต์ OSRM เองเนื่องจากเซิร์ฟเวอร์
// เดโมมีอัตราการเรียกใช้จำกัดและไม่รับประกันความพร้อมใช้งาน).
const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
const OSRM_PROFILE = 'driving';
const OSRM_TIMEOUT_MS = 15000;
const OSRM_CACHE_TTL_MS = 5 * 60 * 1000;
const osrmRouteCache = new Map();

function osrmCacheKey(origin, destination) {
  return `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}|${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}`;
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// OSRM ส่งคืนพิกัดเป็น [lng, lat] แปลงเป็น [lat, lng] สำหรับ Leaflet / แผนที่
function toLatLng(coord) {
  return [coord[1], coord[0]];
}

// เรียก OSRM เพื่อขอเส้นทางขับรถจริง ระยะทาง และเวลาเดินทาง
// คืนค่า { geometry: [[lat,lng],...], distance_meters, duration_minutes, duration_seconds,
//         duration_source: 'osrm', routes: [...], waypoints: [...] }
// หรือ { error: string } หากผู้ให้บริการใช้งานไม่ได้
async function callOsrmRoute(origin, destination) {
  if (!isValidLatLng(origin.lat, origin.lng) || !isValidLatLng(destination.lat, destination.lng)) {
    return { error: 'พิกัดต้นทางหรือปลายทางไม่ถูกต้อง' };
  }

  const key = osrmCacheKey(origin, destination);
  const now = Date.now();
  const cached = osrmRouteCache.get(key);
  if (cached && now - cached.ts < OSRM_CACHE_TTL_MS) {
    return cached.value;
  }

  const originParam = encodeURIComponent(`${origin.lng},${origin.lat}`);
  const destinationParam = encodeURIComponent(`${destination.lng},${destination.lat}`);
  const url = `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${originParam};${destinationParam}?overview=full&geometries=geojson&steps=true&alternatives=true`;

  let result;
  try {
    const response = await fetchWithTimeout(url, OSRM_TIMEOUT_MS);
    if (!response.ok) throw new Error(`OSRM ตอบสนองผิดพลาด (HTTP ${response.status})`);
    const data = await response.json();
    if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
      if (process.env.NODE_ENV !== 'production') console.debug('[OSRM] not ok', { code: data.code, routes: data.routes?.length });
      throw new Error(data.message || 'OSRM ไม่พบเส้นทางที่ใช้งานได้');
    }

    const routes = data.routes.map((route) => ({
      geometry: (route.geometry.coordinates || []).map(toLatLng),
      distance_meters: Math.round(Number(route.distance) || 0),
      duration_seconds: Math.round(Number(route.duration) || 0),
      duration_minutes: Math.max(1, Math.round((Number(route.duration) || 0) / 60)),
      duration_source: 'osrm',
    }));

    if (process.env.NODE_ENV !== 'production') console.debug('[OSRM] success', { httpStatus: response.status, code: data.code, coords: data.routes[0].geometry.coordinates.length, distance: data.routes[0].distance, duration: data.routes[0].duration });

    result = {
      ...routes[0],
      routes,
      waypoints: (data.waypoints || []).map((wp) => ({
        location: [wp.location[1], wp.location[0]],
        name: wp.name || '',
      })),
    };
  } catch (error) {
    result = { error: error.message || 'ไม่สามารถคำนวณเส้นทางถนนจริงได้ในขณะนี้' };
  }

  osrmRouteCache.set(key, { ts: now, value: result });
  return result;
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export const isValidLatLng = (lat, lng) =>
  isFiniteNumber(lat) && isFiniteNumber(lng) &&
  lat >= -90 && lat <= 90 &&
  lng >= -180 && lng <= 180 &&
  !(lat === 0 && lng === 0); // 0,0 is the classic "no GPS fix" value

// Accept the coordinate shapes this project has used over time:
//   {lat,lng}, {lat: "13.7", lng: "100.5"}, {x,y} (PostGIS point), [lng,lat],
//   "POINT(lng lat)", GeoJSON {type:"Point", coordinates:[lng,lat]}.
function parseEwkbHex(value) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]+$/.test(value) || value.length < 42) return null;
  const buf = Buffer.from(value, 'hex');
  if (buf.length < 25) return null;
  const endian = buf.readUInt8(0);
  if (endian !== 1) return null;
  const type = buf.readUInt32LE(1);
  if ((type & 0x000000ff) !== 1) return null;
  let off = 5;
  if (type & 0x20000000) off += 4;
  if (buf.length < off + 16) return null;
  const lng = buf.readDoubleLE(off);
  const lat = buf.readDoubleLE(off + 8);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

export function parseCoordinates(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const hex = parseEwkbHex(value);
    if (hex) return hex;
    const match = value.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
    if (!match) return null;
    const lng = Number(match[1]);
    const lat = Number(match[2]);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  }

  if (Array.isArray(value)) {
    const [lng, lat] = value.map(Number);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  }

  if (typeof value === 'object') {
    if (value.type === 'Point' && Array.isArray(value.coordinates)) {
      return parseCoordinates(value.coordinates);
    }
    const lat = Number(value.lat ?? value.latitude ?? value.y);
    const lng = Number(value.lng ?? value.lon ?? value.longitude ?? value.x);
    if (value.lat === undefined && value.latitude === undefined && value.y === undefined) return null;
    if (value.lng === undefined && value.lon === undefined && value.longitude === undefined && value.x === undefined) return null;
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  }

  return null;
}

function parseAddressCoordinates(address) {
  if (!address || typeof address !== 'object') return null;
  return parseCoordinates(address.coordinates);
}

function formatAddress(address) {
  if (!address || typeof address !== 'object') return '';
  const parts = [
    address.name,
    address.address,
    address.street,
    address.subdistrict,
    address.district,
    address.province,
    address.postal_code || address.postalCode,
  ].filter((part) => typeof part === 'string' && part.trim());
  return [...new Set(parts)].join(' ');
}

function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

function buildNavigationLinks(origin, destination) {
  const originParam = `${origin.lat},${origin.lng}`;
  const destinationParam = `${destination.lat},${destination.lng}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destinationParam}&travelmode=driving`,
    apple: `https://maps.apple.com/?saddr=${originParam}&daddr=${destinationParam}&dirflg=d`,
    osm: `https://www.openstreetmap.org/directions?route=${origin.lat},${origin.lng};${destination.lat},${destination.lng}`,
  };
}

const MEMBERSHIP_REQUIRED = 'Not a member of this conversation';

async function assertMembership(conversationId, userId) {
  const { data: member } = await supabaseAdmin
    .from('conversation_members')
    .select('id, profile_id, joined_at')
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId)
    .is('left_at', null)
    .maybeSingle();
  if (!member) {
    throw new AppError(MEMBERSHIP_REQUIRED, 403);
  }
  return member;
}

async function loadConversation(conversationId) {
  const { data: conversation, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !conversation) {
    throw new NotFoundError('Conversation');
  }
  return conversation;
}

// Resolve the store order that belongs to this conversation. Only same-store
// orders for the conversation's customer are eligible, so an unrelated order can
// never supply a delivery location.
async function resolveLinkedStoreOrder(conversation) {
  if (!conversation.store_id) return null;

  if (conversation.store_order_id) {
    const { data: storeOrder } = await supabaseAdmin
      .from('store_orders')
      .select('*')
      .eq('id', conversation.store_order_id)
      .maybeSingle();
    if (storeOrder && String(storeOrder.store_id) === String(conversation.store_id)) {
      return storeOrder;
    }
    return null;
  }

  if (!conversation.customer_id) return null;

  const { data: candidates } = await supabaseAdmin
    .from('store_orders')
    .select('*')
    .eq('store_id', conversation.store_id)
    .order('created_at', { ascending: false })
    .limit(20);

  const rows = (candidates || []).filter((row) => row.parent_order_id);
  if (rows.length === 0) return null;

  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, customer_id')
    .in('id', [...new Set(rows.map((row) => row.parent_order_id))]);

  const orderByCustomer = new Map(
    (orders || [])
      .filter((order) => String(order.customer_id) === String(conversation.customer_id))
      .map((order) => [String(order.id), order])
  );

  return rows.find((row) => orderByCustomer.has(String(row.parent_order_id))) || null;
}

async function loadParentOrder(storeOrder) {
  if (!storeOrder?.parent_order_id) return null;
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_id, customer_snapshot')
    .eq('id', storeOrder.parent_order_id)
    .maybeSingle();
  return order || null;
}

async function loadOrderGpsSnapshot(orderId) {
  if (!orderId) return null;
  const { data: destination } = await supabaseAdmin
    .from('customer_destinations')
    .select('coordinates, address, place_name, is_verified')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!destination) return null;

  const coordinates = parseCoordinates(destination.coordinates);
  if (!coordinates) return null;

  return {
    ...coordinates,
    label: destination.place_name || formatAddress(destination.address) || 'ตำแหน่งจัดส่งจากคำสั่งซื้อ',
    address: formatAddress(destination.address),
    verified: destination.is_verified === true,
  };
}

// The most recent location the *customer* shared in this chat. Messages from
// store staff are never used as the delivery destination.
async function loadLatestSharedLocation(conversation) {
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('id, sender_id, metadata, created_at, type, is_deleted')
    .eq('conversation_id', conversation.id)
    .eq('type', 'location')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(10);

  for (const message of messages || []) {
    if (conversation.customer_id && String(message.sender_id) !== String(conversation.customer_id)) {
      continue;
    }
    const metadata = message.metadata || {};
    const coordinates =
      parseCoordinates(metadata.location) ||
      parseCoordinates(metadata.coordinates) ||
      parseCoordinates(metadata) ||
      (metadata.lat !== undefined || metadata.latitude !== undefined
        ? parseCoordinates({ lat: metadata.lat ?? metadata.latitude, lng: metadata.lng ?? metadata.longitude })
        : null);
    if (!coordinates) continue;

    return {
      ...coordinates,
      label: metadata.label || metadata.place_name || 'ตำแหน่งที่ลูกค้าแชร์ในแชท',
      address: metadata.address || '',
      verified: false,
      message_id: message.id,
      shared_at: message.created_at,
    };
  }

  return null;
}

async function resolveDestination(conversation, storeOrder) {
  const order = await loadParentOrder(storeOrder);

  if (order) {
    const snapshot = await loadOrderGpsSnapshot(order.id);
    if (snapshot) {
      return { ...snapshot, source: 'order_gps', order_number: order.order_number || storeOrder.store_order_number };
    }

    const snapshotAddress = order.customer_snapshot?.address;
    const addressCoordinates = parseAddressCoordinates(snapshotAddress);
    if (addressCoordinates) {
      return {
        ...addressCoordinates,
        label: formatAddress(snapshotAddress) || 'ที่อยู่จัดส่งจากคำสั่งซื้อ',
        address: formatAddress(snapshotAddress),
        verified: false,
        source: 'order_address',
        order_number: order.order_number || storeOrder.store_order_number,
      };
    }
  }

  const shared = await loadLatestSharedLocation(conversation);
  if (shared) {
    return { ...shared, source: 'chat_location', order_number: storeOrder?.store_order_number || null };
  }

  return null;
}

export const getConversationRoute = async (conversationId, userId) => {
  const conversation = await loadConversation(conversationId);
  await assertMembership(conversationId, userId);

  const base = {
    conversation_id: conversationId,
    store_order_id: conversation.store_order_id || null,
    available: false,
    reason: null,
    origin: null,
    destination: null,
    distance_meters: null,
    distance_km: null,
    duration_minutes: null,
    geometry: null,
    navigation: null,
  };

  if (!conversation.store_id) {
    return { ...base, reason: 'no_store' };
  }

  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, name, address')
    .eq('id', conversation.store_id)
    .maybeSingle();

  if (!store) {
    return { ...base, reason: 'no_store' };
  }

  const originCoordinates = parseAddressCoordinates(store.address);
  const origin = originCoordinates
    ? {
        ...originCoordinates,
        label: store.name || 'ร้านค้า',
        address: formatAddress(store.address),
        source: 'store_address',
      }
    : null;

  const storeOrder = await resolveLinkedStoreOrder(conversation);
  const destination = await resolveDestination(conversation, storeOrder);

  const result = {
    ...base,
    store: { id: store.id, name: store.name || 'ร้านค้า' },
    store_order_id: storeOrder?.id || conversation.store_order_id || null,
    order_number: destination?.order_number || storeOrder?.store_order_number || null,
    origin,
    destination: destination
      ? {
          lat: destination.lat,
          lng: destination.lng,
          label: destination.label,
          address: destination.address,
          source: destination.source,
          verified: destination.verified === true,
          ...(destination.message_id ? { message_id: destination.message_id } : {}),
        }
      : null,
  };

  if (!origin) {
    return { ...result, reason: 'missing_store_location' };
  }
  if (!destination) {
    return { ...result, reason: 'missing_destination_location' };
  }

  const osrm = await callOsrmRoute(origin, destination);
  const osrmOk = Boolean(osrm && osrm.geometry && !osrm.error);

  let distanceMeters, durationMinutes, durationSource, geometry, routingSource, routingError, routes;

  if (osrmOk) {
    distanceMeters = osrm.distance_meters;
    durationMinutes = osrm.duration_minutes;
    durationSource = 'osrm';
    geometry = osrm.geometry;
    routingSource = 'osrm';
    routes = osrm.routes;
  } else {
    routingError = osrm?.error || 'ไม่สามารถเชื่อมต่อบริการคำนวณเส้นทางถนนได้';
    distanceMeters = haversineMeters(origin, destination);
    durationMinutes = null;
    durationSource = null;
    geometry = [
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ];
    routingSource = 'straight_line';
    routes = null;
  }

  return {
    ...result,
    available: true,
    routing_source: routingSource,
    routing_error: routingError,
    routes,
    distance_meters: distanceMeters,
    distance_km: Math.round(distanceMeters / 100) / 10,
    duration_minutes: durationMinutes,
    duration_source: durationSource,
    geometry,
    navigation: buildNavigationLinks(origin, destination),
  };
};

// Order-based route lookup: resolves a delivery route directly from a parent
// order id without requiring a conversation. Used by OrderRouteMapModal when
// opened from an Order Card where the conversation-to-order linkage may be
// missing or stale. Access control is enforced by the caller (route handler).
export const getOrderRoute = async (orderId, userId, userRole) => {
  const role = String(userRole || '').toLowerCase();

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_id, customer_snapshot')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    throw new NotFoundError('Order');
  }

  // Access control (deny by default): admin/owner see any order; customer only
  // their own; seller only orders that have store_orders for their store. Any
  // other role is rejected so customer location data is never exposed.
  if (role === 'customer') {
    if (String(order.customer_id) !== String(userId)) {
      throw new AppError('Not authorized to view this order route', 403);
    }
  } else if (role === 'seller') {
    const { data: storeOrders } = await supabaseAdmin
      .from('store_orders')
      .select('id, store:stores!store_id(owner_id)')
      .eq('parent_order_id', orderId);
    const ownsStoreOrder = (storeOrders || []).some(
      (so) => so.store && String(so.store.owner_id) === String(userId)
    );
    if (!ownsStoreOrder) {
      throw new AppError('Not authorized to view this order route', 403);
    }
  } else if (role !== 'admin' && role !== 'owner') {
    throw new AppError('Not authorized to view this order route', 403);
  }

  const base = {
    conversation_id: null,
    store_order_id: null,
    available: false,
    reason: null,
    origin: null,
    destination: null,
    distance_meters: null,
    distance_km: null,
    duration_minutes: null,
    geometry: null,
    navigation: null,
    order_number: order.order_number || null,
    store: null,
  };

  // Find the first store for this order (for origin coordinates).
  const { data: storeOrders } = await supabaseAdmin
    .from('store_orders')
    .select('store_id')
    .eq('parent_order_id', orderId)
    .limit(1);

  let store = null;
  if (storeOrders && storeOrders.length > 0) {
    const { data: s } = await supabaseAdmin
      .from('stores')
      .select('id, name, address')
      .eq('id', storeOrders[0].store_id)
      .maybeSingle();
    store = s;
  }

  if (!store) {
    return { ...base, reason: 'no_store' };
  }

  base.store = { id: store.id, name: store.name || 'ร้านค้า' };

  const originCoordinates = parseAddressCoordinates(store.address);
  const origin = originCoordinates
    ? {
        ...originCoordinates,
        label: store.name || 'ร้านค้า',
        address: formatAddress(store.address),
        source: 'store_address',
      }
    : null;

  // Try customer_destinations first (GPS from order).
  let destination = null;
  const { data: dest } = await supabaseAdmin
    .from('customer_destinations')
    .select('coordinates, address, place_name, is_verified')
    .eq('order_id', orderId)
    .maybeSingle();

  if (dest) {
    const coords = parseCoordinates(dest.coordinates);
    if (coords) {
      destination = {
        ...coords,
        label: dest.place_name || formatAddress(dest.address) || 'ตำแหน่งจัดส่งจากคำสั่งซื้อ',
        address: formatAddress(dest.address),
        verified: dest.is_verified === true,
        source: 'order_gps',
        order_number: order.order_number || null,
      };
    }
  }

  // Fall back to customer_snapshot.address.coordinates.
  if (!destination) {
    const snapshotAddress = order.customer_snapshot?.address;
    const addressCoords = parseAddressCoordinates(snapshotAddress);
    if (addressCoords) {
      destination = {
        ...addressCoords,
        label: formatAddress(snapshotAddress) || 'ที่อยู่จัดส่งจากคำสั่งซื้อ',
        address: formatAddress(snapshotAddress),
        verified: false,
        source: 'order_address',
        order_number: order.order_number || null,
      };
    }
  }

  const result = {
    ...base,
    origin,
    destination: destination
      ? {
          lat: destination.lat,
          lng: destination.lng,
          label: destination.label,
          address: destination.address,
          source: destination.source,
          verified: destination.verified === true,
          order_number: destination.order_number,
        }
      : null,
  };

  if (!origin) {
    return { ...result, reason: 'missing_store_location' };
  }
  if (!destination) {
    return { ...result, reason: 'missing_destination_location' };
  }

  const osrm = await callOsrmRoute(origin, destination);
  const osrmOk = Boolean(osrm && osrm.geometry && !osrm.error);

  let distanceMeters, durationMinutes, durationSource, geometry, routingSource, routingError, routes;

  if (osrmOk) {
    distanceMeters = osrm.distance_meters;
    durationMinutes = osrm.duration_minutes;
    durationSource = 'osrm';
    geometry = osrm.geometry;
    routingSource = 'osrm';
    routes = osrm.routes;
  } else {
    routingError = osrm?.error || 'ไม่สามารถเชื่อมต่อบริการคำนวณเส้นทางถนนได้';
    distanceMeters = haversineMeters(origin, destination);
    durationMinutes = null;
    durationSource = null;
    geometry = [
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ];
    routingSource = 'straight_line';
    routes = null;
  }

  return {
    ...result,
    available: true,
    routing_source: routingSource,
    routing_error: routingError,
    routes,
    distance_meters: distanceMeters,
    distance_km: Math.round(distanceMeters / 100) / 10,
    duration_minutes: durationMinutes,
    duration_source: durationSource,
    geometry,
    navigation: buildNavigationLinks(origin, destination),
  };
};
