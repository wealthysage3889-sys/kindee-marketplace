import { getConversationById } from './chatService.js';

// Approximate ("IP-based") customer location support.
//
// PRIVACY MODEL
// - Disabled by default. Nothing is recorded or sent to a third party unless
//   BOTH of these are set on the server after a privacy review:
//       IP_GEOLOCATION_ENABLED=true
//       IP_GEOLOCATION_CONSENT=acknowledged
// - Only the customer's IP is retained, in process memory, for a short TTL.
//   It is never written to the database, never logged, and never returned to
//   the browser. The client only ever receives coarse derived fields.
// - The owner-facing route/directions feature never uses these coordinates as a
//   delivery destination; they are displayed as an approximate, separate source.
//
// TRUSTED PROXY
// - The IP always comes from Express `req.ip`. When `TRUST_PROXY` is unset,
//   Express ignores forwarding headers and uses the socket address, so a
//   spoofed `X-Forwarded-For` cannot be trusted. Admins can opt in to a hop
//   count or CIDR list for deployments behind a known proxy.

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_MS = 10 * 60 * 1000;
const MAX_REGISTRY_ENTRIES = 5000;
const PROVIDER_TIMEOUT_MS = 3000;

const registry = new Map();
const lookupCache = new Map();

const readTtlMs = () => {
  const value = Number(process.env.IP_GEOLOCATION_TTL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_MS;
};

export const isIpGeolocationEnabled = () =>
  process.env.IP_GEOLOCATION_ENABLED === 'true' &&
  process.env.IP_GEOLOCATION_CONSENT === 'acknowledged';

export const resolveTrustProxy = (value = process.env.TRUST_PROXY) => {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  const raw = String(value).trim();
  if (raw === 'true') return 1;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // Express accepts a comma-separated CIDR/subnet list.
};

const normalizeIp = (value) => {
  if (typeof value !== 'string') return '';
  let ip = value.trim();
  if (!ip) return '';
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
  return ip;
};

const ipv4ToNumber = (ip) => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
};

const PRIVATE_IPV4_BLOCKS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT (mobile networks)
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPublicIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;

  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return false; // unique local fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return false; // link-local fe80::/10
    if (/^ff[0-9a-f]{2}:/.test(lower)) return false; // multicast
    return true;
  }

  const numeric = ipv4ToNumber(ip);
  if (numeric === null) return false;
  return !PRIVATE_IPV4_BLOCKS.some(([block, bits]) => {
    const base = ipv4ToNumber(block);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (numeric & mask) === (base & mask);
  });
}

// Express computes req.ip using the `trust proxy` setting configured in
// server.js. Never parse forwarding headers here: a browser can forge them.
export const getClientIp = (req) => normalizeIp(req?.ip || req?.socket?.remoteAddress || '');

export const recordCustomerIp = ({ profileId, role, ip, now = Date.now() }) => {
  if (!isIpGeolocationEnabled()) return false;
  if (!profileId || String(role || '').toLowerCase() !== 'customer') return false;
  const normalized = normalizeIp(ip);
  if (!isPublicIp(normalized)) return false;

  if (registry.size >= MAX_REGISTRY_ENTRIES) {
    const oldest = registry.keys().next().value;
    if (oldest !== undefined) registry.delete(oldest);
  }
  registry.set(String(profileId), { ip: normalized, observedAt: now });
  return true;
};

export const getRecordedCustomerIp = (profileId, now = Date.now()) => {
  if (!profileId) return null;
  const entry = registry.get(String(profileId));
  if (!entry) return null;
  if (now - entry.observedAt > readTtlMs()) {
    registry.delete(String(profileId));
    return null;
  }
  return entry;
};

export const __resetIpLocationState = () => {
  registry.clear();
  lookupCache.clear();
};

const geoResult = (fields) => ({
  available: true,
  reason: null,
  approximate: true,
  source: 'ip',
  privacy_note: 'Approximate location from IP address, not GPS.',
  ...fields,
});

export const lookupIpApproximate = async (ip, options = {}) => {
  const enabled = options.enabled ?? isIpGeolocationEnabled();
  if (!enabled) return { available: false, reason: 'disabled' };

  const normalized = normalizeIp(ip);
  if (!normalized) return { available: false, reason: 'missing_ip' };
  if (!isPublicIp(normalized)) return { available: false, reason: 'private_or_reserved_ip' };

  const provider = options.provider ?? process.env.IP_GEOLOCATION_PROVIDER ?? 'none';
  if (!provider || provider === 'none') {
    return { available: false, reason: 'provider_not_configured' };
  }
  if (provider !== 'ipwhois') {
    return { available: false, reason: 'provider_not_supported' };
  }

  const now = options.now ?? Date.now();
  const cacheTtl = options.cacheTtlMs ?? DEFAULT_CACHE_MS;
  const cached = lookupCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { available: false, reason: 'provider_error' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`https://ipwho.is/${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response?.ok) {
      return { available: false, reason: 'provider_error' };
    }
    const data = await response.json();
    if (!data || data.success === false) {
      lookupCache.set(normalized, {
        expiresAt: now + cacheTtl,
        result: { available: false, reason: 'provider_no_data' },
      });
      return { available: false, reason: 'provider_no_data' };
    }

    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { available: false, reason: 'provider_no_data' };
    }

    const security = data.security || {};
    const result = geoResult({
      country: data.country || null,
      country_code: data.country_code || null,
      region: data.region || null,
      city: data.city || null,
      latitude,
      longitude,
      accuracy_radius_km: Number.isFinite(Number(data.accuracy_radius))
        ? Number(data.accuracy_radius)
        : null,
      observed_at: new Date(now).toISOString(),
      provider,
      is_vpn: security.vpn === true || null,
      is_proxy: security.proxy === true || null,
      is_hosting: security.hosting === true || null,
      connection_type: data.connection?.type || null,
    });

    lookupCache.set(normalized, { expiresAt: now + cacheTtl, result });
    return result;
  } catch {
    return { available: false, reason: 'provider_error' };
  } finally {
    clearTimeout(timer);
  }
};

// Returns the approximate IP location of THIS conversation's customer. The
// caller must be a conversation member (chatService enforces it).
export const getConversationIpLocation = async (conversationId, userId, options = {}) => {
  const conversation = await getConversationById(conversationId, userId);

  const base = {
    conversation_id: conversationId,
    available: false,
    reason: null,
    approximate: true,
    source: 'ip',
  };

  if (!isIpGeolocationEnabled() && options.enabled === undefined) {
    return { ...base, reason: 'disabled' };
  }
  if (!conversation?.customer_id) {
    return { ...base, reason: 'no_customer_in_conversation' };
  }

  const observed = getRecordedCustomerIp(conversation.customer_id, options.now);
  if (!observed) {
    return { ...base, reason: 'no_recent_customer_location' };
  }

  const lookup = await lookupIpApproximate(observed.ip, options);
  return {
    ...base,
    ...lookup,
    conversation_id: conversationId,
    observed_at: lookup.available ? lookup.observed_at : new Date(observed.observedAt).toISOString(),
  };
};
