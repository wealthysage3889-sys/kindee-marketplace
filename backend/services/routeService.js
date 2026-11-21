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

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export const isValidLatLng = (lat, lng) =>
  isFiniteNumber(lat) && isFiniteNumber(lng) &&
  lat >= -90 && lat <= 90 &&
  lng >= -180 && lng <= 180 &&
  !(lat === 0 && lng === 0); // 0,0 is the classic "no GPS fix" value

// Accept the coordinate shapes this project has used over time:
//   {lat,lng}, {lat: "13.7", lng: "100.5"}, {x,y} (PostGIS point), [lng,lat],
//   "POINT(lng lat)", GeoJSON {type:"Point", coordinates:[lng,lat]}.
export function parseCoordinates(value) {
  if (!value) return null;

  if (typeof value === 'string') {
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

  const distanceMeters = haversineMeters(origin, destination);
  const durationMinutes = Math.max(1, Math.round((distanceMeters / 1000 / ESTIMATE_SPEED_KMH) * 60));

  return {
    ...result,
    available: true,
    distance_meters: distanceMeters,
    distance_km: Math.round(distanceMeters / 100) / 10,
    duration_minutes: durationMinutes,
    duration_source: 'estimated_30kmh',
    geometry: [
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ],
    navigation: buildNavigationLinks(origin, destination),
  };
};
