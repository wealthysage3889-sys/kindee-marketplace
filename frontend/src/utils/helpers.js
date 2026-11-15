export const formatCurrency = (amount, currency = 'THB') => {
  if (amount === null || amount === undefined || isNaN(amount)) return '-';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(amount);
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