export const formatCurrency = (amount, currency = 'THB') => {
  if (amount === null || amount === undefined || isNaN(amount)) return '-';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(amount);
};

// Parses a price-like value coming from the API, which may be a number, a
// numeric string ("80"), null, undefined, "" or an invalid value.
// Returns a finite number, or null when no usable number was supplied.
const toFiniteNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return null;
};

// Mirrors backend utils/productPricing.js#resolveEffectivePrice and the cart's
// resolvePrice so the price shown on Home / ProductDetail always matches what
// the backend and the cart charge.
//   discount null/undefined/"" -> regular price
//   discount <= 0 (incl. 0)    -> regular price (never show a free item)
//   discount >= price          -> regular price
//   0 < discount < price       -> discount price + strikethrough original
// Accepts both `discountPrice` (camelCase) and `discount_price` (snake_case).
export const resolveProductPricing = (product) => {
  const price = toFiniteNumber(product?.price);
  const rawDiscount = product?.discountPrice ?? product?.discount_price;
  const discount = toFiniteNumber(rawDiscount);

  const regularPrice = price ?? 0;
  const hasDiscount =
    discount !== null &&
    regularPrice > 0 &&
    discount > 0 &&
    discount < regularPrice;

  const displayPrice = hasDiscount ? discount : regularPrice;
  const discountPercent = hasDiscount
    ? Math.round((1 - displayPrice / regularPrice) * 100)
    : 0;

  return {
    price: regularPrice,
    displayPrice,
    originalPrice: regularPrice,
    hasDiscount,
    discountPercent,
  };
};

export const formatDate = (dateStr, options = {}) => {
  if (!dateStr) return '-';
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok'
  };
  return new Intl.DateTimeFormat('th-TH', { ...defaultOptions, ...options }).format(new Date(dateStr));
};

export const formatRelativeTime = (dateStr) => {
  if (!dateStr) return '-';
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 60) return 'เธ•เธญเธเธเธตเน';
  if (diffMins < 60) return `${diffMins} เธเธฒเธ—เธตเธ—เธตเนเนเธฅเนเธง`;
  if (diffHours < 24) return `${diffHours} เธเธฑเนเธงเนเธกเธเธ—เธตเนเนเธฅเนเธง`;
  if (diffDays < 7) return `${diffDays} เธงเธฑเธเธ—เธตเนเนเธฅเนเธง`;
  
  return formatDate(dateStr, { hour: undefined, minute: undefined });
};

export const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Formats a delivery/customer address for display. Accepts either a plain
// string or an address object such as { name, phone, address, district, province, postalCode }.
// The backend stores delivery_address under customer_snapshot.address, where the street
// line may be stored under `address` or `street`.
export const formatAddress = (address) => {
  if (!address) return "";
  if (typeof address === "string") return address;
  const street = address.address || address.street || "";
  const parts = [street, address.district, address.province, address.postalCode].filter(Boolean);
  return parts.join(", ");
};

// Formats a customer snapshot (name, phone, address) into a single display string.
// Accepts an object { name, phone, address } or a plain string.
export const formatCustomerAddress = (snapshot) => {
  if (!snapshot) return "";
  if (typeof snapshot === "string") return snapshot;
  const parts = [snapshot.name, snapshot.phone, formatAddress(snapshot.address)].filter(Boolean);
  return parts.join(" | ");
};

export const formatThaiPhone = (phone) => {
  if (!phone) return '';
  const cleaned = phone.replace(/[-\s]/g, '');
  if (cleaned.startsWith('+66')) {
    return cleaned.replace('+66', '0');
  }
  // Format as 0XX-XXX-XXXX
  if (cleaned.length === 10) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  if (cleaned.length === 9) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  return cleaned;
};

export const validateThaiPhone = (phone) => {
  if (!phone) return false;
  const cleaned = phone.replace(/[-\s]/g, '');
  return /^(\+66|0)[0-9]{8,9}$/.test(cleaned);
};

export const validatePhone = (phone) => {
  if (!phone) return false;
  const cleaned = phone.replace(/[-\s]/g, '');
  // Thai numbers
  if (/^(\+66|0)[0-9]{8,9}$/.test(cleaned)) return true;
  // Myanmar numbers (mobile: 9 digits after +95/09, landline: varies)
  if (/^(\+95|09)[0-9]{7,10}$/.test(cleaned)) return true;
  return false;
};

