# KINDEE_MIGRATION_010_FINAL_HARDENING_REPORT.md

**วันที่สร้าง:** 2026-11-18T15:40:00Z
**โครงการ:** kindee-marketplace
**ขอบเขต:** ตรวจสอบสิทธิ์ส่วนเกิน (Least Privilege) ของ `anon` / `authenticated` / `service_role` บนออบเจ็กต์ที่ Migration 010 สร้าง
**ฐานข้อมูลที่ตรวจ:** Docker Container `kindee_pg_test` (PostgreSQL 15.20) → database `kindee` (Local / Isolated)
**อ้างอิงรายงานก่อนหน้า:** `KINDEE_MIGRATION_010_LOCAL_SECURITY_VERIFICATION.md` (25/25 PASS — functional security)

---

## 0. บทสรุปผู้บริหาร (Executive Summary)

| มิติการตรวจ | ผล | ระดับ |
|-------------|-----|-------|
| ความถูกต้องของกลไกความปลอดภัยของ 010 (RLS / Trigger / Audit / Sole-owner) | **PASS** (คงผลเดิม 25/25) | — |
| **Least Privilege — Function Grants** | **FAIL** | P2 (Medium) |
| **Least Privilege — Table Grants (`anon` บน `store_memberships`)** | **FAIL** | P2 (Medium) |
| Least Privilege — `authenticated` บน Trigger Functions | **FAIL (ต่ำ)** | P3 (Low) |
| **Privilege Escalation Channel** | **PASS — ไม่พบช่องทาง** | — |
| SECURITY DEFINER + `search_path` | **PASS** (10/10 ฟังก์ชัน pin แล้ว, 0 ตัวที่ไม่ pin) | — |
| **ความพร้อมก่อน Cloud Verification** | **READY (Conditional)** | — |

**สาระสำคัญ:** Migration 010 ใช้รูปแบบ `REVOKE ALL ... FROM PUBLIC` ซึ่ง **ไม่สามารถเพิกถอนสิทธิ์ที่ `anon`/`authenticated`/`service_role` ได้รับโดยตรงจาก Default Privileges ของ Supabase** ผลคือ `anon` ยังคงมี `EXECUTE` ครบทั้ง 10 ฟังก์ชันของ 010 และมี `SELECT/INSERT/UPDATE/DELETE` บน `store_memberships` ครบถ้วน

**อย่างไรก็ตาม ไม่พบ Privilege Escalation ที่ใช้งานได้จริง** เนื่องจาก RLS ยังบล็อกทุกเส้นทางการเขียนของ `anon` (พิสูจน์ด้วยการทดสอบจริงในหัวข้อ 8) และ trigger functions ไม่สามารถเรียกตรงได้ (`trigger functions can only be called as triggers`) ช่องโหว่ที่เหลือคือ **defense-in-depth + boolean information oracle** จึงจัดเป็น P2 ไม่ใช่ P1

**คำตัดสิน:** ยังไม่ควรลง Production โดยไม่แก้ F1/F2 แต่ **ไม่บล็อก Cloud Verification** เพราะเป็นเรื่องสิทธิ์ส่วนเกิน ไม่ใช่ช่องโหว่ที่ถูกใช้ได้จริง

---

## 1. วิธีการตรวจสอบ (Read-only)

- เชื่อมต่อเฉพาะ container `kindee_pg_test` ผ่าน `docker exec psql` — ไม่มีการเชื่อมต่อ Supabase Cloud
- ใช้เฉพาะคำสั่งอ่าน: `pg_proc`, `pg_class`, `pg_policies`, `pg_default_acl`, `pg_auth_members`, `has_function_privilege()`, `has_table_privilege()`, `has_column_privilege()`, `has_schema_privilege()`
- การทดสอบเชิงพฤติกรรมใช้ `BEGIN; SET LOCAL ROLE anon; ...; ROLLBACK;` ทุกครั้ง
- ตรวจยืนยันหลังทดสอบว่าไม่มีข้อมูลเปลี่ยน: `store_memberships` = 2 แถว, `store_membership_audit_log` = 0 แถว (เท่าก่อนทดสอบ)
- ไม่ได้ Execute SQL แก้ไขใด ๆ — ข้อเสนอทั้งหมดอยู่ในหัวข้อ 10 (สถานะ: **NOT APPLIED**)

