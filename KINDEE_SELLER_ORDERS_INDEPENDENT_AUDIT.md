# KINDDEE Seller Orders Independent Audit

**Date:** 2026-11-18  
**Scope:** Seller Orders feature (frontend `/seller/orders`, related APIs/routes/services, permissions, transitions)  
**Mode:** Read-only inspection + safe static checks only (no file edits except this report, no migrations/schema changes, no Supabase writes, no env/commit/push/deploy)

## Safe checks executed
- `node --check backend/routes/orderRoutes.js backend/services/orderService.js backend/controllers/orderController.js` → `syntax-ok`
- Static code inspection of requested files and related backend/frontend modules
- Note: did not run `npm run build`/tests that generate artifacts or mutate state; `frontend/package.json` defines `build`/`lint`, `backend/package.json` defines `test`

## Summary verdict
**NOT READY** สำหรับอนุมัติใช้งานจริง

เหตุผลหลัก: รองรับผู้ใช้หลายร้านไม่ครบ, ประวัติสถานะของออเดอร์ลูกค้าเสี่ยงโหลดไม่ได้สำหรับผู้ขายตามการ authorize ปัจจุบัน, เหตุผลปฏิเสธ/ยกเลิกไม่ถูกบันทึก, สถานะ `failed` ถูก block โดย route validation แม้ UI/service รองรับ, และมีช่องว่างด้านการแสดงข้อมูล/สิทธิ์ role ที่ frontend กับ backend ไม่สอดคล้องกัน

---

## 1) PASS / FAIL / BLOCKED แยกตามหัวข้อ

| หัวข้อ | ผล | หมายเหตุสรุป |
|---|---|---|
| 1. การโหลดร้านและออเดอร์ถูกต้อง รองรับกรณีผู้ใช้มีหลายร้าน | **FAIL** | โหลดได้กรณีร้านเดียว/ร้านแรกเท่านั้น ไม่มี store selector และ API owner/me คืนร้านเดียว |
| 2. ผู้ขายเห็นและแก้ไขได้เฉพาะออเดอร์ของร้านตนเอง | **FAIL** | รายการ/อัปเดตสถานะมีการตรวจ owner ที่ backend แต่การดูประวัติออเดอร์พึ่ง endpoint ที่จำกัดสิทธิ์แบบลูกค้า และ role admin/owner เข้า route หน้าเว็บได้แต่ API ร้านถูกจำกัดเฉพาะ seller |
| 3. ปุ่มรับ/ปฏิเสธ/เปลี่ยนสถานะตรงกับ Backend transitions จริง | **FAIL** | mapping ใน UI ตรงกับ `validTransitions` ใน service แต่ route validator ไม่รับ `failed` (in_transit→failed กดจาก UI จะถูกปฏิเสธ) |
| 4. การปฏิเสธส่งเหตุผลและบันทึกประวัติถูกต้อง | **FAIL** | UI บังคับกรอกเหตุผลและส่ง `notes` แต่ service ไม่บันทึก/ใช้ `notes` และ trigger บันทึก reason คงที่ ไม่ใช่เหตุผลที่ผู้ขายกรอก |
| 5. การแสดงยอดเงิน รายการสินค้า ที่อยู่ และสถานะชำระเงิน ไม่สลับข้อมูลหรือคำนวณผิด | **FAIL (ข้อมูล/การแสดงผล)** | ไม่พบการคำนวณใหม่ในฝั่ง seller (ลดความเสี่ยงคำนวณผิด) และ query ผูกตาม store แต่ยอดเงินไม่ format, ที่อยู่แสดงเป็น JSON ดิบ, `customer_notes` ไม่ถูก select มาแม้ UI พยายามแสดง, payment status แสดงค่าดิบ |
| 6. Loading / Empty / Error และการป้องกันการกดซ้ำ | **PASS (มีข้อสังเกต)** | มี loading/empty/error states และ disable ปุ่ม action ระหว่างอัปเดตต่อรายการ แต่ error รวมศูนย์ ไม่แยกต่อการ์ด/การโหลดประวัติ และปุ่มรีเฟรชไม่ lock ระหว่างโหลด |
| 7. การดึงข้อมูลประวัติและการจัดการ API errors | **FAIL** | ดึงประวัติผ่าน `GET /orders/:id/history` ซึ่งตรวจสิทธิ์ด้วย `getOrderById` แบบ customer-centric จึงเสี่ยง 403/404 สำหรับผู้ขายที่ดูออเดอร์ลูกค้า; error ถูกจับแต่ UX การกู้คืนจำกัด |
| 8. Responsive และ route integration | **PASS (มีข้อสังเกต)** | มี route `/seller/orders` + ProtectedRoute + import ถูกต้อง และ CSS มี breakpoint/การ wrap เบื้องต้น แต่ความสามารถ responsive ยังจำกัดและมีความไม่สอดคล้องสิทธิ์ frontend(admin/owner)/backend(seller-only) |
| 9. ระบุกรณีที่ยังไม่มี Automated Tests และเสนอ Test Cases ที่จำเป็น | **PASS (การระบุครบถ้วนตามขอบเขตที่ตรวจ)** | ไม่พบ automated tests เฉพาะ Seller Orders/UI flow นี้; เสนอ test cases ด้านล่าง |

