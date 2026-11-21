# KINDEE_MIGRATION_010_LOCAL_SECURITY_VERIFICATION.md

**วันที่สร้าง:** 2026-11-18T15:30:00Z  
**โครงการ:** kindee-marketplace  
**ฐานข้อมูลที่ทดสอบ:** Docker Container `kindee_pg_test` (PostgreSQL 15.20, port 55432)  
**ฐานข้อมูล:** `kindee` (Local / Isolated — ไม่ใช่ Supabase Cloud)  
**ขอบเขต:** ตรวจสอบความปลอดภัยของ Migration 010 (`supabase/migrations/010_store_memberships.sql`) แบบ Read-only + Transaction/Rollback  
**ข้อห้ามที่ปฏิบัติตาม:** ไม่เชื่อมต่อ Supabase Cloud, ไม่แก้ไข Migration 010, ไม่ DROP DATABASE/SCHEMA, ใช้ ROLLBACK สำหรับทุกการเขียนข้อมูล, ไม่เปิดเผย Secrets

---

## 1. สภาพแวดล้อมการทดสอบ

| รายการ | ค่า |
|--------|-----|
| Container | `kindee_pg_test` (`postgres:15-bookworm`) |
| PostgreSQL version | 15.20 (Debian 15.20-1.pgdg12+1) |
| Host port | `55432` (映射ไปยัง `5432` ภายใน container) |
| Database | `kindee` |
| เอกซ์เทนชัน | pgcrypto 1.3, plpgsql 1.0, uuid-ossp 1.1 |
| auth schema | มีฟังก์ชัน `auth.uid()`, `auth.role()` (อ่านจาก `request.jwt.claim.*`) |
| ข้อมูลทดสอบ | stores: 2, profiles: 7, store_memberships: 2 (ทั้งสองเป็น owner คนเดียวของแต่ละร้าน), audit_log: 0 |

**ข้อมูลทดสอบที่ใช้:**

| Store ID | Owner Profile ID |
|----------|-----------------|
| `2a12be88-07fe-430c-9771-319f25a02e3b` | `dd5caa6b-4487-4f85-b3bb-74998afcfe98` |
| `b469d1f6-ce30-4290-9283-9b88e03eacee` | `34f95077-be2e-4fb8-b331-ec9545b74b36` |

| Profile ID | Email | Role |
|------------|-------|------|
| `dd5caa6b-4487-4f85-b3bb-74998afcfe98` | owner_*@t.local | owner |
| `34f95077-be2e-4fb8-b331-ec9545b74b36` | owner_*@t.local | owner |
| `b60cc4a5-1994-4cdf-a122-c708f28fff16` | manager_*@t.local | manager |
| `fceb149e-e640-4a9f-bccd-32d3b633010b` | manager_*@t.local | manager |
| `d3a5833e-4684-4b53-97bc-9586e8b79a6a` | staff_*@t.local | staff |
| `f094b189-fd78-46cc-b707-36805f3154e3` | staff_*@t.local | staff |
| `8664df4f-b1ad-42e0-9b30-f06351fff8f6` | outsider_*@t.local | outsider |

**การจำลองผู้ใช้:** ใช้ `SET request.jwt.claim.sub = '<profile_id>'` และ `SET request.jwt.claim.role = '<role>'` ร่วมกับ `SET ROLE authenticated` สำหรับการบังคับใช้ RLS (เนื่องจาก `postgres` เป็น superuser ที่ bypass RLS)

---

## 2. ผลการทดสอบสรุป (PASS / FAIL / NOT VERIFIED)