---

## 2. วัตถุประสงค์ 1 — `anon` EXECUTE บนฟังก์ชันของ Migration 010

### 2.1 ผลตรวจ ACL จริง

| ฟังก์ชัน | SECURITY DEFINER | ACL ที่มีผล | `anon` EXECUTE |
|----------|------------------|-------------|----------------|
| `is_store_owner(uuid,uuid)` | ใช่ | `postgres, anon, authenticated, service_role` | **ใช่ (เกิน)** |
| `jsonb_bool(jsonb,text)` | ไม่ | เหมือนกัน | **ใช่ (เกิน)** |
| `is_active_store_manager(uuid,uuid,boolean)` | ใช่ | เหมือนกัน | **ใช่ (เกิน)** |
| `is_active_store_member(uuid,uuid)` | ใช่ | เหมือนกัน | **ใช่ (เกิน)** |
| `validate_store_member_permissions(jsonb)` | ไม่ | เหมือนกัน | **ใช่ (เกิน)** |
| `prevent_sole_owner_change()` | ใช่ | เหมือนกัน | **ใช่ (เกิน)** |
| `prevent_sole_owner_delete()` | ใช่ | เหมือนกัน | **ใช่ (เกิน)** |
| `store_memberships_guard_insert()` | ไม่ | เหมือนกัน | **ใช่ (เกิน)** |
| `store_memberships_guard_update()` | ไม่ | เหมือนกัน | **ใช่ (เกิน)** |
| `audit_store_membership_change()` | ใช่ | เหมือนกัน | **ใช่ (เกิน)** |

**สรุป: 10/10 ฟังก์ชันที่ `anon` มี EXECUTE — จำเป็นจริง 0 ฟังก์ชัน**

การยืนยันด้วย `has_function_privilege()` ให้ผลตรงกันทั้ง 10 รายการ (`t` ทุกแถว)

### 2.2 Root cause (สาเหตุที่แท้จริง)

```
pg_default_acl (owner = postgres, schema = public):
  functions : anon=X, authenticated=X, service_role=X
  tables    : anon=arwd, authenticated=arwd, service_role=arwd
```

สาเหตุคือ Supabase bootstrap ตั้ง `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ...` ไว้ (สะท้อนใน test harness `supabase/tests/010/00_base_schema.sql:102-104`) ทำให้:

1. ตอน `CREATE OR REPLACE FUNCTION` ฟังก์ชันใหม่ได้ grant ตรงให้ `anon`, `authenticated`, `service_role` ทันที
2. `REVOKE ALL ... FROM PUBLIC` ในบรรทัด 566-575 ของ 010 **ไม่แตะ grant ตรงของ role เหล่านั้น** (ACL ไม่มี entry ของ PUBLIC อยู่แล้ว จึงเป็น no-op)
3. `GRANT EXECUTE ... TO authenticated` (บรรทัด 577-581) ซ้ำกับสิทธิ์ที่มีอยู่แล้ว — ไม่ได้ "จำกัด" อะไร

**ACL ไม่มี entry `=X/postgres` (PUBLIC) เหลืออยู่ → ยืนยันว่า `REVOKE FROM PUBLIC` ทำงาน แต่ไม่เพียงพอ**

### 2.3 ผลกระทบในระดับระบบ (ไม่จำกัดเฉพาะ 010)

| ตัวชี้วัด | ค่า |
|-----------|-----|
| ฟังก์ชันทั้งหมดใน schema `public` | 56 |
| ฟังก์ชันที่ `anon` มี EXECUTE | **56 (100%)** |
| ฟังก์ชันของ 010 | 10 |
| ฟังก์ชันจาก migration อื่นที่ `anon` ก็มี EXECUTE | **46** |

→ เป็นปัญหาเชิงระบบ (process-level) ไม่ใช่แค่ 010 การแก้เฉพาะ 010 จะทำให้ตัวเลขเป็น 46/46 ซึ่งยังไม่ถูกต้องตาม least privilege แต่ขอบเขตงานนี้จำกัดที่ 010

