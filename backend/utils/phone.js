// Thai phone number validation used by the store, auth and order routes.
//
// `express-validator`'s `isMobilePhone('th-TH')` rejects perfectly valid 10-digit
// Thai numbers that start with 0 (for example `0978929968`). This module
// replaces that check with an explicit rule set so legitimate Thai numbers are
// accepted while obviously malformed values (letters, wrong digit count,
// unknown country code) are still rejected.

const TH_MOBILE_PREFIXES = ['06', '08', '09', '01'];
const TH_LANDLINE_PREFIXES = ['02', '03', '04', '05', '07'];

// Normalizes a raw phone input into a canonical Thai format, or returns null
// when the value is not a recognizable Thai phone number.
//
// Accepted inputs:
//   - 10-digit domestic number starting with 0, e.g. `0978929968`
//   - 11-digit domestic number starting with 0, e.g. `09789299668`
//     (kept for backwards compatibility with legacy stored values)
//   - Domestic number with dashes/spaces, e.g. `097-892-9968`
//   - International `+66` format, e.g. `+66978929968`
//   - International `0066` format, e.g. `0066978929968`
export const normalizeThaiPhone = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') value = String(value);
  const trimmed = value.trim();
  if (trimmed === '') return null;

  let digits = trimmed.replace(/[^0-9+]/g, '');
  let international = false;

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
    international = true;
  }
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }

  if (international) {
    // Country code 66 followed by 9 digits (the leading 0 is dropped).
    if (!/^66\d{9}$/.test(digits)) return null;
    return `+66${digits.slice(2)}`;
  }

  // Domestic format: 10 or 11 digits starting with 0.
  if (!/^0\d{9,10}$/.test(digits)) return null;

  const prefix = digits.slice(0, 2);
  const isMobile = TH_MOBILE_PREFIXES.includes(prefix);
  const isLandline = TH_LANDLINE_PREFIXES.includes(prefix);
  if (!isMobile && !isLandline) return null;

  return digits;
};

// express-validator compatible predicate. Returns true when the value is a
// valid Thai phone number (or empty/undefined when the field is optional).
export const isThaiPhoneValid = (value) => {
  if (value === undefined || value === null || value === '') return true;
  return normalizeThaiPhone(value) !== null;
};

// Custom express-validator rule that throws when the phone is malformed.
export const validateThaiPhone = (value) => {
  if (isThaiPhoneValid(value)) return true;
  throw new Error('Invalid phone');
};

// Convert a valid Thai phone number to E.164 format (+66XXXXXXXXX).
// Returns the E.164 string, or null if the input is not a recognizable Thai phone number.
export const toE164ThaiPhone = (value) => {
  const normalized = normalizeThaiPhone(value);
  if (!normalized) return null;

  // If already in E.164 format (+66...), return as-is
  if (normalized.startsWith('+66')) return normalized;

  // Domestic format (0XXXXXXXXX) -> convert to E.164
  // Remove leading 0 and prepend +66
  if (normalized.startsWith('0')) {
    return `+66${normalized.slice(1)}`;
  }

  return null;
};

// Myanmar phone normalization for E.164 format (+95XXXXXXXXX).
//
// Accepted inputs:
//   - E.164: +95 followed by mobile prefix 9 and 7-9 subscriber digits
//     (e.g. +959252788463; national significant number is 8-10 digits)
//   - Domestic Myanmar mobile: 09XXXXXXXX (10-11 digits starting with 09)
//   - With dashes/spaces
//
// Returns E.164 string (+95...) or null.
export const normalizeMyanmarPhone = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') value = String(value);
  const trimmed = value.trim();
  if (trimmed === '') return null;

  let digits = trimmed.replace(/[^0-9+]/g, '');
  let international = false;

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
    international = true;
  }
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }

  if (international) {
    // Country code 95 followed by 7-9 digits
    if (!/^959\d{7,9}$/.test(digits)) return null;
    return `+95${digits.slice(2)}`;
  }

  // Domestic format: 09 followed by 7-9 digits (total 10-11 digits)
  if (!/^09\d{7,9}$/.test(digits)) return null;

  // Convert domestic 09... -> +95 9... (drop leading 0)
  return `+95${digits.slice(1)}`;
};

// Combined E.164 validator for both Thai (+66) and Myanmar (+95) numbers.
// Returns the E.164 string, or null if invalid.
export const normalizePhoneE164 = (value) => {
  const thai = normalizeThaiPhone(value);
  if (thai) {
    if (thai.startsWith('+66')) return thai;
    if (thai.startsWith('0')) return `+66${thai.slice(1)}`;
  }
  return normalizeMyanmarPhone(value);
};

// express-validator compatible predicate for combined TH/MM phone validation.
// Returns true when the value is a valid Thai or Myanmar phone number.
export const isPhoneValid = (value) => {
  if (value === undefined || value === null || value === '') return true;
  return normalizePhoneE164(value) !== null;
};

// Custom express-validator rule for combined phone validation.
export const validatePhone = (value) => {
  if (isPhoneValid(value)) return true;
  throw new Error('Invalid phone');
};