---

## 2) รายละเอียดการตรวจและปัญหาที่พบ (พร้อมไฟล์และตำแหน่ง)

### 2.1 การโหลดร้านและออเดอร์ / หลายร้าน — FAIL
- `frontend/src/pages/SellerOrders.jsx:57-83` โหลดร้านครั้งเดียวด้วย `storeAPI.getStoreByOwner(ownerId)` แล้ว set `store`/`storeId` เดียว ไม่มี state/UI สำหรับเลือกหลายร้าน
- `frontend/src/pages/SellerOrders.jsx:85-103` `fetchOrders()` ใช้ `storeId` เดียวเสมอ (`orderAPI.getStoreOrders(storeId, ...)`)
- `frontend/src/api/product.js:37` `getStoreByOwner` เรียก `GET /stores/owner/me` (ไม่รองรับ list/เลือก)
- `backend/routes/storeRoutes.js:116-124` `/owner/me` คืน `stores[0] || null` เท่านั้น แม้ service จะดึงหลายร้านได้
- `backend/services/storeService.js` (`getStoresByOwner`, คืน array ทุกร้านของ owner) — ข้อมูลรองรับหลายร้านที่ชั้น service แต่ไม่ถูกเปิดเผย/ใช้งานครบใน flow นี้

**ผลกระทบ:** ผู้ขายที่มีหลายร้านจะเห็น/จัดการได้เฉพาะร้านแรกเท่านั้น และไม่สามารถสลับร้านในหน้า Seller Orders

### 2.2 สิทธิ์การเห็น/แก้ไขออเดอร์ของร้านตนเอง — FAIL
**จุดที่ถูกต้อง:**
- `backend/routes/orderRoutes.js:110` `GET /store/:storeId` ใช้ `verifyToken, authorize('seller')`
- `backend/services/orderService.js:473-484` ตรวจ ownership `stores.id==storeId && owner_id==ownerId` ไม่ตรงให้ 403 "Store not found or not authorized"
- `backend/routes/orderRoutes.js:133` `PATCH /store-orders/:storeOrderId/status` ใช้ `verifyToken, authorize('seller')`
- `backend/services/orderService.js:569-585` ตรวจ `storeOrder.store.owner_id !== ownerId` → 403

