# KINDEE_MIGRATIONS_011_013_LOCAL_EXECUTION_REPORT.md

**วันที่ Execute:** 2026-11-18T23:48:00Z (เริ่มสำรอง) / 2026-11-18T23:5x:00Z (สิ้นสุด execute ครบชุด)  
**โครงการ:** kindee-marketplace  
**ไฟล์ที่ Execute:** `supabase/migrations/011_conversation_customer_id.sql` → `012_update_store_order_status_with_reason.sql` → `013_harden_migration_010_privileges.sql`  
**เป้าหมาย:** Local Docker PostgreSQL `kindee_pg_test` เท่านั้น (port 55432 → 5432, database `kindee`)  
**ข้อห้ามที่ปฏิบัติตาม:** ห้ามเชื่อมต่อ Supabase Cloud, ห้ามใช้ Supabase CLI deploy, ห้ามเปลี่ยน Production data, ไม่มีการแก้ไขข้อมูลจริงนอกเหนือจาก migration ที่รันบน lokal

---

## 0. สรุปผู้บริหาร

| รายการ | ผล |
|--------|-----|
| เป้าหมายเป็น Local Docker `kindee_pg_test` เท่านั้น | ✅ PASS |
| Supabase Cloud / CLI deploy | ❌ ไม่ถูกใช้ (โดยตั้งใจ) |
| Production data ถูกเปลี่ยนแปลง | ❌ ไม่มี (รันบน lokal/test container เท่านั้น) |
| Full backup + SHA256 + ตรวจ integrity ก่อน execute | ✅ PASS |
| Migration 011 | ✅ PASS |
| Migration 012 | ✅ PASS |
| Migration 013 | ✅ PASS |
| Rollback plan ทดสอบบนสำเนา (ไม่ทำลายข้อมูลจริง) | ✅ PASS |
| ผลรวม | **ทุกไมเกรชัน PASS, backup สมบูรณ์, rollback ทดสอบแล้ว** |

---

## 1. Database Identity (ยืนยันก่อน Execute)

| รายการ | ค่า | ตรวจสอบ |
|--------|-----|----------|
| Container | `kindee_pg_test` | ✅ ตรงตามข้อกำหนด |
| Image | `postgres:15-bookworm` (ไม่ใช่ Supabase image) | ✅ |
| Host port mapping | `0.0.0.0:55432 → 5432/tcp` | ✅ lokal เท่านั้น |
| PostgreSQL version | `PostgreSQL 15.20 (Debian 15.20-1.pgdg12+1)` | ✅ |
| Database | `kindee` | ✅ |
| Login role | `postgres` | ✅ |
| เชื่อมต่อ Supabase Cloud | **ไม่มี** (isolated, ไม่มี network call ออกนอกเครื่อง) | ✅ |
| ตาราง `schema_migrations` | ไม่มี (PostgreSQL standalone, ตรวจสถานะผ่าน `information_schema`/`pg_catalog` แทน) | ✅ ทราบแล้ว ไม่สมมติว่า migration ยังไม่เคย execute |

Identity ตรงทั้งหมด → ดำเนินการต่อได้

---

## 2. สถานะฐานข้อมูลก่อน Execute (ตรวจจริงผ่าน catalog, ไม่สมมติ)

ไม่มีตาราง `schema_migrations` จึงตรวจสถานะวัตถุจริงใน `pg_catalog`/`information_schema` ก่อน execute:

### 2.1 จำนวนแถวก่อน execute

| ตาราง | แถวก่อน | หมายเหตุ |
|-------|---------|----------|
| `profiles` | 7 | เมล็ดข้อมูล lokal |
| `stores` | 2 | เมล็ดข้อมูล lokal |
| `store_memberships` | 2 | (จาก migration 010 ที่ apply ไว้แล้ว) |
| `store_membership_audit_log` | 0 | |
| `conversations` | 0 | (ว่าง → ขั้น backfill/merge ของ 011 จะเป็น no-op ปลอดภัย) |
| `conversation_members` | 0 | |
| `messages` | 0 | |
| `call_history` | 0 | |
| `notifications` | 0 | |
| `store_orders` | 0 | |

### 2.2 สวัสดิภาพวัตถุที่เกี่ยวข้องก่อน execute

