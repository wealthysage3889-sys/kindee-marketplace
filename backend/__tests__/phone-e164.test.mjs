import { toE164ThaiPhone, normalizeThaiPhone } from '../utils/phone.js';

const cases = [
  // [input, expected, label]
  ['0812345678', '+66812345678', '10-digit Thai mobile starting with 08 -> E.164'],
  ['0612345678', '+66612345678', '10-digit Thai mobile starting with 06 -> E.164'],
  ['0912345678', '+66912345678', '10-digit Thai mobile starting with 09 -> E.164'],
  ['0112345678', '+66112345678', '10-digit Thai mobile starting with 01 -> E.164'],
  ['097-892-9968', '+66978929968', 'Thai mobile with dashes -> E.164'],
  ['097 892 9968', '+66978929968', 'Thai mobile with spaces -> E.164'],
  ['+66978929968', '+66978929968', 'International +66 format -> E.164 (unchanged)'],
  ['0066978929968', '+66978929968', 'International 0066 format -> E.164'],
  ['0212345678', '+66212345678', '10-digit Thai landline -> E.164'],
  ['0312345678', '+66312345678', '10-digit Thai landline starting with 03 -> E.164'],
  ['0412345678', '+66412345678', '10-digit Thai landline starting with 04 -> E.164'],
  ['0512345678', '+66512345678', '10-digit Thai landline starting with 05 -> E.164'],
  ['0712345678', '+66712345678', '10-digit Thai landline starting with 07 -> E.164'],
  ['09789299668', '+669789299668', '11-digit Thai mobile (legacy) -> E.164'],
  ['', null, 'empty string -> null'],
  [undefined, null, 'undefined -> null'],
  [null, null, 'null -> null'],
  ['097892996', null, 'too short (9 digits) -> null'],
  ['097892996689', null, 'too long (12 digits) -> null'],
  ['abc1234567', null, 'contains letters -> null'],
  ['1234567890', null, 'invalid prefix 12 -> null'],
  ['66978929968', null, 'missing + or 00 prefix -> null'],
  ['+661234567', null, 'international too short -> null'],
  ['+1234567890', null, 'non-Thai country code -> null'],
];

let passed = 0;
let failed = 0;

for (const [input, expected, label] of cases) {
  const result = toE164ThaiPhone(input);
  const ok = result === expected;
  if (ok) {
    passed++;
    console.log(`PASS: ${label} (${JSON.stringify(input)}) => ${JSON.stringify(result)}`);
  } else {
    failed++;
    console.log(`FAIL: ${label} (${JSON.stringify(input)}) => got ${JSON.stringify(result)}, expected ${JSON.stringify(expected)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);