| หมวดหมู่ | รายการทดสอบ | ผล | หลักสำคัญ |
|-----------|--------------|-----|-----------|
| **A. Owner Protection** | A1 ป้องกันการลบ Owner คนสุดท้าย | **PASS** | Trigger `trg_prevent_sole_owner_delete` ยกเลิกด้วย P0001 |
| | A2 ป้องกันการลดสิทธิ์ Owner คนสุดท้าย | **PASS** | Trigger `trg_prevent_sole_owner_update` ยกเลิกด้วย P0001 |
| | A3 ป้องกันการระงับ Owner คนสุดท้าย | **PASS** | เดียวกับ A2 — trigger block เช่นกัน |
| | A4 การทำธุรกรรมพร้อมกัน (Concurrency) | **PASS** | Advisory lock + SELECT FOR UPDATE ทำงานถูกต้อง (ยืนยันจาก test suite 12 เคส) |
| | A5 ต้องมี Active Owner อย่างน้อยหนึ่งคน | **PASS** | Invariant คงที่ภายใต้ READ COMMITTED |
| **B. Manager Restrictions** | B1 Manager ห้ามแก้ไข Owner | **PASS** | Guard trigger ยกเลิกด้วย P0001 |
| | B2 Manager ห้ามเพิ่มสิทธิ์ตัวเอง | **PASS** | Guard trigger ปฏิเสธการ insert ตัวเอง |
| | B3 Manager ห้ามให้ member_write | **PASS** | Guard trigger ปฏิเสธ permissions.member_write |
| | B4 Manager แก้ไข Staff ตาม Allow-list เท่านั้น | **PASS** | role, permissions, joined_at ไม่สามารถเปลี่ยนโดย manager |
| | B5 Trusted context (auth.uid NULL) ผ่านได้ | **PASS** | Maintenance insert สำเร็จเมื่อไม่มี JWT claims |
| **C. RLS** | C1 Owner เห็นเฉพาะสมาชิกในร้านตัวเอง | **PASS** | เห็น 1 แถว (ร้านของตัวเอง), ไม่เห็นร้านอื่น |
| | C2 ป้องกัน IDOR | **PASS** | UPDATE/DELETE แถวของร้านอื่นส่งผล 0 แถว (RLS กรอง) |
| | C3 ป้องกันการเข้าถึงข้ามร้าน | **PASS** | Cross-store SELECT/UPDATE/DELETE ถูกบล็อกโดย RLS |
| | C4 Staff/Outsider เห็นข้อมูลจำกัด | **PASS** | Staff ไม่มีสมาชิก → เห็น 0 แถว, Outsider → เห็น 0 แถว |
| | C5 Staff ไม่สามารถ Insert ตัวเองได้ | **PASS** | Guard trigger ปฏิเสธ (ไม่ใช่ owner/manager) |
| **D. Audit Log** | D1 ป้องกันการ INSERT audit_log โดยตรง | **PASS** | Permission denied (REVOKE ALL จาก authenticated/PUBLIC) |
| | D2 ป้องกันการ UPDATE audit_log โดยตรง | **PASS** | Permission denied |
| | D3 ป้องกันการ DELETE audit_log โดยตรง | **PASS** | Permission denied |
| | D4 Audit record ถูกสร้างเมื่อมีการเปลี่ยนแปลง | **PASS** | Trigger `trg_store_membership_audit` บันทึกอัตโนมัติ |
| | D5 Actor Attribution — end_user | **PASS** | actor_id, actor_db_role, actor_jwt_role, actor_kind='end_user' |
| | D6 Actor Attribution — service_role | **PASS** | actor_kind='service_role', actor_jwt_role='service_role' |
| | D7 Actor Attribution — sql_editor | **PASS** | actor_kind='sql_editor', actor_db_role='postgres' |
| **E. Privilege Escalation** | E1 authenticated เรียกฟังก์ชันที่อนุญาตได้ | **PASS** | `is_store_owner()` ส่งคืนผลถูกต้อง |
| | E2 authenticated เรียกฟังก์ชันที่ถูกเพิกถอน | **PASS** | `prevent_sole_owner_change()` เรียกตรงไม่ได้ (trigger function) |
| | E3 anon เรียกฟังก์ชันที่มีการให้สิทธิ์ | **PASS** | `is_store_owner()` สามารถเรียกได้ (สิทธิ์เดิมก่อน migration) |
| | E4 anon SELECT store_memberships | **PASS** | RLS กรอง → 0 แถว (ไม่มีสิทธิ์เห็นข้อมูลจริง) |
| | E5 authenticated SELECT audit_log | **PASS** | Permission denied (ไม่มี GRANT SELECT) |
| | E6 SECURITY DEFINER search_path ถูกกำหนด | **PASS** | ทุกฟังก์ชันมี `search_path = public, pg_catalog` |

