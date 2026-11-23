// Delivery-based grouping for the seller/admin order table.
//
// The old grouping merged orders that shared a payment-slip `submission_id`
// (i.e. one checkout). That is the wrong unit for fulfilment: a shop delivers
// to a PLACE, not to a checkout. Orders must be grouped by the real delivery
// target so one row == one recipient + one delivery address + one store, even
// when the customer checked out several times.
//
// Group key = customer account + normalized delivery address + store.
// Orders are only merged when every part of that key is present and equal.
// Anything missing (no customer_id, no delivery address, no store) is kept as a
// standalone row and reported as incomplete instead of being guessed into a
// group. COD never merges with anything. Delivered/Cancelled never merge with
// in-progress orders.

export const IN_PROGRESS_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
];

export const DELIVERED_STATUSES = ["delivered"];

export const INACTIVE_STATUSES = ["cancelled", "refunded", "failed"];

// Status bucket used only to keep lifecycle stages apart when grouping.
// Delivered and Cancelled must never merge with in-progress orders.
export const STATUS_BUCKETS = {
  in_progress: IN_PROGRESS_STATUSES,
  delivered: DELIVERED_STATUSES,
  inactive: INACTIVE_STATUSES,
};

export function getStatusBucket(status) {
  if (IN_PROGRESS_STATUSES.includes(status)) return "in_progress";
  if (DELIVERED_STATUSES.includes(status)) return "delivered";
  if (INACTIVE_STATUSES.includes(status)) return "inactive";
  return "other";
}

// Customer account id. Prefer the FK column; fall back to the joined profile.
// Never uses name or phone: those are not a reliable account identifier.
export function getCustomerId(order) {
  if (!order) return null;
  const id = order.customer_id || order.customer?.id || null;
  return id ? String(id) : null;
}

// Normalize an address value into a canonical string for comparison.
// Collapses whitespace, strips punctuation, lowercases and removes spaces so
// "123/45 Moo 1, Phra Nakhon" and "123/45 Moo 1 Phra Nakhon" compare equal.
export function normalizeAddressPart(value) {
  if (value === null || value === undefined) return "";
  let text = String(value).trim().toLowerCase();
  if (!text) return "";
  try {
    text = text.normalize("NFKC");
  } catch {
    // normalize is unavailable in very old engines; ignore.
  }
  text = text.replace(/[\s\u00a0]+/g, "");
  text = text.replace(/[^\p{L}\p{N}]/gu, "");
  return text;
}

// Build a stable delivery-address key from an address object or string.
// Includes the recipient name + phone when present, but those are only used
// together with the street/district/province/postal parts, never alone.
export function buildAddressKey(address) {
  if (!address) return "";
  if (typeof address === "string") {
    return normalizeAddressPart(address);
  }
  const street = address.address ?? address.street ?? "";
  const parts = [
    address.name,
    address.phone,
    street,
    address.district,
    address.province,
    address.postalCode,
    address.place_name,
  ];
  return parts.map(normalizeAddressPart).filter(Boolean).join("|");
}

// Extract the delivery address for an order.
// Primary source is the order-time snapshot (customer_snapshot.address), which
// is exactly the address the order will be delivered to.
export function getOrderDeliveryAddress(order) {
  if (!order) return null;
  const snapshotAddress = order.customer_snapshot?.address;
  if (snapshotAddress) return snapshotAddress;
  // Fallback: a delivery row on any store order.
  const storeOrders = Array.isArray(order.store_orders) ? order.store_orders : [];
  for (const so of storeOrders) {
    const deliveryAddress = so?.delivery?.delivery_address;
    if (deliveryAddress) return deliveryAddress;
  }
  return null;
}

// Store identity for one order: the set of stores it fulfils from.
// Uses store_id when available (falls back to store name). Returns a sorted,
// de-duplicated key so two orders count as the same store set regardless of
// the order their store_orders were loaded in.
export function getOrderStoreKeys(order) {
  const storeOrders = Array.isArray(order?.store_orders) ? order.store_orders : [];
  const keys = new Set();
  for (const so of storeOrders) {
    const store = so?.store || so?.store_snapshot || {};
    const id = store?.id;
    if (id) {
      keys.add(`id:${id}`);
      continue;
    }
    const name = normalizeAddressPart(store?.name);
    if (name) keys.add(`name:${name}`);
  }
  return Array.from(keys).sort();
}