---

## 3. วัตถุประสงค์ 2 — `anon` Table Grants บน `store_memberships`

```
store_memberships            acl: postgres=arwdDxt, anon=arwd, authenticated=arwd, service_role=arwd
store_membership_audit_log   acl: postgres=arwdDxt, service_role=arwd
                               (anon/authenticated: ไม่มีสิทธิ์ใด ๆ — ถูกต้อง)
```

| สิทธิ์ | anon | authenticated | service_role |
|--------|------|---------------|--------------|
| SELECT | **ใช่ (เกิน)** | ใช่ (จำเป็น) | ใช่ (trusted) |
| INSERT | **ใช่ (เกิน)** | ใช่ (จำเป็น) | ใช่ |
| UPDATE | **ใช่ (เกิน)** | ใช่ (จำเป็น) | ใช่ |
| DELETE | **ใช่ (เกิน)** | ใช่ (จำเป็น) | ใช่ |
| TRUNCATE | ไม่ | ไม่ | ไม่ |
| REFERENCES | ไม่ | ไม่ | ไม่ |
| TRIGGER | ไม่ | ไม่ | ไม่ |

`anon` ยังมี **column-level SELECT ครบทุกคอลัมน์** ของ `store_memberships` (ยืนยันด้วย `has_column_privilege`) → RLS เป็นด่านเดียวที่กันข้อมูลไว้

**ผลลัพธ์:** RLS ให้ผลถูกต้อง (0 แถว) แต่สถาปัตยกรรมปัจจุบันพึ่ง RLS เพียงชั้นเดียว ซึ่งขัดกับหลัก least privilege และเสี่ยงถ้ามีผู้เพิ่ม policy แบบ permissive สำหรับ `anon` ในอนาคต

---

## 4. วัตถุประสงค์ 3 — `authenticated` และ `service_role`

### 4.1 ตารางตัดสิน "จำเป็น / ไม่จำเป็น"

| ฟังก์ชัน | authenticated | จำเป็นหรือไม่ | เหตุผล |
|----------|---------------|----------------|--------|
| `is_store_owner` | มี | **จำเป็น** | ถูกเรียกใน RLS policy (SELECT/INSERT/UPDATE/DELETE) ด้วยสิทธิ์ของผู้เรียก |
| `is_active_store_manager` | มี | **จำเป็น** | ใช้ใน policy 3 จุด |
| `is_active_store_member` | มี | **จำเป็น** | ใช้ใน policy `conversations_store_members_select` |
| `jsonb_bool` | มี | **จำเป็น** | ใช้ใน `WITH CHECK` ของ INSERT policy |
| `validate_store_member_permissions` | มี | **จำเป็น** | ใช้ใน `WITH CHECK` ของ INSERT/UPDATE policy |
| `prevent_sole_owner_change` | มี | **ไม่จำเป็น** | trigger function — ไม่ต้องมี EXECUTE สำหรับ client |
| `prevent_sole_owner_delete` | มี | **ไม่จำเป็น** | trigger function |
| `store_memberships_guard_insert` | มี | **ไม่จำเป็น** | trigger function |
| `store_memberships_guard_update` | มี | **ไม่จำเป็น** | trigger function |
| `audit_store_membership_change` | มี | **ไม่จำเป็น** | trigger function |

→ `authenticated` มีสิทธิ์เกิน **5 ฟังก์ชัน** (trigger/guard) แต่ **ผลกระทบต่ำมาก** เพราะเรียกตรงไม่ได้ (หัวข้อ 8.3)

**ข้อควรระวังสำคัญ:** ต้อง **ห้าม** revoke 5 ฟังก์ชันที่จำเป็นออกจาก `authenticated` — ถ้าทำ RLS ทั้งหมดของ 010 จะล้มเหลวทันที (permission denied for function)

### 4.2 `service_role`

- มี EXECUTE 10/10 และมี `arwd` บนทั้งสองตาราง; `rolbypassrls = true`
- **ยอมรับได้** — เป็น role ของ backend ที่ trusted อยู่แล้ว และ `service_role` ไม่ต้องพึ่ง RLS
- ไม่อยู่ในข้อเสนอแก้ไข (เพื่อลด blast radius) เว้นแต่ต้องการ least privilege สูงสุด