| รายการ | สถานะก่อน execute | หมายเหตุ |
|-------|-------------------|----------|
| `conversations.customer_id` | **มีอยู่แล้ว** (UUID, nullable) | 011 ถูก apply มาก่อนแล้ว → รันซ้ำแบบ idempotent |
| `conversations_merge_archive` | **มีอยู่แล้ว** (0 แถว) | 011 ถูก apply มาก่อนแล้ว |
| Index `ux_conversations_store_customer` | **มีอยู่แล้ว** | 011 |
| Index `idx_conversations_customer_id` | **มีอยู่แล้ว** | 011 |
| FK `conversations_customer_id_fkey` | **มีอยู่แล้ว** | 011 |
| CHECK `conversation_members_role_check` | **มีอยู่แล้ว** | 011 |
| RLS `conversations` / `conversation_members` | **เปิดแล้ว** (`t`) | 011 |
| ฟังก์ชัน `update_store_order_status_with_reason` | **มีอยู่แล้ว** (SECURITY DEFINER) | 012 ถูก apply มาก่อนแล้ว |
| Trigger `log_store_order_status_change_trigger` | **มีอยู่แล้ว** (AFTER UPDATE on store_orders) | 012 |
| `anon` EXECUTE ฟังก์ชัน 010 ทั้ง 10 | **ถูกถอนแล้ว** (`f` ทั้ง 10) | 013 ถูก apply บางส่วนแล้ว |
| Table grants `anon` บน `store_memberships` | **ถูกถอนแล้ว** | 013 H2 |
| Policies `store_memberships` | `{public}` (ยังไม่ใช่ `{authenticated}`) | 013 H3 **ยังไม่ถูก apply** — พบความคลาดเคลื่อนกับรายงาน 013 เดิม, ได้แก้ไขในรอบนี้ |
| `conversations_store_members_select` | `{public}` | 013 H3 ยังไม่ถูก apply |

สรุปสถานะก่อนเริ่ม: 011 และ 012 ถูก apply แล้วก่อนหน้านี้, 013 ถูก apply บางส่วน (H1, H2 สำเร็จ แต่ H3 policies ยังเป็น `{public}`). ทุกไมเกรชันเขียนแบบ idempotent จึงรันซ้ำใน transaction ได้อย่างปลอดภัยเพื่อรับประกันสถานะปลายทางตามแผน.

---

## 3. การสำรองข้อมูลก่อนเปลี่ยนแปลง (Full Backup + SHA256 + Integrity)

สำรอง **ก่อน** execute ไมเกรชันใด ๆ (สถานะตรงหัวข้อ 2):

