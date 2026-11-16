import { normalizeThaiPhone, isThaiPhoneValid } from '../utils/phone.js';

const cases = [
  // [input, expected, label]
  ['09789299668', true, '11-digit Thai mobile (legacy stored value)'],
  ['0812345678', true, '10-digit Thai mobile starting with 08'],
  ['0612345678', true, '10-digit Thai mobile starting with 06'],
  ['097-892-9968', true, 'Thai mobile with dashes'],
  ['097 892 9968', true, 'Thai mobile with spaces'],
  ['+66978929968', true, 'International +66 format'],
  ['0066978929968', true, 'International 0066 format'],
  ['0212345678', true, '10-digit Thai landline'],
  ['', true, 'empty (optional field)'],
  [undefined, true, 'undefined (optional field)'],
  [null, true, 'null (optional field)'],
  ['097892996', false, 'too short (9 digits)'],
  ['097892996689', false, 'too long (11 digits)'],
  ['abc1234567', false, 'contains letters'],
  ['1234567890', false, 'invalid prefix 12'],
  ['66978929968', false, 'missing + or 00 prefix'],
  ['+661234567', false, 'international too short'],
];

let passed = 0;
let failed = 0;

for (const [input, expected, label] of cases) {
  const result = isThaiPhoneValid(input);
  const ok = result === expected;
  if (ok) {
    passed++;
    console.log(`PASS: ${label} (${JSON.stringify(input)}) => ${result}`);
  } else {
    failed++;
    console.log(`FAIL: ${label} (${JSON.stringify(input)}) => got ${result}, expected ${expected}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);