function sameStoreSet(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function interleaveStoreSets(storeKeys) {
  const seen = new Set();
  const merged = [];
  for (const list of storeKeys) {
    for (const key of list) {
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(key);
      }
    }
  }
  return merged.sort();
}

// Group orders by delivery target.
// Returns { groups, incomplete } where `incomplete` lists orders that could
// not be safely grouped because the account, address or store is missing.
export function groupOrdersForDelivery(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const groups = [];
  const incomplete = [];

  for (const order of list) {
    if (!order || !order.id) {
      incomplete.push({ order, reasons: ["missing_order_id"] });
      continue;
    }

    // COD is always its own row, never merged with anything.
    if (order.payment_method === "cod") {
      groups.push({
        id: `order-${order.id}`,
        key: `cod:${order.id}`,
        orders: [order],
        primaryOrder: order,
        isGroup: false,
        statusBucket: getStatusBucket(order.status),
      });
      continue;
    }

    const reasons = [];
    const customerId = getCustomerId(order);
    if (!customerId) reasons.push("missing_customer_id");

    const address = getOrderDeliveryAddress(order);
    const addressKey = buildAddressKey(address);
    if (!addressKey) reasons.push("missing_delivery_address");

    const storeKeys = getOrderStoreKeys(order);
    if (storeKeys.length === 0) reasons.push("missing_store");

    if (reasons.length > 0) {
      // Incomplete data: keep this order standalone instead of guessing a
      // group key that could merge unrelated deliveries.
      incomplete.push({ order, reasons });
      groups.push({
        id: `order-${order.id}`,
        key: `order:${order.id}`,
        orders: [order],
        primaryOrder: order,
        isGroup: false,
        statusBucket: getStatusBucket(order.status),
      });
      continue;
    }

    const statusBucket = getStatusBucket(order.status);
    // Store-set is part of the key, so orders that draw from different store
    // sets stay in separate groups. The merge check below is a safety net for
    // the case where one store set is a subset of another.
    const key = [customerId, addressKey, statusBucket, storeKeys.join(",")].join("::");
    const existing = groups.find(
      (g) =>
        g.statusBucket === statusBucket &&
        g.customerId === customerId &&
        g.addressKey === addressKey &&
        sameStoreSet(g.storeKeys, storeKeys)
    );

    if (existing) {
      existing.orders.push(order);
      existing.storeKeys = interleaveStoreSets([existing.storeKeys, storeKeys]);
      existing.isGroup = existing.orders.length > 1;
      // Keep the newest order as the headline order number.
      if (isNewer(order, existing.primaryOrder)) {
        existing.primaryOrder = order;
      }
    } else {
      groups.push({
        id: `grp-${order.id}`,
        key,
        customerId,
        addressKey,
        storeKeys,
        statusBucket,
        orders: [order],
        primaryOrder: order,
        isGroup: false,
      });
    }
  }

  return { groups, incomplete };
}

function isNewer(candidate, current) {
  const a = Date.parse(candidate?.created_at) || 0;
  const b = Date.parse(current?.created_at) || 0;
  return a > b;
}

// Sum of member order totals (each order counted once).
export function getGroupTotal(group) {
  return (group?.orders || []).reduce(
    (sum, order) => sum + (Number(order?.total_amount) || 0),
    0
  );
}

// Unique store names across every member order.
export function getGroupStoreNames(group) {
  const names = new Set();
  for (const order of group?.orders || []) {
    for (const so of Array.isArray(order?.store_orders) ? order.store_orders : []) {
      const name = so?.store?.name || so?.store_snapshot?.name;
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

// Distinct statuses across the group, in first-seen order.
export function getGroupStatuses(group) {
  const seen = new Set();
  const result = [];
  for (const order of group?.orders || []) {
    const status = order?.status;
    if (status && !seen.has(status)) {
      seen.add(status);
      result.push(status);
    }
  }
  return result;
}

// Distinct payment statuses across the group, in first-seen order.
export function getGroupPaymentStatuses(group) {
  const seen = new Set();
  const result = [];
  for (const order of group?.orders || []) {
    const status = order?.payment_status;
    if (status && !seen.has(status)) {
      seen.add(status);
      result.push(status);
    }
  }
  return result;
}

// Whether every member order in the group has the same payment status.
export function hasMixedPaymentStatuses(group) {
  if (!group || !group.isGroup) return false;
  return getGroupPaymentStatuses(group).length > 1;
}

// Whether the group's member orders are not all in the same status.
export function hasMixedStatuses(group) {
  if (!group || !group.isGroup) return false;
  return getGroupStatuses(group).length > 1;
}