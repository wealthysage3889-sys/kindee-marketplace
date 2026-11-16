// Pricing rules for `discount_price` (single source of truth for API + checkout):
//
//   NULL / undefined / ''  -> no discount, the regular price is charged
//   0                      -> NOT supported. A 100% discount would create a
//                             zero-amount payment, which `payments.amount`
//                             (CHECK amount > 0) can never store. New writes are
//                             rejected; legacy 0 rows fall back to the regular
//                             price so no existing order silently becomes free.
//   0 < d < price          -> the discount price is charged
//   d <= 0 or d >= price   -> rejected on write; legacy rows fall back to the
//                             regular price at checkout (never undercharge)
//
// Every price is parsed to a number before it is compared or stored, because
// multipart clients send "100" while JSON clients send 100 and `'99' >= '100'`
// is true for strings.

export const PRICE_REQUIRED_MESSAGE = 'ราคาปกติต้องเป็นตัวเลข 0 ขึ้นไป';
export const DISCOUNT_INVALID_MESSAGE =
  'ราคาส่วนลดต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่าราคาปกติ หรือเว้นว่างไว้หากไม่มีส่วนลด';
export const DISCOUNT_ZERO_MESSAGE =
  'ไม่รองรับการตั้งส่วนลด 0 บาท (สินค้าฟรี) เนื่องจากระบบชำระเงินรับเฉพาะยอดมากกว่า 0 — กรุณาเว้นว่างไว้หากไม่มีส่วนลด';
export const STOCK_INVALID_MESSAGE = 'จำนวนคงคลังต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป';

const parseNumericString = (value) => {
  const trimmed = value.trim().replace(/,/g, '');
  return trimmed === '' ? null : Number(trimmed);
};

const lastValue = (value) => (Array.isArray(value) ? value[value.length - 1] : value);

// Parses a price-like value.
// Returns { ok, value }: `value` is null when the client did not supply a price
// (empty string, null, undefined), and `ok` is false when a value was supplied
// but is not a finite number.
export const parsePriceInput = (raw) => {
  const value = lastValue(raw);

  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string' && typeof value !== 'number') return { ok: false, value: null };

  const parsed = typeof value === 'string' ? parseNumericString(value) : value;
  // An empty (or whitespace only) field means "no value", not "invalid value".
  if (parsed === null) return { ok: true, value: null };
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, value: null };
};

export const parseStockInput = (raw) => {
  const value = lastValue(raw);

  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string' && typeof value !== 'number') return { ok: false, value: null };

  const parsed = typeof value === 'string' ? parseNumericString(value) : value;
  if (parsed === null) return { ok: true, value: null };
  return Number.isInteger(parsed) ? { ok: true, value: parsed } : { ok: false, value: null };
};

export const formatBaht = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} บาท`;
  return `${amount.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;
};

export const discountTooHighMessage = (price, discount) =>
  `ราคาส่วนลดต้องน้อยกว่าราคาปกติ (ราคาปกติ ${formatBaht(price)} และราคาส่วนลด ${formatBaht(discount)})`;

// Validates the regular price and the optional discount price.
// `discount` may be null/undefined when the client did not send one.
// Returns the parsed numbers together with Thai, user readable error messages.
export const validateProductPricing = ({ price, discount } = {}) => {
  const priceResult = parsePriceInput(price);
  const discountResult = parsePriceInput(discount);
  const errors = [];

  if (!priceResult.ok || priceResult.value === null || priceResult.value < 0) {
    errors.push(PRICE_REQUIRED_MESSAGE);
  }

  if (!discountResult.ok || (discountResult.value !== null && discountResult.value < 0)) {
    errors.push(DISCOUNT_INVALID_MESSAGE);
  } else if (discountResult.value === 0) {
    // A zero discount means "free", which the payment layer cannot represent.
    errors.push(DISCOUNT_ZERO_MESSAGE);
  }

  // The rule is intentionally kept: a discount price must be lower than the
  // regular price. Values are compared as numbers.
  if (errors.length === 0 && discountResult.value !== null && discountResult.value >= priceResult.value) {
    errors.push(discountTooHighMessage(priceResult.value, discountResult.value));
  }

  return {
    errors,
    price: priceResult.value,
    discount: discountResult.value,
    priceValid: priceResult.ok && priceResult.value !== null,
    discountValid: discountResult.ok
  };
};

// Validation used when updating an existing product. A field that is not part
// of the request keeps the value already stored on the product, and the
// discount is compared against the price that will be stored. This prevents a
// price-only update from leaving discount_price >= price in the database.
export const validateUpdatedProductPricing = ({ price, discount, currentPrice, currentDiscount } = {}) => {
  const hasPrice = price !== undefined;
  const hasDiscount = discount !== undefined;

  // Requests that do not touch the price keep the stored values as they are,
  // so a legacy product with inconsistent prices can still be edited.
  if (!hasPrice && !hasDiscount) {
    return { errors: [], hasPrice, hasDiscount, price: undefined, discount: undefined };
  }

  const priceResult = hasPrice ? parsePriceInput(price) : parsePriceInput(currentPrice);
  const discountResult = hasDiscount ? parsePriceInput(discount) : parsePriceInput(currentDiscount);

  const errors = [];

  if (!priceResult.ok || priceResult.value === null || priceResult.value < 0) {
    errors.push(PRICE_REQUIRED_MESSAGE);
  }

  if (!discountResult.ok || (discountResult.value !== null && discountResult.value < 0)) {
    errors.push(DISCOUNT_INVALID_MESSAGE);
  } else if (hasDiscount && discountResult.value === 0) {
    // Reject only values the client actually submitted. A legacy row that
    // already stores 0 stays editable (e.g. a stock-only update) and is charged
    // at the regular price by resolveEffectivePrice.
    errors.push(DISCOUNT_ZERO_MESSAGE);
  }

  if (errors.length === 0 && discountResult.value !== null && discountResult.value >= priceResult.value) {
    errors.push(discountTooHighMessage(priceResult.value, discountResult.value));
  }

  return {
    errors,
    hasPrice,
    hasDiscount,
    price: priceResult.value,
    discount: discountResult.value
  };
};

// Rounds a money amount to 2 decimals so totals stored in NUMERIC(12,2) columns
// and the payment amount always agree.
export const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

// Price actually charged for one unit. This is the rule the checkout and the
// product forms must agree on; see the header comment for the full matrix.
//   NULL/undefined/'' -> regular price
//   0 or invalid      -> regular price (legacy safe fallback, never a free item)
//   >= regular price  -> regular price (legacy inconsistent row)
//   0 < d < price     -> the discount price
export const resolveEffectivePrice = (price, discount) => {
  const regularPrice = Number(price);
  const parsedDiscount = parsePriceInput(discount);
  const discountValue = parsedDiscount.ok ? parsedDiscount.value : null;

  if (discountValue === null || discountValue <= 0 || discountValue >= regularPrice) {
    return regularPrice;
  }

  return discountValue;
};