export const formatPhone = (phone) => {
  if (!phone) return '';
  const cleaned = phone.replace(/[-\s]/g, '');
  // Thai numbers
  if (cleaned.startsWith('+66')) {
    return cleaned.replace('+66', '0').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  if (/^0[0-9]{9}$/.test(cleaned)) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  // Myanmar numbers
  if (cleaned.startsWith('+95')) {
    const national = cleaned.slice(3);
    return `+95 ${national.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3')}`;
  }
  if (/^09\d{8,9}$/.test(cleaned)) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  return cleaned;
};

export const toThaiDomesticPhone = (phone) => {
  if (!phone) return '';
  const cleaned = phone.replace(/[-\s]/g, '');
  if (cleaned.startsWith('+66')) {
    return cleaned.replace('+66', '0');
  }
  return cleaned;
};

export const formatPhoneForDisplay = (phone) => {
  if (!phone) return '';
  const cleaned = phone.replace(/[-\s]/g, '');
  if (cleaned.startsWith('+66')) {
    return cleaned.replace('+66', '0');
  }
  return cleaned;
};

let toastContainer = null;
let toastId = 0;

const createToastContainer = () => {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  toastContainer.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
};

export const showToast = (message, type = 'success') => {
  const container = createToastContainer();
  const id = ++toastId;
  const toast = document.createElement('div');
  toast.dataset.toastId = id;
  const bgColor = type === 'success' ? '#166534' : '#991b1b';
  const borderColor = type === 'success' ? '#22c55e' : '#ef4444';
  toast.style.cssText = `
    background: ${bgColor};
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    border: 1px solid ${borderColor};
    min-width: 200px;
    max-width: 320px;
    text-align: center;
    pointer-events: auto;
    animation: toastSlideIn 0.3s ease;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
  return id;
};

if (typeof document !== 'undefined' && !document.getElementById('toast-styles')) {
  const style = document.createElement('style');
  style.id = 'toast-styles';
  style.textContent = `
    @keyframes toastSlideIn {
      from { opacity: 0; transform: translateX(100px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes toastSlideOut {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(100px); }
    }
  `;
  document.head.appendChild(style);
}

// Validate phone number for a specific country
export const validatePhoneForCountry = (phone, countryCode) => {
  if (!phone) return false;
  const cleaned = phone.replace(/[-\s]/g, '');
  
  if (countryCode === 'TH') {
    // Thai: +66 or 0 followed by 8-9 digits (total 10-11 with leading 0)
    return /^(\+66|0)[0-9]{8,9}$/.test(cleaned);
  }
  if (countryCode === 'MM') {
    // Myanmar: +95 or 09 followed by 7-10 digits
    return /^(\+95|09)[0-9]{7,10}$/.test(cleaned);
  }
  return false;
};

export const generateSlug = (text) => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '-')
    .replace(/(^-|-$)+/g, '');
};

export const truncateText = (text, maxLength = 100) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
};

export const getInitials = (name) => {
  if (!name) return '?';
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

export const debounce = (fn, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

export const throttle = (fn, limit) => {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

export const classNames = (...classes) => {
  return classes.filter(Boolean).join(' ');
};

export const parseQueryString = (queryString) => {
  const params = new URLSearchParams(queryString);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
};

// Backend list endpoints respond with { success, data: { <listKey>, pagination } }
// and the response formatter also mirrors the array at data.data. Accept every
// documented shape so a valid payload is never dropped because of nesting.
export const extractList = (payload, listKey) => {
  const candidates = [
    payload?.[listKey],
    payload?.data?.[listKey],
    payload?.data?.data,
    Array.isArray(payload?.data) ? payload.data : undefined,
    Array.isArray(payload) ? payload : undefined,
  ];
  return candidates.find(Array.isArray) || [];
};

export const buildQueryString = (params) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value);
    }
  });
  return searchParams.toString();
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

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
};

export const downloadFile = (url, filename) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const getFileExtension = (filename) => {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase();
};

export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const isImageFile = (mimeType) => {
  return mimeType?.startsWith('image/');
};

export const isVideoFile = (mimeType) => {
  return mimeType?.startsWith('video/');
};

export const isAudioFile = (mimeType) => {
  return mimeType?.startsWith('audio/');
};

export const isPDFFile = (mimeType) => {
  return mimeType === 'application/pdf';
};

export const getMimeTypeIcon = (mimeType) => {
  if (isImageFile(mimeType)) return '🖼️';
  if (isVideoFile(mimeType)) return '🎬';
  if (isAudioFile(mimeType)) return '🎵';
  if (isPDFFile(mimeType)) return '📄';
  if (mimeType?.includes('word') || mimeType?.includes('document')) return '📝';
  if (mimeType?.includes('sheet') || mimeType?.includes('excel')) return '📊';
  if (mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return '📊';
  return '📄';
};