### 4.3 ตาราง `store_membership_audit_log`

`anon` และ `authenticated` = ไม่มีสิทธิ์ใด ๆ ทั้ง SELECT/INSERT/UPDATE/DELETE/TRUNCATE (ยืนยัน 7/7 ค่าเป็น `f`) → **ถูกต้องตามการออกแบบ**

---

## 5. วัตถุประสงค์ 4 — ผลกระทบต่อระบบเดิม

| ประเด็น | ผลการตรวจ | ผลกระทบ |
|---------|-----------|---------|
| Frontend เรียก `store_memberships` / helper โดยตรง | **ไม่พบ** (`frontend/src` ไม่มี match) | การ revoke `anon` ไม่กระทบ client |
| Frontend ใช้ RPC ของ helper | **ไม่พบ** | ปลอดภัย |
| RLS policies พึ่ง helper | 5 policy clauses | **ห้าม revoke จาก `authenticated`** |
| ตารางอื่น (`stores`, `profiles`, `conversations`) | `anon=r` (SELECT) จาก default ACL | อยู่นอกขอบเขต 010 แต่เป็นปัญหาเดียวกัน |
| `002_rls_policies.sql` "Public can view active stores" | `USING (is_active AND is_verified)` | การเปิดเผย `owner_id` ของร้านที่ active+verified เป็น **ดีไซน์เดิม** ไม่ใช่ผลจาก 010 |

**ผลต่อ `is_store_owner` oracle:** `anon` เรียก `is_store_owner(<store>, <uid>)` ได้และได้ค่า `t/f` (พิสูจน์แล้วในหัวข้อ 8.4) แต่เนื่องจากตาราง `stores` เปิดให้ public เห็นร้าน active+verified อยู่แล้ว ความรู้ที่เพิ่มขึ้นจึงจำกัดอยู่ที่ "ยืนยันความสัมพันธ์ owner ของร้านที่ยังไม่ active/verified" → **severity ต่ำ (information disclosure only, ไม่มีการเขียนข้อมูล)**

---

## 6. วัตถุประสงค์ 5 — แยกสิทธิ์จำเป็น / ไม่จำเป็น (สรุป)

### ต้องคงไว้

```text
authenticated: EXECUTE on is_store_owner, is_active_store_manager,
               is_active_store_member, jsonb_bool,
               validate_store_member_permissions
authenticated: SELECT/INSERT/UPDATE/DELETE on store_memberships
service_role : คงเดิมทั้งหมด (trusted backend)
postgres     : owner/superuser (migration & admin)
```

### ต้องเพิกถอน (ข้อเสนอ)

```text
anon          : EXECUTE ทั้ง 10 ฟังก์ชันของ 010            (10 รายการ)
anon          : SELECT/INSERT/UPDATE/DELETE on store_memberships   (1 ตาราง)
authenticated : EXECUTE บน trigger/guard functions 5 ตัว   (5 รายการ)
```

---

## 7. วัตถุประสงค์ 6 — SECURITY DEFINER และ `search_path`

| การตรวจ | ผล |
|---------|-----|
| จำนวน SECURITY DEFINER ใน schema `public` | 6 ฟังก์ชัน (ทั้งหมดมาจาก 010) |
| ฟังก์ชัน SECURITY DEFINER ที่ **ไม่มี** `search_path` | **0** |
| ค่า `proconfig` | `search_path=public, pg_catalog` ทุกตัว |
| owner ของฟังก์ชัน | `postgres` (superuser, `rolbypassrls=t`) |
| ฟังก์ชัน non-SECDEF (guard/helpers) | ก็ pin `search_path` เช่นกัน (defense-in-depth) |
| `anon`/`authenticated` มี CREATE บน schema `public` | **ไม่** (`anon_create=f`, `auth_create=f`) |
| ความเสี่ยง shadowing `pg_advisory_xact_lock` ผ่าน schema | **ไม่มี** — ไม่มีสิทธิ์ CREATE ใน `public` |