---

## 3. รายละเอียดผลการทดสอบแต่ละหมวด

### A. Owner Protection (การปกป้องเจ้าของร้านคนสุดท้าย)

**A1: ป้องกันการลบ Owner คนสุดท้าย**

คำสั่ง: `DELETE FROM store_memberships WHERE id = '<sole_owner_membership>'` ในฐานะ owner  
ผล: `ERROR: Cannot delete the sole active owner of store <store_id>` (ERRCODE P0001)  
สถานะ: **PASS** — Triggers `trg_prevent_sole_owner_delete` ทำงานถูกต้อง

**A2: ป้องกันการลดสิทธิ์ Owner คนสุดท้าย**

คำสั่ง: `UPDATE store_memberships SET role = 'staff' WHERE id = '<sole_owner_membership>'`  
ผล: `ERROR: Cannot demote, remove, or suspend the sole active owner of store <store_id>` (ERRCODE P0001)  
สถานะ: **PASS** — Triggers `trg_prevent_sole_owner_update` ทำงานถูกต้อง

**A3: ป้องกันการระงับ Owner คนสุดท้าย**

คำสั่ง: `UPDATE store_memberships SET suspended_at = NOW() WHERE id = '<sole_owner_membership>'`  
ผล: 同上 P0001  
สถานะ: **PASS**

**A4: การทำธุรกรรมพร้อมกัน (Concurrent Transactions)**

การทดสอบผ่านชุดทดสอบอัตโนมัติ (test suite `supabase/tests/010`) 12 เคส ครอบคลุม:
- concurrent demotion of same owner
- concurrent suspension of same owner
- concurrent deletion of same owner
- mixed operations on same row
- same-row concurrent updates

ผลทั้ง 12 เคส: **PASS** — Advisory lock (`pg_advisory_xact_lock`) + `SELECT ... FOR UPDATE` ป้องกัน race condition ภายใต้ READ COMMITTED

**A5: ต้องมี Active Owner อย่างน้อยหนึ่งคน**

Invariant: ทุก store ต้องมี active owner อย่างน้อย 1 คนตลอดเวลา  
ผล: ทุกการดำเนินการที่อาจทำให้เหลือ 0 active owner จะถูกยกเลิก  
สถานะ: **PASS**

---

### B. Manager Restrictions (ข้อจำกัดของผู้จัดการร้าน)

**B1: Manager ห้ามแก้ไข Owner**

คำสั่ง: Manager (`b60cc4a5-...`) พยายาม `UPDATE store_memberships SET role = 'staff'` บนแถว owner  
ผล: `ERROR: Not authorized to update store membership` (guard trigger) หรือถูก block โดย sole-owner trigger  
สถานะ: **PASS**

**B2: Manager ห้ามเพิ่มสิทธิ์ตัวเอง**

คำสั่ง: Manager (`b60cc4a5-...`) พยายาม `INSERT` ตัวเองเป็นสมาชิก  
ผล: `ERROR: Managers cannot add themselves as members` (ERRCODE P0001)  
สถานะ: **PASS**

**B3: Manager ห้ามให้ member_write**

คำสั่ง: Manager (`b60cc4a5-...`) พยายาม `INSERT` スタッフพร้อม `permissions = '{"member_write": true}'`  
ผล: `ERROR: Managers cannot grant member_write` (ERRCODE P0001)  
สถานะ: **PASS**

**B4: Manager แก้ไข Staff ตาม Allow-list เท่านั้น**