**ปัญหา/ความเสี่ยง:**
- `frontend/src/App.jsx:69` อนุญาต route `/seller/orders` สำหรับ `["seller","admin","owner"]` แต่ backend endpoints ร้านสั่งซื้อจำกัด `authorize('seller')` เท่านั้น (`backend/routes/orderRoutes.js:110,133`) → admin/owner ที่ผ่านหน้าเว็บจะถูก API ปฏิเสธ (403) ไม่สามารถใช้งานฟีเจอร์ได้จริง
- การดูประวัติสถานะ: `frontend/src/pages/SellerOrders.jsx:122-134,226-243` เรียก `orderAPI.getHistory(so.order?.id || so.parent_order_id)` (parent order)
- `backend/routes/orderRoutes.js:99-107` history route เรียก `getOrderById(req.params.id, req.user.id, req.user.role)` ก่อนเสมอ
- `backend/services/orderService.js:404,425-428` `getOrderById` บังคับ `eq('customer_id', userId)` สำหรับผู้ใช้ที่ไม่ใช่ admin/owner → ผู้ขาย (role seller) ที่ไม่ได้เป็นเจ้าของ parent order (ลูกค้า) มีแนวโน้มถูกปฏิเสธเมื่อเปิดดูประวัติออเดอร์ที่ลูกค้าสั่งจากร้านตน
- หมายเหตุ: RLS/history policy ใน DB (`supabase/migrations/002_rls_policies.sql` มี policy ให้เข้าถึงผ่าน store owner) แต่ backend ใช้ `supabaseAdmin` และบังคับสิทธิ์ที่ชั้น service เอง ดังนั้นพฤติกรรมจริงขึ้นกับโค้ด backend ปัจจุบัน

### 2.3 ปุ่มรับ/ปฏิเสธ/เปลี่ยนสถานะเทียบ Backend transitions — FAIL
- Frontend mapping: `frontend/src/pages/SellerOrders.jsx:20-41,215-225`
  - `STATUS_TRANSITIONS`: pending→confirmed/cancelled, confirmed→preparing/cancelled, preparing→ready_for_pickup/cancelled, ready_for_pickup→picked_up/cancelled, picked_up→in_transit/cancelled, in_transit→delivered/failed, อื่นๆ ว่าง
  - ปุ่มสร้างจาก transitions + label รวม `failed: "ล้มเหลว"`
- Backend service: `backend/services/orderService.js:587-601,603-643` `validTransitions` ตรงกับชุดเดียวกันและอนุญาต `in_transit -> failed`
- Backend route validation: `backend/routes/orderRoutes.js:133-136` อนุญาตเฉพาะ `['confirmed','preparing','ready_for_pickup','picked_up','in_transit','delivered','cancelled']` (ไม่มี `failed`)

**ผลกระทบ:** กรณีออเดอร์อยู่สถานะ `in_transit` ผู้ขายจะเห็นปุ่ม "ล้มเหลว" แต่คำขอ PATCH จะ fail ที่ validation layer (400) แม้ business logic/service รองรับสถานะนี้

### 2.4 การปฏิเสธส่งเหตุผลและบันทึกประวัติ — FAIL
- UI: `frontend/src/pages/SellerOrders.jsx:105-120` เมื่อ `newStatus === 'cancelled'` ใช้ `window.prompt` บังคับให้มีเหตุผล (trim ว่างแล้ว return) และส่ง `notes` ไป `orderAPI.updateStoreOrderStatus(...)`
- Route รับ `notes`: `backend/routes/orderRoutes.js:135`
- Service ไม่ใช้/ไม่บันทึก `notes`: `backend/services/orderService.js:569,603-636` รับพารามิเตอร์ `notes=''` แต่ `updateData` มีเพียง `status` และ timestamps; ไม่มีการเขียนลง store_orders/orders/history
- Trigger ประวัติ: `supabase/migrations/003_triggers_functions.sql:273-299` `log_store_order_status_change` insert `order_status_history` ด้วย `reason: 'Store order status updated'` (ค่าคงที่) ไม่อ้างอิงเหตุผลจากผู้ขาย
- UI แสดงประวัติ: `frontend/src/pages/SellerOrders.jsx:231-241` แสดง `h.reason` หากมี แต่ค่าที่คาดหวัง (เหตุผลปฏิเสธที่กรอก) จะไม่ถูกเก็บ

