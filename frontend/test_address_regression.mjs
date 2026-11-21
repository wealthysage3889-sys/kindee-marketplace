import { formatAddress, formatCustomerAddress } from "./src/utils/helpers.js";

let pass = 0;
let fail = 0;

function assert(actual, expected, label) {
  const ok = actual === expected;
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// Backend stores delivery_address under customer_snapshot.address as object:
// { name, phone, address, district, province, postalCode }
assert(
  formatAddress({
    name: "N Aung",
    phone: "09xxxx",
    address: "123 มoo 5",
    district: "บางรัก",
    province: "กรุงเทพฯ",
    postalCode: "10500"
  }),
  "123 มoo 5, บางรัก, กรุงเทพฯ, 10500",
  "object full (address field)"
);

// street field variant
assert(
  formatAddress({ street: "123 Main St", district: "D", province: "P", postalCode: "10000" }),
  "123 Main St, D, P, 10000",
  "object street field"
);

// string form (API may return plain string)
assert(formatAddress("แยกวิทยุ, ปทุมวัน, กรุงเทพฯ"), "แยกวิทยุ, ปทุมวัน, กรุงเทพฯ", "string");

// null / undefined / empty
assert(formatAddress(null), "", "null");
assert(formatAddress(undefined), "", "undefined");
assert(formatAddress({}), "", "empty object");

// Customer snapshot object { name, phone, address }
assert(
  formatCustomerAddress({
    name: "N Aung",
    phone: "09xxxx",
    address: { address: "123 มoo 5", district: "บางรัก", province: "กรุงเทพฯ", postalCode: "10500" }
  }),
  "N Aung | 09xxxx | 123 มoo 5, บางรัก, กรุงเทพฯ, 10500",
  "snapshot object"
);

// Customer snapshot string
assert(formatCustomerAddress("โรงเรียน xxx"), "โรงเรียน xxx", "snapshot string");
assert(formatCustomerAddress(null), "", "snapshot null");
assert(formatCustomerAddress(undefined), "", "snapshot undefined");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