**ข้อสังเกต P3 (ไม่ต้องแก้):** `search_path = public, pg_catalog` วาง `public` ก่อน ซึ่งตามทฤษฎีเปิดช่อง function shadowing แต่ถูก neutralize แล้วเพราะ role ที่ไม่ใช่ owner ไม่มี CREATE บน `public` หากต้องการ hardening สูงสุดในอนาคตสามารถใช้ `search_path = ''` และ qualify ทุกชื่อ — **ไม่แนะนำให้แก้ในรอบนี้** เพราะเสี่ยง regression สูงและไม่ได้ลดความเสี่ยงจริง

---

## 8. วัตถุประสงค์ 7 — Privilege Escalation

### 8.1 ตารางผลทดสอบ (ดำเนินการจริง, rollback ทุกครั้ง)

| # | การทดสอบ | ผลลัพธ์จริง | การแปลผล |
|---|----------|-------------|----------|
| T1 | `SET ROLE anon; SELECT count(*) FROM store_memberships` | `0` | RLS กรองหมด — PASS |
| T2 | `SET ROLE anon; INSERT INTO store_memberships ...` | `ERROR: new row violates row-level security policy` | เขียนไม่ได้ — PASS |
| T3 | `SET ROLE anon; UPDATE store_memberships ...` | `UPDATE 0` | ไม่มีแถวตรงเงื่อนไข — PASS |
| T4 | `SET ROLE anon; DELETE FROM store_memberships ...` | `DELETE 0` | ไม่มีแถวตรงเงื่อนไข — PASS |
| T5 | `SET ROLE anon; SELECT ... FROM store_membership_audit_log` | `ERROR: permission denied for table store_membership_audit_log` | PASS |
| T6 | `anon.is_store_owner(ร้านจริง, owner จริง)` | `t` | มี oracle (P2) |
| T7 | `anon.is_store_owner(ร้านจริง, uid สุ่ม)` | `f` | oracle ทำงานตามจริง |
| T8 | `anon.is_active_store_manager(...)` (seed manager ใน transaction) | `t` | มี oracle (P2) |
| T9 | `anon.is_active_store_member(...)` (seed manager ใน transaction) | `t` | มี oracle (P2) |
| T10 | `anon.audit_store_membership_change()` | `ERROR: trigger functions can only be called as triggers` | เรียกตรงไม่ได้ — PASS |
| T11 | `anon.store_memberships_guard_update()` | error เดียวกัน | PASS |
| T12 | `anon.store_memberships_guard_insert()` | error เดียวกัน | PASS |
| T13 | `anon.prevent_sole_owner_change()` | error เดียวกัน | PASS |

**ยืนยันไม่มีการแก้ไขฐานข้อมูล:** หลังทดสอบ `store_memberships = 2`, `store_membership_audit_log = 0` (เท่าก่อนทดสอบ)

### 8.2 เส้นทาง escalation ที่ตรวจแล้วว่าไม่มี

1. **เขียนผ่าน RLS** — INSERT/UPDATE/DELETE ของ `anon` ถูกบล็อกที่ policy ทุก verb
2. **เขียนผ่าน audit table** — ไม่มี grant; SECURITY DEFINER writer เรียกตรงไม่ได้
3. **เรียก trigger function ตรง** — PostgreSQL ปฏิเสธที่ compile time (4/4)
4. **ใช้ guard trigger เป็น backdoor** — guard เป็น invoker function (ไม่ใช่ SECURITY DEFINER) และ RLS ยังทำงาน
5. **ใช้ trusted-context bypass (`auth.uid() IS NULL`)** — guard `RETURN NEW` แต่ **RLS `WITH CHECK` ยังบังคับ** และ `auth.uid()` ของ `anon` เป็น NULL → `is_store_owner(store_id, NULL)` = false → ถูกปฏิเสธ (T2 พิสูจน์แล้ว)
6. **JWT claim forgery** — client ปลอม `request.jwt.claim.sub` ไม่ได้ผ่าน PostgREST (ไม่มี JWT secret) และแม้ปลอมได้ guard ยังตรวจ ownership ในฐานข้อมูลจริง
7. **Role membership** — `anon`, `authenticated`, `service_role`, `authenticator` ไม่มี membership ใด ๆ ใน `pg_auth_members`
8. **Function shadowing** — ไม่มี CREATE บน `public` + `search_path` pin
9. **Dynamic SQL / SQL injection ใน SECURITY DEFINER** — ไม่มี `EXECUTE`/`format()`; ใช้ parameterized query เท่านั้น

