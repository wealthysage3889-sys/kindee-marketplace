# KIND​EE ORDER SYSTEM EXISTING AUDIT

## สรุป

ระบบคำสั่งซื้อมีโครงสร้างหลักครบ (Parent Order + Store Orders + Items + Stock reservation + Payment + Refund + Status history) ทั้ง Backend และ Supabase schema แต่ Frontend ยังมีหน้าลูกค้า (OrderHistory/OrderTracking) เท่านั้น; ไม่พบหน้าเจ้าของร้าน/Admin จัดการ Orders แบบเต็ม และไม่มี Realtime/Tracking live.

## 1. สิ่งที่มีอยู่แล้ว

- Backend route `/orders` (backend/routes/orderRoutes.js): create, list customer, get by id, cancel, history, store orders list, update store order status, refund, admin all.
- Service (backend/services/orderService.js): createOrder, getOrderById, getCustomerOrders, getStoreOrders, cancelOrder, updateStoreOrderStatus, syncParentOrderStatus, status history, refund, admin getAllOrders.
- Frontend API (frontend/src/api/index.js): orderAPI.create/getMyOrders/getById/cancel/getHistory/getStoreOrders/updateStoreOrderStatus/createRefund.
- Frontend pages: OrderHistory.jsx, OrderTracking.jsx; Checkout.jsx calls orderAPI.create.
- Supabase migrations: orders, store_orders, order_items, order_status_history, payments, refunds, stock reservation functions, triggers.
- SellerDashboard มี link `/seller/orders` แต่ไม่มีหน้า orders จริงใน pages list.

## 2. สิ่งที่ทำงานได้จริง

- ลูกค้าสั่งซื้อ: POST /orders บันทึก orders + store_orders + order_items + stock reservation + payment (non-COD) + customer_destinations.
- แยกออเดอร์ตามร้าน: createOrder group items by store_id; store_orders per store.
- ป้องกันร้านอื่นเห็นข้อมูล: getStoreOrders ตรวจ owner_id ของ store; getOrderById กรอง customer_id สำหรับ non-admin/owner.
- เจ้าของร้านดู/เปลี่ยนสถานะ store order: GET /orders/store/:storeId, PATCH /orders/store-orders/:id/status พร้อม validTransitions และ sync parent.
- ยกเลิก: customer cancel ได้เฉพาะ pending/confirmed; release stock.
- ประวัติ: GET /orders/:id/history ใช้ order_status_history.
- Admin: GET /orders/admin/all, POST refund.

## 3. สิ่งที่มีแต่ยังไม่สมบูรณ์

- Frontend ไม่มีหน้า Seller Orders (SellerDashboard ลิงก์ไป /seller/orders แต่ไม่มี route/page).
- AdminDashboard ไม่มีหน้า Orders management (adminRoutes มี /admin/orders? แต่ frontend ไม่พบหน้า AdminOrders).
- Payment status ยังเป็น 'pending' ทั้ง COD/non-COD; ไม่มี payment gateway integration.
- Realtime/Tracking: ไม่พบ subscription; OrderTracking ดึงข้อมูลครั้งเดียว.
- syncParentOrderStatus ใช้ heuristics อาจไม่ตรงทุกสถานะ.
- Refund อนุมัติโดย adminId แต่ไม่มี flow ตรวจรับ/ปฏิเสธ refund แบบ status transition ครบ.

## 4. สิ่งที่ยังไม่มี

- Frontend route/page สำหรับ seller/admin orders.
- Realtime order updates (Supabase Realtime/WebSocket).
- Order tracking live map / courier location.
- Payment gateway callback/webhook.
- Notification push เมื่อสถานะเปลี่ยน.
- Seller accept/reject UI (backend รองรับ status cancelled แต่ frontend ไม่แสดง).

## 5. ไฟล์และเส้นทางที่เกี่ยวข้อง

- backend/routes/orderRoutes.js
- backend/controllers/orderController.js
- backend/services/orderService.js
- backend/controllers/adminController.js
- frontend/src/api/index.js (orderAPI)
- frontend/src/pages/OrderHistory.jsx, OrderTracking.jsx, Checkout.jsx, SellerDashboard.jsx, AdminDashboard.jsx
- frontend/src/App.jsx (routes orders, orders/:id)
- supabase/migrations/003_triggers_functions.sql (+ migrations อื่น)
- test-integration.js

## 6. รายการที่ควรพัฒนาต่อ (ไม่สร้างซ้ำ)

- เพิ่มหน้า Seller Orders และ Admin Orders ใช้ API ที่มีอยู่แล้ว.
- เพิ่ม route `/seller/orders`, `/admin/orders` ใน App.jsx.
- เชื่อม SellerDashboard ไปหน้าจริง.
- เพิ่ม Realtime subscription ใน OrderTracking/OrderHistory.
- เพิ่ม payment gateway + webhook + payment status update.
- เพิ่ม notification เมื่อ status เปลี่ยน.
- เขียน tests สำหรับ multi-store order isolation.
- ตรวจสอบ RLS policies ของ orders/store_orders/order_items.
- ไม่สร้างตาราง orders ใหม่; ใช้ schema เดิม.

## ข้อห้าม

ห้ามแก้โค้ด ห้ามสร้างไฟล์ระบบใหม่ ห้ามรัน SQL/Migration ห้ามเขียนข้อมูล Supabase ห้าม commit/push/deploy

ตรวจสอบเสร็จแล้วหยุดและรออนุมัติ
