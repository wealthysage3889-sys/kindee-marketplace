import {
  normalizePhoneE164,
  isPhoneValid,
  validatePhone,
  normalizeThaiPhone,
  normalizeMyanmarPhone,
} from '../utils/phone.js';

// [input, expectedE164OrNull, label]
const e164Cases = [
  // Thai valid -> E.164
  ['0812345678', '+66812345678', 'Thai domestic 08 -> E.164'],
  ['0978929968', '+66978929968', 'Thai domestic 09 -> E.164'],
  ['+66812345678', '+66812345678', 'Thai E.164 +66 unchanged'],
  ['0066812345678', '+66812345678', 'Thai 0066 -> E.164'],
  // Myanmar valid -> E.164 (รหัสประเทศชัดเจน จึงไม่คลุมเครือกับไทย)
  ['+959252788463', '+959252788463', 'Myanmar E.164 +95 unchanged (regression)'],
  ['+95912345678', '+95912345678', 'Myanmar E.164 9-digit NSN'],
  ['0095912345678', '+95912345678', 'Myanmar 0095 -> E.164'],
  // Invalid formats -> null
  ['', null, 'empty'],
  [undefined, null, 'undefined'],
  [null, null, 'null'],
  ['+661234567', null, 'Thai too short'],
  ['+959123456', null, 'Myanmar too short (7 digits after 95)'],
  ['+9592527884630', null, 'Myanmar too long (11 digits after 95)'],
  ['+1234567890', null, 'unsupported country code'],
  ['abc1234567', null, 'contains letters'],
  // Duplicate country code -> null (no double prefix)
  ['+66+66812345678', null, 'Thai duplicate country code'],
  ['+95+959252788463', null, 'Myanmar duplicate country code'],
  ['+66959252788463', null, 'Thai prefix applied to Myanmar digits'],
];

// [input, expectedBoolean, label]
const validCases = [
  ['0812345678', true, 'Thai domestic valid'],
  ['+66812345678', true, 'Thai E.164 valid'],
  ['+959252788463', true, 'Myanmar E.164 valid (regression)'],
  ['09252788463', true, 'Myanmar domestic valid'],
  ['', true, 'empty optional'],
  [undefined, true, 'undefined optional'],
  ['+66+66812345678', false, 'Thai duplicate country code invalid'],
  ['+95+959252788463', false, 'Myanmar duplicate country code invalid'],
  ['+959123456', false, 'Myanmar too short invalid'],
];

let passed = 0;
let failed = 0;

for (const [input, expected, label] of e164Cases) {
  const result = normalizePhoneE164(input);
  const ok = result === expected;
  if (ok) {
    passed++;
    console.log(`PASS: ${label} (${JSON.stringify(input)}) => ${JSON.stringify(result)}`);
  } else {
    failed++;
    console.log(`FAIL: ${label} (${JSON.stringify(input)}) => got ${JSON.stringify(result)}, expected ${JSON.stringify(expected)}`);
  }
}

for (const [input, expected, label] of validCases) {
  const result = isPhoneValid(input);
  const ok = result === expected;
  if (ok) {
    passed++;
    console.log(`PASS: ${label} (${JSON.stringify(input)}) => ${result}`);
  } else {
    failed++;
    console.log(`FAIL: ${label} (${JSON.stringify(input)}) => got ${result}, expected ${expected}`);
  }
}

// validatePhone should throw on invalid
for (const input of ['+95+959252788463', '+959123456', 'abc', '+66+66812345678']) {
  let threw = false;
  try {
    validatePhone(input);
  } catch (e) {
    threw = e.message === 'Invalid phone';
  }
  const label = `validatePhone throws Invalid phone for ${JSON.stringify(input)}`;
  if (threw) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.log(`FAIL: ${label} => did not throw Invalid phone`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