**สรุป: ไม่พบช่องทาง Privilege Escalation ที่ใช้งานได้จริง**

### 8.3 หมายเหตุความแม่นยำ (ข้อจำกัดของสิ่งแวดล้อมทดสอบ)

ฐานข้อมูลทดสอบนี้มี policy สำหรับ test harness ที่ **ไม่มีใน production**:

```text
stores       : test_stores_read          USING (true)
profiles     : test_profiles_self        USING (id = auth.uid() OR auth.uid() IS NULL)
conversations: test_conversations_read   USING (true)
```

(ที่มา: `supabase/tests/010/00_base_schema.sql:117-118`)

ผลคือ `anon` เห็น `stores` 2 แถว และ `profiles` 7 แถว **ซึ่งเป็นพฤติกรรมของ test DB เท่านั้น** ใน production ตาม `002_rls_policies.sql` `anon` จะเห็นเฉพาะร้าน `is_active AND is_verified` และไม่เห็น `profiles` เลย → oracle impact ใน production ต่ำกว่าที่วัดใน test DB

**ต้องตรวจใน Cloud Verification:** ยืนยันว่า production ไม่มี policy ชื่อขึ้นต้นด้วย `test_` (ตรวจด้วย query ในหัวข้อ 11.3)

---

## 9. สรุป Finding

| ID | Finding | หลักฐาน | Severity | Priority |
|----|---------|---------|----------|----------|
| **F1** | `anon` มี EXECUTE ครบ 10/10 ฟังก์ชันของ 010 | `has_function_privilege` = `t` 10/10 | Medium | **P2** |
| **F2** | `anon` มี SELECT/INSERT/UPDATE/DELETE บน `store_memberships` (RLS เป็นด่านเดียว) | `relacl anon=arwd` | Medium | **P2** |
| **F3** | `authenticated` มี EXECUTE บน trigger/guard 5 ตัว | ACL | Low | P3 |
| **F4** | Default Privileges ทำให้ทุกฟังก์ชันใหม่ใน `public` ได้ `anon` EXECUTE โดยปริยาย (56/56) | `pg_default_acl` | Medium | **P2** |
| **F5** | RLS policies ของ 010 สร้างโดยไม่มี `TO authenticated` (default = PUBLIC) | `pg_policies.roles = {public}` | Low | P3 |
| **F6** | Test-harness policies (`test_*` USING true) ปนใน DB ทดสอบ | `pg_policies` | Info | — |
| **F7** | SECURITY DEFINER ทั้ง 6 ตัว owner = superuser `postgres` | `pg_proc.proowner` | Info | P3 |

**ไม่ใช่ Finding (ถูกต้องแล้ว):** audit log ถูกล็อกสนิท, `search_path` pin ครบ, ไม่มี escalation path, ไม่มี PUBLIC grant เหลือ

---

## 10. ข้อเสนอ SQL แก้ไข — สถานะ: **NOT EXECUTED**

> ห้าม Execute ในขั้นนี้ ตามข้อกำหนดของงาน
> แนะนำสร้างเป็น migration ใหม่ `supabase/migrations/013_harden_migration_010_privileges.sql` (ไม่แก้ 010)
> DDL ใน PostgreSQL เป็น transactional → ใช้ `BEGIN/COMMIT` ครอบได้ และ rollback ได้ทันที