**ผลกระทบ:** ไม่สามารถตรวจสอบย้อนหลังได้ว่าเหตุใดผู้ขายปฏิเสธ/ยกเลิก (audit trail ไม่สมบูรณ์)

### 2.5 การแสดงยอดเงิน รายการสินค้า ที่อยู่ สถานะชำระเงิน — FAIL (การแสดงผล/ความครบถ้วนข้อมูล)
- รายการสินค้า/จำนวน: `frontend/src/pages/SellerOrders.jsx:192-199` แสดงจาก `so.order_items` (`product_name`, `quantity`, `total_price`) — ตรงกับข้อมูลที่ API ร้านส่งกลับ (`backend/services/orderService.js:495-498` รวม `order_items`)
- ยอดเงิน: `frontend/src/pages/SellerOrders.jsx:188,196` แสดง `so.total_amount` และ `it.total_price` แบบดิบ (ไม่ใช้ formatter) เสี่ยง format/สกุลเงินไม่สอดคล้องหน้าอื่น
- สถานะชำระเงิน: `frontend/src/pages/SellerOrders.jsx:187` แสดง `so.order?.payment_status` ตรงจาก parent order (ไม่มี mapping ภาษา/enum UI)
- ที่อยู่จัดส่ง: `frontend/src/pages/SellerOrders.jsx:201-206` แสดง `JSON.stringify(so.order.customer_snapshot.address)` (อ่านยาก/ไม่เป็นมิตรกับผู้ใช้)
- หมายเหตุลูกค้า: `frontend/src/pages/SellerOrders.jsx:209-213` มีการ render `so.order?.customer_notes` แต่ query ร้านค้าไม่ได้เลือกฟิลด์นี้ `backend/services/orderService.js:492-494` (`order:orders!parent_order_id(id, order_number, customer_id, customer_snapshot, payment_method, payment_status)`) → หมายเหตุจะไม่แสดงแม้มีข้อมูล
- ไม่พบการคำนวณยอดใหม่ในหน้า seller (ใช้ค่าจาก backend) ลดความเสี่ยงคำนวณผิดฝั่ง client; อย่างไรก็ดีความถูกต้องของตัวเลขต้นทางขึ้นกับข้อมูล backend/DB

### 2.6 Loading / Empty / Error / ป้องกันกดซ้ำ — PASS (มีข้อสังเกต)
- Loading: `frontend/src/pages/SellerOrders.jsx:49,63,76-79,88,96-97,145-151,169-171`
- Empty: `frontend/src/pages/SellerOrders.jsx:171-173`
- Error: `frontend/src/pages/SellerOrders.jsx:68-76,94-95,115-116,132,150,167`
- ป้องกันกดซ้ำ action: `frontend/src/pages/SellerOrders.jsx:55,112,118,220` ใช้ `actionLoading[so.id]` disable ปุ่มขณะยิง API
- ข้อสังเกต: ปุ่ม "รีเฟรช" (`:163`) ไม่ถูก disable ระหว่างโหลด, error เป็น state เดียวแสดงด้านบน (อาจทับข้อความก่อนหน้า/ไม่ระบุบริบทการ์ด), การโหลดประวัติไม่มีสถานะ loading ต่อรายการ

### 2.7 การดึงประวัติและการจัดการ API errors — FAIL
- การดึงประวัติ: `frontend/src/pages/SellerOrders.jsx:122-134` toggle แล้วโหลดเมื่อยังไม่ขยาย; ใช้ parent order id
- API/สิทธิ์: `frontend/src/api/index.js:335-336` เรียก `/orders/:id/history`; `backend/routes/orderRoutes.js:99-101` บังคับผ่าน `getOrderById` (customer-owned สำหรับ seller) — ไม่สอดคล้องกับ use case ผู้ขายดูประวัติออเดอร์ลูกค้า (ดูหัวข้อ 2.2)
- Error handling: มี try/catch และ set error (`:115-116,132`) แต่เมื่อประวัติโหลดล้มเหลวจะไม่เปิด panel และผู้ใช้เห็นเพียง error รวม; ไม่แยกประเภท 401/403/404/validation