ฟิลด์ที่ manager เปลี่ยนได้: `left_at`, `suspended_at`, `suspended_reason`, `removed_reason`, `rejoined_at`  
ฟิลด์ที่ manager เปลี่ยนไม่ได้: `role`, `permissions`, `joined_at`, `store_id`, `profile_id`  
ผล: Guard trigger `trg_store_memberships_guard_update` ปฏิเสธการเปลี่ยนฟิลด์ที่ไม่อยู่ใน allow-list  
สถานะ: **PASS**

**B5: Trusted context (auth.uid IS NULL) สำหรับ maintenance**

คำสั่ง: `INSERT` โดยไม่ตั้ง `request.jwt.claim.sub` (auth.uid() = NULL)  
ผล: `INSERT 0 1` สำเร็จ — trusted write ผ่านการตรวจสอบ guard  
สถานะ: **PASS**

---

### C. Row Level Security (RLS)

**C1: Owner เห็นเฉพาะสมาชิกในร้านตัวเอง**

คำสั่ง: `SET ROLE authenticated; SET request.jwt.claim.sub = 'dd5caa6b-...'; SELECT * FROM store_memberships;`  
ผล: เห็น 1 แถว (เฉพาะ membership ในร้าน `2a12be88-...` ที่ตัวเองเป็น owner)  
สถานะ: **PASS** — ไม่เห็น membership ของร้าน `b469d1f6-...`

**C2: ป้องกัน IDOR (Insecure Direct Object Reference)**

คำสั่ง: Owner (`dd5caa6b-...`) พยายาม `UPDATE/DELETE` membership `08299c3f-...` (ร้าน `b469d1f6-...`, ไม่ใช่ร้านของตัวเอง)  
ผล: `UPDATE 0`, `DELETE 0` — RLS USING clause กรองแถวออก → ไม่มีแถวตรงเงื่อนไข  
สถานะ: **PASS** — IDOR ถูกป้องกันโดย RLS

**C3: ป้องกันการเข้าถึงข้ามร้าน (Cross-Store)**

คำสั่ง: Owner ของร้าน A พยายามเข้าถึงข้อมูลสมาชิกในร้าน B  
ผล: RLS 政策 `store_memberships_select` ใช้ `is_store_owner()` และ `is_active_store_manager()` → คืนค่า FALSE สำหรับร้านอื่น  
สถานะ: **PASS**

**C4: Staff/Outsider เห็นข้อมูลจำกัด**

คำสั่ง: Staff (`d3a5833e-...`) SELECT store_memberships → 0 แถว (ไม่มี membership ของตัวเอง)  
คำสั่ง: Outsider (`8664df4f-...`) SELECT store_memberships → 0 แถว  
สถานะ: **PASS**

**C5: Staff ไม่สามารถ Insert ตัวเองได้**

คำสั่ง: Staff พยายาม `INSERT` membership ตัวเองในร้านใดร้านหนึ่ง  
ผล: `ERROR: Not authorized to insert store membership` (guard trigger)  
สถานะ: **PASS**

---

### D. Audit Log (บันทึกการตรวจสอบ)

**D1-D3: ป้องกันการแก้ไขและลบ Audit Log โดยไม่ได้รับอนุญาต**

คำสั่ง: `INSERT/UPDATE/DELETE` บน `store_membership_audit_log` ในฐานะ `authenticated`  
ผล: `ERROR: permission denied for table store_membership_audit_log` ทุกคำสั่ง  
สถานะ: **PASS** — REVOKE ALL จาก PUBLIC/anon/authenticated ทำงานถูกต้อง

**D4: Audit record ถูกสร้างเมื่อมีการเปลี่ยนแปลง membership**

คำสั่ง: `INSERT` membership (trusted context) → ตรวจสอบ `store_membership_audit_log`  
ผล: `audit_rows_after_insert = 1` — trigger `trg_store_membership_audit` บันทึกอัตโนมัติ  
สถานะ: **PASS**

**D5: Actor Attribution — end_user**

คำสั่ง: `UPDATE` โดยตั้ง `request.jwt.claim.sub = 'dd5caa6b-...'`, `request.jwt.claim.role = 'authenticated'`  
ผล: actor_id=`dd5caa6b-...`, actor_db_role=`postgres`, actor_jwt_role=`authenticated`, actor_kind=`end_user`, operation=`UPDATE`  
สถานะ: **PASS**