```sql
-- 013_harden_migration_010_privileges.sql  (PROPOSED — NOT EXECUTED)
BEGIN;

-- ---------------------------------------------------------------------------
-- H1: เพิกถอน anon EXECUTE ออกจากฟังก์ชันทั้งหมดของ 010
--     (รวมการถอนจาก PUBLIC ซ้ำเพื่อ idempotency)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_store_owner(uuid, uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.jsonb_bool(jsonb, text)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_store_manager(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_store_member(uuid, uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_store_member_permissions(jsonb) FROM PUBLIC, anon;

-- trigger/guard functions: ไม่ต้องมี EXECUTE สำหรับ client ใด ๆ
REVOKE ALL ON FUNCTION public.prevent_sole_owner_change()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_sole_owner_delete()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_memberships_guard_insert()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_memberships_guard_update()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_store_membership_change()     FROM PUBLIC, anon, authenticated;

-- ยืนยันสิทธิ์ที่จำเป็นสำหรับ authenticated (คงไว้ — ห้ามถอน)
GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid, uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_manager(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_member(uuid, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.jsonb_bool(jsonb, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_store_member_permissions(jsonb)  TO authenticated;

-- ---------------------------------------------------------------------------
-- H2: ตัด table privileges ของ anon บน store_memberships
--     (authenticated ต้องคง CRUD ไว้สำหรับ PostgREST)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.store_memberships FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_memberships TO authenticated;

-- ---------------------------------------------------------------------------
-- H3: จำกัด RLS policies ให้เฉพาะ authenticated
--     (DROP + CREATE เพราะ ALTER POLICY ไม่รองรับการเปลี่ยน role list)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS store_memberships_select ON public.store_memberships;
CREATE POLICY store_memberships_select ON public.store_memberships
    FOR SELECT TO authenticated USING (
        profile_id = auth.uid()
        OR public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), FALSE)
    );

DROP POLICY IF EXISTS store_memberships_insert ON public.store_memberships;
CREATE POLICY store_memberships_insert ON public.store_memberships
    FOR INSERT TO authenticated WITH CHECK (
        public.validate_store_member_permissions(permissions)
        AND (
            public.is_store_owner(store_id, auth.uid())
            OR (
                public.is_active_store_manager(store_id, auth.uid(), TRUE)
                AND profile_id <> auth.uid()
                AND role = 'staff'
                AND left_at IS NULL
                AND suspended_at IS NULL
                AND NOT public.jsonb_bool(permissions, 'member_write')
            )
        )
    );

DROP POLICY IF EXISTS store_memberships_update ON public.store_memberships;
CREATE POLICY store_memberships_update ON public.store_memberships
    FOR UPDATE TO authenticated
    USING (
        public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), TRUE)
    )
    WITH CHECK (
        public.validate_store_member_permissions(permissions)
        AND (
            public.is_store_owner(store_id, auth.uid())
            OR public.is_active_store_manager(store_id, auth.uid(), TRUE)
        )
    );

DROP POLICY IF EXISTS store_memberships_delete ON public.store_memberships;
CREATE POLICY store_memberships_delete ON public.store_memberships
    FOR DELETE TO authenticated USING (
        public.is_store_owner(store_id, auth.uid())
    );

DROP POLICY IF EXISTS conversations_store_members_select ON public.conversations;
CREATE POLICY conversations_store_members_select ON public.conversations
    FOR SELECT TO authenticated USING (
        public.is_store_owner(conversations.store_id, auth.uid())
        OR public.is_active_store_member(conversations.store_id, auth.uid())
    );

COMMIT;
```

### Rollback (ถ้าจำเป็น)

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid,uuid) TO anon;  -- คืนเฉพาะที่ต้องการ
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_memberships TO anon;
COMMIT;
```

### ข้อควรระวังเมื่อนำไปใช้

1. **ห้ามถอน EXECUTE ของ 5 helper ออกจาก `authenticated`** — จะทำให้ RLS ของตารางล้มทันที
2. ไม่แตะ `service_role` (trusted backend) เพื่อจำกัด blast radius
3. ไม่แก้ `ALTER DEFAULT PRIVILEGES` ของ schema ในรอบนี้ — อาจกระทบฟังก์ชันอื่น 46 ตัวที่แอปอาจใช้; ควรเป็นงานแยก (F4)
4. การ `DROP/CREATE POLICY` อยู่ใน transaction เดียว จึงไม่มีช่วงที่ policy หายไปจริง

---

## 11. คำสั่งตรวจซ้ำ (Read-only) สำหรับ Cloud Verification

### 11.1 ตรวจ anon EXECUTE

```sql
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('is_store_owner','jsonb_bool','is_active_store_manager',
                    'is_active_store_member','validate_store_member_permissions',
                    'prevent_sole_owner_change','prevent_sole_owner_delete',
                    'store_memberships_guard_insert','store_memberships_guard_update',
                    'audit_store_membership_change')