### 2.8 Responsive และ route integration — PASS (มีข้อสังเกต)
- Route integration: `frontend/src/App.jsx:15,68-69` import และประกาศ `seller`/`seller/orders` ภายใต้ `ProtectedRoute allowedRoles={["seller","admin","owner"]}` ถูกต้องในเชิง wiring
- Navigation: `frontend/src/pages/SellerDashboard.jsx` มีลิงก์ไป `/seller/orders`
- Responsive: `frontend/src/pages/SellerOrders.css:1-15` ใช้ flex-wrap, column layout บน header/filters/actions และ media query `@media (max-width: 600px)` ปรับ `.seller-order-top` เป็น column — พื้นฐานใช้งานได้ แต่ยังไม่ครอบคลุมตาราง/ข้อความยาว/ที่อยู่ JSON และอาจต้องทดสอบบนอุปกรณ์จริง
- ข้อสังเกตสิทธิ์ข้ามชั้น: frontend อนุญาต admin/owner แต่ backend store-order APIs รับเฉพาะ seller (ดู 2.2)

### 2.9 Automated Tests — ไม่มีสำหรับงานนี้
- ตรวจไม่พบไฟล์ทดสอบเฉพาะ Seller Orders (frontend) หรือ seller order flow ใน `backend/__tests__` (ชุดที่มีเป็น call/chat/phone/pricing/auth บางส่วน ฯลฯ)
- `KINDEE_SELLER_ORDERS_IMPLEMENTATION_REPORT.md` ระบุ "ยังไม่ได้เขียน automated tests สำหรับหน้านี้"
- ไม่พบ test สำหรับ: multi-store owner, seller history access, `failed` transition via route, persistence of rejection reason/notes, UI states/actions ของ SellerOrders

---

## 3) ความเสี่ยงก่อนใช้งานจริง
- **สิทธิ์/การเข้าถึงข้อมูลผิดพลาด:** ผู้ขายหลายร้านใช้งานไม่ครบ; admin/owner อาจเข้า UI แล้วทุก action ล้มเหลว; ประวัติออเดอร์อาจดูไม่ได้เพราะ authorization path ไม่ตรงบทบาทผู้ขาย
- **Auditability ไม่ครบ:** เหตุผลปฏิเสธ/ยกเลิกไม่ถูกบันทึกใน history ตามที่ผู้ขายระบุ ทำให้ติดตามข้อพิพาท/ตรวจสอบย้อนหลังได้ยาก
- **Transition ไม่สอดคล้อง:** สถานะ `in_transit → failed` ใช้งานไม่ได้ผ่าน API ตาม route validation ปัจจุบัน ก่อให้เกิดความสับสนและการจัดการเคสจัดส่งล้มเหลวติดขัด
- **ข้อมูลแสดงผลไม่ครบ/อ่านยาก:** หมายเหตุลูกค้าไม่ถูกส่งมาให้ seller, ที่อยู่แสดงเป็น JSON ดิบ, ยอดเงิน/สถานะชำระเงินไม่ format อาจทำให้ผู้ขายตีความผิด
- **คุณภาพ/เสถียรภาพ:** ไม่มี automated tests ครอบคลุม flow สำคัญ เสี่ยง regression เมื่อแก้ไข transitions/permissions/queries

---

## 4) Test Cases ที่ยังขาด (เสนอ)