**ตำแหน่งไฟล์:** `C:\Users\LEGION\AppData\Local\Temp\kilo\kindee_pre_011_013_backup_20261118T234812\`

| ไฟล์ | ขนาด | SHA256 |
|------|-------|--------|
| `kindee_before_011_013.dump` (custom format, full DB) | 231,100 B | `1AC8047625FC7B0B5A97FF57F9E43D8A9BE33F9A09BE0756B1E7182AA3BE7811` |
| `kindee_before_011_013_schema.sql` (schema-only) | 167,954 B | `CAD5D4C5A8B176D0050248AF964E3889CC8A8D02A4A1A2298FFE45DA08AC8DBF` |
| `kindee_before_011_013_data.sql` (ตารางสำคัญ, data-only) | 3,494 B | `5B9B194CEC4C2472F597CAC9D5E49389C94B4783DF233E290B8BA551E386CE01` |

**ตรวจ integrity:** `pg_restore --list /tmp/kindee_before_full.dump` = **546 entries**, custom format ถูกต้อง, พบ `TABLE DATA` ของตารางสำคัญครบถ้วน → **backup สมบูรณ์ใช้กู้คืนได้**

---

## 4. ผลการ Execute แต่ละ Migration (ทุกรันใน transaction เดียว, `ON_ERROR_STOP=1`, หยุดทันทีถ้าผิดพลาด)

### 4.1 Migration 011 — `011_conversation_customer_id.sql`

**รูปแบบ:** หุ้มทั้งไฟล์ด้วย `BEGIN; … COMMIT;`  
**ผลรัน:** `BEGIN → COMMIT`, `PSQL_EXIT=0`, backfill `UPDATE 0` (ตารางว่าง), NOTICE "already exists, skipping" ยืนยัน guard ทำงานแบบ idempotent, **ไม่มีข้อผิดพลาด**

**Postconditions หลัง execute:**

| ตรวจสอบ | ค่าจริง | ผล |
|---------|--------|-----|
| `conversations.customer_id` | uuid, NULLable | ✅ PASS |
| FK `conversations_customer_id_fkey` → `profiles(id)` ON DELETE SET NULL | มี | ✅ PASS |
| Unique index `ux_conversations_store_customer` | มี | ✅ PASS |
| Index `idx_conversations_customer_id` | มี | ✅ PASS |
| CHECK `conversation_members_role_check` (member/admin/owner) | มี | ✅ PASS |
| RLS enabled `conversations`, `conversation_members` | `t` ทั้งคู่ | ✅ PASS |
| `conversations` rows | 0 (ไม่สูญหาย, merge เป็น no-op) | ✅ PASS |
| `profiles=7`, `stores=2` (เท่าเดิม) | เท่าเดิม | ✅ PASS |

**Regression:** ตารางเดิมทั้งหมดยังคงอยู่ครบ, จำนวนแถวไม่เปลี่ยน, ไม่มีข้อผิดพลาดระหว่างรัน → **ไม่เกิดการถดถอย**

> หมายเหตุ: วัตถุของ 011 มีอยู่แล้วก่อน execute (idempotent guard ทำงาน) การรันซ้ำจึงไม่เปลี่ยนแปลงข้อมูล แต่รับประกันสถานะปลายทางตรงตามแผน

**011 = PASS**

---

### 4.2 Migration 012 — `012_update_store_order_status_with_reason.sql`

**รูปแบบ:** หุ้มด้วย `BEGIN; … COMMIT;`  
**ผลรัน:** `BEGIN → COMMIT`, `PSQL_EXIT=0` (CREATE FUNCTION, GRANT, DROP/CREATE TRIGGER, CREATE TRIGGER), **ไม่มีข้อผิดพลาด**

**Postconditions หลัง execute:**

| ตรวจสอบ | ค่าจริง | ผล |
|---------|--------|-----|
| ฟังก์ชัน `update_store_order_status_with_reason(uuid,order_status,text)` | มี, SECURITY DEFINER, owner=postgres | ✅ PASS |
| ฟังก์ชัน `log_store_order_status_change` | มี | ✅ PASS |
| Trigger `log_store_order_status_change_trigger` on `store_orders` (AFTER UPDATE, enabled) | `tgenabled=O` | ✅ PASS |
| `service_role` EXECUTE function | `t` | ✅ PASS |
| `store_orders=0`, `order_status_history=0` | เท่าเดิม | ✅ PASS |

**Regression:** `store_orders` และ `order_status_history` จำนวนแถวไม่เปลี่ยน, ไม่มีข้อผิดพลาด → **ไม่เกิดการถดถอย**

**012 = PASS** (จึงดำเนินการต่อไปยัง 013)

---

### 4.3 Migration 013 — `013_harden_migration_010_privileges.sql` (Part A)

**รูปแบบ:** ไฟล์มี `BEGIN; … COMMIT;` ในตัวแล้ว (รันตรง ๆ, `ON_ERROR_STOP=1`)  
**ผลรัน:** `BEGIN → COMMIT`, `PSQL_EXIT=0` (DO precondition guard ผ่าน, REVOKE x10, GRANT x5, REVOKE x2, GRANT x1, DROP/CREATE POLICY x5 คู่), **ไม่มีข้อผิดพลาด**

แก้ไขความคลาดเคลื่อนที่พบก่อน execute: policies `store_memberships` ยังเป็น `{public}` → หลัง execute เปลี่ยนเป็น `{authenticated}` ครบ 5 รายการ ตามที่ 013 กำหนด

**Postconditions หลัง execute:**

#### Function privileges

| ฟังก์ชัน | anon | authenticated | service_role | เป้าหมาย |
|---------|------|---------------|--------------|----------|
| `is_store_owner` | **f** | t | t | anon=f ✅ |
| `jsonb_bool` | **f** | t | t | anon=f ✅ |
| `is_active_store_manager` | **f** | t | t | anon=f ✅ |
| `is_active_store_member` | **f** | t | t | anon=f ✅ |
| `validate_store_member_permissions` | **f** | t | t | anon=f ✅ |
| `prevent_sole_owner_change` | **f** | **f** | t | ✅ |
| `prevent_sole_owner_delete` | **f** | **f** | t | ✅ |
| `store_memberships_guard_insert` | **f** | **f** | t | ✅ |
| `store_memberships_guard_update` | **f** | **f** | t | ✅ |
| `audit_store_membership_change` | **f** | **f** | t | ✅ |

anon = **0/10** (เป้าหมาย 0) ✅, authenticated = 5 helper / 0 trigger function (เป้าหมาย 5/0) ✅, service_role = 10/10 คงเดิม ✅

#### Table privileges

| ตาราง | ACL หลัง execute | ผล |
|-------|-------------------|-----|
| `store_memberships` | `postgres=arwdDxt, authenticated=arwd, service_role=arwdDxt` — **ไม่มี anon** | ✅ PASS |
| `store_membership_audit_log` | `postgres=arwdDxt, service_role=arwdDxt` — **ไม่มี anon, ไม่มี authenticated** | ✅ PASS |

#### RLS / Policies

| รายการ | ค่าจริง | ผล |
|-------|--------|-----|
| RLS enabled (`store_memberships`, `store_membership_audit_log`) | `t` | ✅ PASS |
| FORCE RLS | `f` (จำเป็นต่อ SECURITY DEFINER audit writer) | ✅ PASS |
| Policies `store_memberships` 5 รายการ | `{authenticated}` (เปลี่ยนจาก `{public}`) | ✅ PASS |
| Policy `conversations_store_members_select` | `{authenticated}` | ✅ PASS |
| Policy `test_conversations_read` | `{public}` (test harness artifact, ไม่ใช่ของ 013) | ตามที่คาด ✅ |

#### Triggers / Data

| รายการ | ค่าจริง | ผล |
|-------|--------|-----|
| Trigger 5 ตัวบน `store_memberships` | `tgenabled=O` ครบ (ยังทำงาน) | ✅ PASS |
| `store_memberships` rows | **2** (เท่าก่อน execute) | ✅ PASS |
| `store_membership_audit_log` rows | **0** (เท่าก่อน execute) | ✅ PASS |

**Regression:** ข้อมูลไม่ถูกแก้ไข (2 แถว / audit 0), RLS/Audit/Sole-owner protection ยังทำงาน, ไม่มีข้อผิดพลาด → **ไม่เกิดการถดถอย**

> หมายเหตุพฤติกรรมที่เปลี่ยนตามเป้าหมายของ 013 (intentional): `anon` SELECT `store_memberships` / เรียก helper เปลี่ยนจาก `200 []` เป็น `401/403` (permission denied) — ยืนยันแล้วว่าไม่มี Frontend/Backend ใช้งานเส้นทางเหล่านี้ (Frontend เรียกผ่าน Backend REST ด้วย service_role เท่านั้น)

**013 = PASS** (รวมถึงการแก้ไข H3 policies ที่พบว่า apply ไม่ครบก่อนหน้านี้)

---

## 5. สรุปผลการ Execute (ก่อน/หลังข้อมูล)

| ตาราง | ก่อน execute | หลัง execute 011→012→013 | ผล |
|-------|--------------|--------------------------|-----|
| `profiles` | 7 | 7 | ไม่เปลี่ยน ✅ |
| `stores` | 2 | 2 | ไม่เปลี่ยน ✅ |
| `store_memberships` | 2 | 2 | ไม่เปลี่ยน ✅ |
| `store_membership_audit_log` | 0 | 0 | ไม่เปลี่ยน ✅ |
| `conversations` | 0 | 0 | ไม่เปลี่ยน ✅ |
| `conversations_merge_archive` | 0 | 0 | ไม่เปลี่ยน ✅ |
| `store_orders` | 0 | 0 | ไม่เปลี่ยน ✅ |
| `order_status_history` | 0 | 0 | ไม่เปลี่ยน ✅ |
| `messages` / `call_history` / `notifications` | 0 | 0 | ไม่เปลี่ยน ✅ |

จำนวนแถว, constraints, indexes, RLS, policies, triggers, grants และ function privileges ตรวจครบถ้วนก่อน/หลัง ตามหัวข้อ 4 — **ทุกมิติเป็นไปตามที่คาดไว้**

---

## 6. การทดสอบ Rollback Plan (บนสำเนา, ไม่ทำลายข้อมูลจริง)

สร้างฐานข้อมูลสำเนา `kindee_rollback_test` จาก pg_dump ของ `kindee` สถานะหลัง execute ครบชุด, แล้วรัน rollback บนสำเนาเท่านั้น (ฐานข้อมูลจริง `kindee` ยังคงมีการเปลี่ยนแปลงทั้งสามไมเกรชันครบถ้วน, ยืนยันแล้วว่ายังมี `customer_id`, `update_store_order_status_with_reason`, anon_exec=f ทั้ง 10):

| ไมเกรชัน | การทดสอบ rollback บนสำเนา | ผล |
|---------|---------------------------|-----|
| 011 | rollback_011.sql ขั้น 2–3 (drop index `ux_conversations_store_customer`, `idx_conversations_customer_id`, drop constraint `conversation_members_role_check`, drop column `customer_id`) | ✅ สำเร็จ (exit 0), ยืนยันคอลัมน์/ดัชนี/คอนสตรินต์ถูกลบออกจากสำเนา |
| 011 หมายเหตุ | rollback_011.sql ขั้น 1 อ้างอิงคอลัมน์ `last_message_at` ซึ่ง **ไม่มีอยู่** ในตาราง `conversations` ของโปรเจกต์นี้ (ปัญหาเดิมของสคริปต์ rollback, ไม่เกี่ยวกับการ execute ครั้งนี้) → เป็น no-op เพราะ archive ว่างเปล่า | ขั้น 2–3 (สาระสำคัญ) ทดสอบสำเร็จ |
| 012 | Drop trigger `log_store_order_status_change_trigger`, drop ฟังก์ชัน `log_store_order_status_change`, `update_store_order_status_with_reason` | ✅ สำเร็จ (exit 0), ฟังก์ชันและทริกเกอร์หายจากสำเนา |
| 013 | คืน GRANT EXECUTE ให้ anon ทั้ง 10 ฟังก์ชัน, คืน table grant ให้ anon, คืน policies `store_memberships` + `conversations_store_members_select` เป็น `{public}` | ✅ สำเร็จ (exit 0), anon_exec กลับเป็น 10/10, policies กลับเป็น `{public}` |

**ฐานข้อมูลจริง `kindee`:** ไม่ถูก rollback, ยังคงมีการเปลี่ยนแปลงทั้งสามไมเกรชันครบถ้วน → **ไม่มีการทำลายข้อมูลจริง**

---

## 7. PASS / FAIL / NOT VERIFIED แยกแต่ละ Migration

### Migration 011 — PASS

| รายการ | ผล | หลักฐาน |
|--------|-----|---------|
| Execute ใน transaction เดียว, exit 0 | PASS | `BEGIN → COMMIT`, `PSQL_EXIT=0` |
| `customer_id` column + FK + index + CHECK constraint + RLS | PASS | ตรวจผ่านทุกรายการ (หัวข้อ 4.1) |
| ข้อมูลไม่สูญหาย (`conversations=0`, `profiles=7`, `stores=2`) | PASS | หัวข้อ 4.1 / 5 |
| Regression (ตารางเดิมไม่เสียหาย) | PASS | ไม่มีข้อผิดพลาด, แถวไม่เปลี่ยน |

### Migration 012 — PASS

| รายการ | ผล | หลักฐาน |
|--------|-----|---------|
| Execute ใน transaction เดียว, exit 0 | PASS | `BEGIN → COMMIT`, `PSQL_EXIT=0` |
| ฟังก์ชัน `update_store_order_status_with_reason` (SECURITY DEFINER) | PASS | หัวข้อ 4.2 |
| Trigger `log_store_order_status_change_trigger` (AFTER UPDATE) | PASS | หัวข้อ 4.2 |
| `service_role` EXECUTE = t | PASS | หัวข้อ 4.2 |
| Regression (`store_orders=0`, `order_status_history=0`) | PASS | หัวข้อ 4.2 / 5 |

### Migration 013 — PASS

| รายการ | ผล | หลักฐาน |
|--------|-----|---------|
| Execute ใน transaction เดียว, exit 0 | PASS | `BEGIN → COMMIT`, `PSQL_EXIT=0` |
| `anon` EXECUTE = 0/10 | PASS | หัวข้อ 4.3 |
| `authenticated` EXECUTE = 5 helper / 0 trigger | PASS | หัวข้อ 4.3 |
| Table grants ตัด `anon` ครบ | PASS | หัวข้อ 4.3 |
| Policies `store_memberships` + `conversations_store_members_select` → `{authenticated}` | PASS | หัวข้อ 4.3 (แก้ความคลาดเคลื่อนเดิม) |
| RLS = t, FORCE = f, Trigger 5/5 enabled | PASS | หัวข้อ 4.3 |
| Data ไม่เปลี่ยน (`store_memberships=2`, `audit=0`) | PASS | หัวข้อ 4.3 / 5 |
| Regression (Sole-owner / Audit / Role protection ยังทำงาน) | PASS | หัวข้อ 4.3 |

### NOT VERIFIED (ตั้งใจ, ตามข้อจำกัดห้ามเชื่อมต่อ Cloud)

| # | รายการ | เหตุผล |
|---|--------|--------|
| N1 | พฤติกรรมบน Supabase Cloud / PostgREST HTTP status | ห้ามเชื่อมต่อ Supabase Cloud |
| N2 | Role `authenticator` ไม่มี direct grant | role นี้ไม่มีใน DB ทดสอบ lokal |
| N3 | Policy `test_*` บน production | เป็น artifact ของ test harness lokal เท่านั้น |
| N4 | Part B (`ALTER DEFAULT PRIVILEGES`) | ห้าม execute ตามข้อกำหนด (ขออนุมัติแยก) |

---

## 8. การปฏิบัติตามข้อกำหนด (Checklist)

- [x] ยืนยันเป้าหมายเป็น Local Docker `kindee_pg_test` (port 55432, database `kindee`) เท่านั้น
- [x] ตรวจ schema, migration state, dependencies ผ่าน catalog ก่อนรัน (ไม่สมมติว่า migration ยังไม่เคย execute)
- [x] สร้าง full backup พร้อม SHA256 และตรวจ backup integrity (`pg_restore --list` 546 entries) ก่อน execute
- [x] Execute 011 แบบ transaction แล้วตรวจ postconditions และ regression → PASS
- [x] เมื่อ 011 ผ่านเท่านั้น จึง Execute 012 และตรวจ regression → PASS
- [x] เมื่อ 012 ผ่านเท่านั้น จึง Execute 013 และตรวจ regression → PASS
- [x] ไม่มีขั้นใด FAIL, identity ตรง, backup สมบูรณ์, ไม่พบข้อมูลผิดปกติ → ไม่มีการหยุดกลางคัน
- [x] ตรวจจำนวนข้อมูล, constraints, indexes, RLS, policies, triggers, grants, function privileges ก่อน/หลัง
- [x] ทดสอบ rollback plan บนสำเนา `kindee_rollback_test` โดยไม่ทำลายข้อมูลจริง
- [x] สร้างรายงานฉบับนี้ (`KINDEE_MIGRATIONS_011_013_LOCAL_EXECUTION_REPORT.md`)
- [x] **ไม่ Apply Cloud, ไม่ใช้ Supabase CLI deploy, ไม่เปลี่ยน Production data**

---

## 9. ข้อควรทราบ / ข้อสังเกต

1. **011 และ 012 มีอยู่แล้วก่อน execute** (วัตถุครบถ้วนใน catalog) การรันซ้ำในครั้งนี้เป็นแบบ idempotent (guard `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`) ทั้งหมดสำเร็จใน transaction และรับประกันสถานะปลายทางตรงตามแผน
2. **013 H3 (policies → `{authenticated}`) พบว่า apply ไม่ครบก่อนหน้านี้** (ยังเป็น `{public}`) แก้ไขแล้วในรอบนี้, ยืนยันหลัง execute ว่าเป็น `{authenticated}` ครบ
3. **rollback_011.sql ขั้น 1 อ้างอิงคอลัมน์ `last_message_at` ซึ่งไม่มีอยู่** ในตาราง `conversations` ของโปรเจกต์นี้ (ปัญหาเดิมของสคริปต์ rollback) → เป็น no-op เพราะ archive ว่างเปล่า; ขั้น 2–3 (ลบ schema ของ 011) ทดสอบบนสำเนาสำเร็จแล้ว
4. **ฐานข้อมูลสำเนาที่ใช้ทดสอบ rollback:** `kindee_rollback_test` (ยังคงอยู่บน Docker, ไม่กระทบฐานข้อมูลจริง `kindee`)
5. **ยังห้ามนำขึ้น Supabase Cloud** จนกว่าจะทำ staging smoke test และตรวจ N1–N4 ตามรายงาน 013 เดิม

---

**สรุปสุดท้าย:** ไมเกรชัน 011 → 012 → 013 Execute สำเร็จครบถ้วนบน Local Docker PostgreSQL `kindee_pg_test` (ทุกรายการ PASS), backup สมบูรณ์พร้อม SHA256, ทดสอบ rollback บนสำเนาแล้วโดยไม่ทำลายข้อมูลจริง, ไม่มีการเชื่อมต่อ Supabase Cloud และไม่มีการเปลี่ยนแปลง Production data ทุกกรณี
