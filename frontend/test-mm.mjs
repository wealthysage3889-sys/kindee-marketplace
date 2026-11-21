import { parsePhoneNumberFromString, isValidPhoneNumber } from 'libphonenumber-js';
const tests = ['+9509789299668', '+959789299668', '09789299668', '+95978929968', '0978929968'];
for (const t of tests) {
  const p = parsePhoneNumberFromString(t, 'MM');
  console.log(t, '=> country:', p?.country, '| valid:', isValidPhoneNumber(t, 'MM'), '| E164:', p?.format('E.164'), '| national:', p?.nationalNumber);
}
