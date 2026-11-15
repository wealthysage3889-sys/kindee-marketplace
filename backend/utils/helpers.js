import slugify from 'slugify';

export { slugify };

export const generateSlug = (text) => {
  return slugify(text, {
    lower: true,
    strict: true,
    locale: 'th'
  });
};

export const formatCurrency = (amount, currency = 'THB') => {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(amount);
};

export const formatDate = (date, options = {}) => {
  const defaultOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok'
  };
  
  return new Intl.DateTimeFormat('th-TH', { ...defaultOptions, ...options }).format(new Date(date));
};

export const formatRelativeTime = (date) => {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 60) return 'ตอนนี้';
  if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
  if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;
  if (diffDays < 7) return `${diffDays} วันที่แล้ว`;
  
  return formatDate(date, { hour: undefined, minute: undefined });
};

export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const generateOrderNumber = (prefix = 'ORD') => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `${prefix}${datePart}${randomPart}`;
};

export const paginate = (page = 1, limit = 20) => {
  const parsedPage = Math.max(1, parseInt(page));
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (parsedPage - 1) * parsedLimit;
  
  return { page: parsedPage, limit: parsedLimit, offset };
};

export const buildSearchQuery = (search, fields) => {
  if (!search || !fields.length) return null;
  
  return fields.map(field => `${field}.ilike.%${search}%`).join(',');
};

export const sanitizeHtml = (html) => {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\//g, '&#x2F;');
};

export const validateThaiPhone = (phone) => {
  const cleaned = phone.replace(/[-\s]/g, '');
  return /^(\+66|0)[0-9]{8,9}$/.test(cleaned);
};

export const formatThaiPhone = (phone) => {
  const cleaned = phone.replace(/[-\s]/g, '');
  if (cleaned.startsWith('+66')) {
    return cleaned.replace('+66', '0');
  }
  return cleaned;
};

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const retry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
};