### Backend / API integration
1. **Seller store isolation (list):** seller A เรียก `GET /orders/store/:storeId(A)` ได้ 200 เฉพาะออเดอร์ร้าน A; เรียก storeId ของ seller B ได้ 403
2. **Seller status update authorization:** seller B PATCH `store-orders` ของร้าน A → 403; seller A → 200 เมื่อ transition ถูกต้อง
3. **Transition matrix parity:** ทดสอบทุก transition ที่ UI อนุญาต เทียบผล 200/400 กับ service+route (รวม `in_transit→failed` ต้องสอดคล้องกัน)
4. **Cancellation reason persistence:** PATCH cancelled พร้อม `notes` แล้วตรวจ `order_status_history.reason`/ฟิลด์ที่เกี่ยวข้องว่าบันทึกเหตุผลจริง
5. **History access for seller:** seller เจ้าของร้านดู `GET /orders/:id/history` ของ parent order ลูกค้าได้ (หรือกำหนด endpoint เฉพาะ seller) และผู้ไม่มีสิทธิ์ถูกปฏิเสธ
6. **Store orders payload completeness:** response รวม `order.customer_notes`, payment fields ที่ UI ต้องใช้, address snapshot ตามรูปแบบที่ตกลง
7. **Role compatibility:** พฤติกรรมเมื่อ admin/owner เข้าถึง seller order endpoints (อนุญาตหรือปฏิเสธอย่างชัดเจนและสอดคล้อง frontend)
8. **Concurrency/idempotency:** กดเปลี่ยนสถานะซ้ำ/พร้อมกันบน store order เดียว → ได้ผลลัพธ์ที่ถูกต้องและ error ชัดเจน

### Frontend (component/e2e)
9. **Multi-store owner flow:** ผู้ใช้มี ≥2 ร้าน → สามารถเลือก/สลับร้านและเห็นออเดอร์ถูกร้าน
10. **Render correctness:** แสดงเลขออเดอร์, รายการสินค้า/จำนวน/ราคา, ยอดรวม, สถานะ, สถานะชำระเงิน, ที่อยู่ (อ่านได้), หมายเหตุลูกค้า ตรงกับ API
11. **Action buttons by status:** ปุ่มแสดงตรงตาม state machine จริง และ `failed` (ถ้ารองรับ) ทำงานสำเร็จ end-to-end
12. **Reject/cancel UX:** ไม่กรอกเหตุผล→ไม่ส่ง; กรอกเหตุผล→ส่งและแสดงผล/ประวัติที่บันทึกจริง
13. **Loading/empty/error states:** initial load, empty list, fetch error, action error, history load error
14. **Double-submit prevention:** คลิกปุ่ม action ซ้ำเร็วๆ ส่ง request ครั้งเดียว/สถานะ UI ถูกต้อง
15. **History toggle:** โหลดครั้งแรก, cache/expand-collapse, แสดงลำดับเวลาและ reason ถูกต้อง
16. **Responsive layout:** ตรวจที่ viewport แคบ (≤600px) ว่า filters, cards, actions, address/notes ไม่ล้นและยังใช้งานได้
17. **Route guard/integration:** seller เข้า `/seller/orders` ได้, บทบาทอื่นตาม policy ที่กำหนดได้ผลสอดคล้อง backend

---

## 5) ข้อสรุปการอนุมัติ
**สถานะ: NOT READY**

ควรแก้ไขประเด็นสิทธิ์/ความสอดคล้อง API (multi-store, seller history access, role/route alignment, `failed` transition validation), การบันทึกเหตุผลปฏิเสธลงประวัติ, และความครบถ้วนของข้อมูลแสดงผล ก่อนพิจารณาอนุมัติใช้งานจริง พร้อมเพิ่ม automated tests ตามที่เสนอ

*รายงานนี้จัดทำจากการตรวจสอบแบบอ่านอย่างเดียว ไม่ได้แก้ไขโค้ด/สคีมา/ข้อมูล และไม่ได้ commit/push/deploy*