ORDER BY 1;
```

### 11.2 ตรวจ table grants

```sql
SELECT c.relname, coalesce(array_to_string(c.relacl, ','), '(default)') AS acl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('store_memberships','store_membership_audit_log');
```

### 11.3 ตรวจ policy ตกค้างจาก test harness (ต้องได้ 0 แถวบน production)

```sql
SELECT schemaname, tablename, policyname, roles::text
FROM pg_policies
WHERE schemaname='public' AND policyname LIKE 'test\_%';
```

### 11.4 ตรวจ SECURITY DEFINER ที่ไม่ pin search_path (ต้องได้ 0 แถว)

```sql
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
  AND (p.proconfig IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));
```

---

## 12. ความพร้อมก่อน Cloud Verification

| เกณฑ์ | สถานะ |
|-------|-------|
| กลไกความปลอดภัยของ 010 ทำงานถูกต้อง (25/25) | **PASS** |
| ไม่มีช่องทาง Privilege Escalation | **PASS** |
| SECURITY DEFINER + `search_path` ครบถ้วน | **PASS** |
| Audit log ถูกล็อกจากการเข้าถึงของ client | **PASS** |
| Least privilege (function grants) | **FAIL — F1** |
| Least privilege (table grants) | **FAIL — F2** |
| ความเสี่ยงจริงจากการใช้สิทธิ์เกิน | **ต่ำ** — RLS บล็อกทุก verb (พิสูจน์แล้ว) |

### คำตัดสิน

**READY (Conditional) — ไป Cloud Verification ได้ แต่ยังไม่ควรลง Production ก่อน 적용 013**

เหตุผล:

1. สิทธิ์ส่วนเกินเป็นเรื่อง **defense-in-depth** ไม่ใช่ช่องโหว่ที่ใช้เขียนข้อมูลได้ (T1–T5, T10–T13 ยืนยัน)
2. Cloud Verification ต้องตรวจ **พฤติกรรมบน production จริง** ซึ่งไม่ขึ้นกับ F1/F2 (RLS ทำงานเหมือนกัน) → ไปต่อได้
3. ก่อน Production cutover ควร apply 013 เพื่อให้สอดคล้อง least privilege และปิด oracle
4. ระหว่าง Cloud Verification ให้ตรวจเพิ่ม 3 ข้อ: (ก) ค่า `pg_default_acl` ของ project จริง (ข) ไม่มี policy `test_*` (ค) ไม่มีตาราง/ฟังก์ชันที่ `anon` มีสิทธิ์เขียนเกินความจำเป็น

**ลำดับที่แนะนำ:** Cloud Verification (behavior) → Apply 013 บน staging → ตรวจซ้ำหัวข้อ 11 → Production

---

## 13. การปฏิบัติตามข้อกำหนด

- [x] ใช้ Local Docker PostgreSQL เท่านั้น (`kindee_pg_test`)
- [x] ไม่แก้ไขฐานข้อมูล (ทุกการเขียนอยู่ใน `BEGIN/ROLLBACK`; ยืนยัน row count เท่าเดิม)
- [x] ไม่แก้ไข Migration 010
- [x] ไม่เชื่อมต่อ Supabase Cloud
- [x] ไม่เปิดเผย Secrets / Credentials / API Keys
- [x] เสนอ SQL แก้ไขแต่ **ไม่ Execute**

---

**หลักฐานประกอบ:** query ทั้งหมดสามารถรันซ้ำได้ด้วยคำสั่งในหัวข้อ 11 และผลทดสอบเชิงพฤติกรรมในหัวข้อ 8 ถูกบันทึกครบถ้วนพร้อมผลลัพธ์จริงจาก container `kindee_pg_test`