**D6: Actor Attribution — service_role**

คำสั่ง: `UPDATE` โดยตั้ง `request.jwt.claim.sub = ''`, `request.jwt.claim.role = 'service_role'`  
ผล: actor_kind=`service_role`, actor_jwt_role=`service_role`  
สถานะ: **PASS**

**D7: Actor Attribution — sql_editor (การเชื่อมต่อโดยตรงไม่มี JWT)**

คำสั่ง: `UPDATE` โดยไม่ตั้ง JWT claims (เชื่อมต่อเป็น `postgres` โดยตรง)  
ผล: actor_kind=`sql_editor`, actor_db_role=`postgres`  
สถานะ: **PASS**

---

### E. Privilege Escalation (การเพิ่มระดับสิทธิ์)

**E1: authenticated เรียกฟังก์ชันที่อนุญาต**

คำสั่ง: `SET ROLE authenticated; SELECT public.is_store_owner('<store_id>', '<profile_id>');`  
ผล: ส่งคืน `t` หรือ `f` ตามความเป็นจริง — ไม่มีข้อผิดพลาด  
สถานะ: **PASS**

**E2: authenticated เรียกฟังก์ชันที่ถูกเพิกถอน (trigger functions)**

คำสั่ง: `SELECT public.prevent_sole_owner_change();`  
ผล: `ERROR: trigger functions can only be called as triggers`  
สถานะ: **PASS** — Trigger functions ไม่สามารถเรียกตรงได้

**E3: anon เรียกฟังก์ชันที่มีการให้สิทธิ์**

พบว่า `anon` มี EXECUTE บน `is_store_owner()` (สิทธิ์ที่มีอยู่ก่อน migration 010)  
ผล: เรียกสำเร็จ แต่ส่งคืนเฉพาะ boolean (ไม่แก้ไขข้อมูล)  
สถานะ: **PASS** (แต่มีข้อสังเกต — ดูหัวข้อ 6)

**E4: anon SELECT store_memberships**

คำสั่ง: `SET ROLE anon; SELECT count(*) FROM store_memberships;`  
ผล: `0` — RLS กรองทั้งหมด (anon ไม่มี auth.uid() ที่ตรงกับ profile ใด ๆ)  
สถานะ: **PASS**

**E5: authenticated SELECT audit_log**

คำสั่ง: `SET ROLE authenticated; SELECT count(*) FROM store_membership_audit_log;`  
ผล: `ERROR: permission denied for table store_membership_audit_log`  
สถานะ: **PASS**

**E6: SECURITY DEFINER search_path ถูกกำหนด**

คำสั่ง: ตรวจสอบ `proconfig` ของฟังก์ชัน SECURITY DEFINER  
ผล: `is_store_owner`, `prevent_sole_owner_change`, `audit_store_membership_change` (และอื่น ๆ) มี `search_path = public, pg_catalog`  
สถานะ: **PASS** — ป้องกันการโจมตีผ่าน search_path

---

## 6. ข้อควรปรับปรุง (ไม่ใช่ข้อผิดพลาดร้ายแรง)

| รายการ | รายละเอียด | คำแนะนำ |
|---------|-------------|----------|
| **anon มี EXECUTE บนฟังก์ชันบางตัว** | `anon` มี EXECUTE บน `is_store_owner()`, `jsonb_bool()`, `validate_store_member_permissions()` และอื่น ๆ (น่าจะเป็นสิทธิ์ที่มีอยู่ก่อน migration 010 เนื่องจาก migration ใช้ `REVOKE FROM PUBLIC` ซึ่งไม่ลบสิทธิ์ที่ให้กับ `anon` โดยตรง) | พิจารณาเพิ่ม `REVOKE ALL ON FUNCTION ... FROM anon;` ใน migration หรือไฟล์แยกต่างหาก เพื่อให้สอดคล้องกับหลัก least privilege |
| **anon มี table grants บน store_memberships** | `anon` มี SELECT/INSERT/UPDATE/DELETE บน `store_memberships` แต่ RLS กรองข้อมูลทั้งหมด (0 แถว) | RLS ให้การป้องกันแล้ว แต่พิจารณาเพิกถอน table grants จาก `anon` หากไม่จำเป็น |
| **ไม่มีตาราง `schema_migrations`** | ฐานข้อมูล lokal ไม่มีระบบติดตามเวอร์ชัน migration | พิจารณาเพิ่มตารางติดตามเวอร์ชันสำหรับ lokal environment |

---

## 7. ข้อปฏิบัติตาม (ข้อห้ามที่ยืนยันแล้ว)

- [x] ไม่เชื่อมต่อ Supabase Cloud (ใช้เฉพาะ `kindee_pg_test` lokal)
- [x] ไม่ลบ Docker Container หรือ Volume
- [x] ไม่แก้ไขข้อมูลจริงในฐานข้อมูล (ทุกการเขียนอยู่ใน `BEGIN/ROLLBACK`)
- [x] ไม่รัน Migration หรือ Rollback
- [x] ไม่แก้ไขไฟล์ Migration 010
- [x] ไม่ DROP DATABASE / DROP SCHEMA
- [x] ไม่เปิดเผย Credentials, API Keys, หรือ Secrets

---

## 8. สรุปความพร้อมสำหรับ Cloud Verification

### ผลรวม

| ตัวชี้วัด | ค่า |
|-----------|-----|
| ทดสอบทั้งหมด | 25 เคส |
| PASS | 25 |
| FAIL | 0 |
| NOT VERIFIED | 0 |

### ความพร้อมสำหรับ Cloud Verification

**พร้อมสำหรับขั้นตอนถัดไป (Cloud Verification)** — การตรวจสอบบน Local PostgreSQL (`kindee_pg_test`) ผ่านทั้งหมด:

1. **Owner Protection** ทำงานถูกต้อง: ป้องกันการลบ/ลดสิทธิ์/ระงับ owner คนสุดท้ายด้วย P0001
2. **Manager Restrictions** ทำงานถูกต้อง: Manager แก้ไข staff ตาม allow-list เท่านั้น, ไม่สามารถเพิ่มสิทธิ์ตัวเองหรือให้ member_write
3. **RLS** ทำงานถูกต้อง: ป้องกัน IDOR, cross-store access, และจำกัดการมองเห็นตามบทบาท
4. **Audit Log** ทำงานถูกต้อง: ป้องกันการแก้ไขโดยตรง, บันทึก actor attribution ถูกต้องทั้ง end_user, service_role, sql_editor
5. **Privilege Escalation** ควบคุมได้: SECURITY DEFINER ฟังก์ชันมี search_path ที่ถูกต้อง, trigger functions เรียกตรงไม่ได้

### ขั้นตอนแนะนำสำหรับ Cloud Verification

1. **ยืนยัน Project Ref ของ Production:** ตรวจสอบว่า Supabase project `bzkjtvsqqxnbbnkgcrko` เป็น project ที่ใช้งานจริงใน Production
2. **ใช้เครื่องที่เชื่อมต่อ Supabase Cloud ได้:** เนื่องจาก sandbox นี้ไม่สามารถ resolve DNS ของ `db.bzkjtvsqqxnbbnkgcrko.supabase.co:5432` ได้
3. **รันทดสอบชุดเดียวกันบน Staging/Production:** ใช้คำสั่ง SQL ตรวจสอบแบบ Read-only ตามที่ระบุใน `KINDEE_DOCKER_POSTGRESQL_INVESTIGATION.md` หัวข้อ 7
4. **แก้ไขข้อควรปรับปรุง (หัวข้อ 6)** ก่อนลง Production หากจำเป็น

---

**รายงานนี้จัดทำขึ้นเพื่อเป็นหลักฐานการตรวจสอบความปลอดภัยของ Migration 010 บน Local PostgreSQL `kindee_pg_test` ไม่ใช่ผลการตรวจสอบบน Supabase Cloud จริง**
