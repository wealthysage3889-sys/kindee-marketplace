# KINDEE_MIGRATION_013_LOCAL_EXECUTION_REPORT.md

**วันที่ Execute:** 2026-11-18T16:20:00Z
**โครงการ:** kindee-marketplace
**ไฟล์ที่ Execute:** `supabase/migrations/013_harden_migration_010_privileges.sql`
**SHA256 ของไฟล์:** `4BE4F796749FCF587C7C613EFE95890C11777C044E8477F06FCFC259C2D263F3`
**ขอบเขต:** Execute Part A บน Local Docker PostgreSQL เท่านั้น
**ผลรวม:** **PASS 28 / FAIL 0 / NOT VERIFIED 4**

---

## 1. Database Identity (ยืนยันก่อน Execute)

| รายการ | ค่า | ตรวจสอบ |
|--------|-----|----------|
| Container | `kindee_pg_test` | ✅ ตรงตามข้อกำหนด |
| Image | `postgres:15-bookworm` (ไม่ใช่ Supabase image) | ✅ |
| Host port mapping | `0.0.0.0:55432 → 5432/tcp` | ✅ local เท่านั้น |
| PostgreSQL version | 15.20 (Debian 15.20-1.pgdg12+1) | ✅ |
| Database | `kindee` | ✅ |
| Login role | `postgres` | ✅ |
| ข้อมูลก่อนเริ่ม | `store_memberships = 2`, `store_membership_audit_log = 0` | ✅ |
| Supabase Cloud | **ไม่ได้เชื่อมต่อ** (ไม่มี network call ใด ๆ ออกนอกเครื่อง) | ✅ |

**Identity ตรงทั้งหมด → ดำเนินการต่อได้**

---

## 2. การตรวจไฟล์ SQL และ Precondition Guard

| การตรวจ | ผล |
|---------|-----|
| ไฟล์มี `BEGIN` / `COMMIT` ครอบทั้งหมด | ✅ (บรรทัด 19 / 183) — single transaction |
| มี Precondition Guard (DO block) ก่อนแก้สิทธิ์ | ✅ ตรวจ 2 ตาราง + 10 ฟังก์ชัน + 5 policies |
| จำนวน REVOKE FUNCTION | 10 (ครบทุกฟังก์ชันของ 010) |
| จำนวน GRANT FUNCTION | 5 (เฉพาะ helper ที่ RLS ต้องใช้) |
| จำนวน REVOKE TABLE | 2 (`store_memberships`, `store_membership_audit_log`) |
| จำนวน DROP/CREATE POLICY | 5 คู่ (4 membership + 1 conversations) |
| ไม่มี `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` | ✅ |
| ไม่มี `ALTER TABLE ... FORCE ROW LEVEL SECURITY` | ✅ |
| ไม่มีการแก้ Migration 010 | ✅ |
| ไม่มี Part B (`ALTER DEFAULT PRIVILEGES`) | ✅ |

Precondition guard ผ่าน (`DO` สำเร็จ) → ไม่มีการหยุดกลางทาง

---

## 3. การสำรองข้อมูลก่อนเปลี่ยนแปลง

**ตำแหน่งไฟล์:** `C:\Users\LEGION\AppData\Local\Temp\kilo\kindee_013_backup\`

| ไฟล์ | ขนาด | SHA256 |
|------|------|--------|
| `kindee_before_013.dump` (custom format, full DB) | 46,129 B | `24664e114c0ff0940bd70278692ef74e3bc3de97192164f6f665bed5e9ad5ded` |
| `kindee_before_013_schema.sql` (schema-only) | 35,741 B | `cc912473ac306bfb167e5b842c563792d85a8308f2239b2e413dd86294799c90` |
| `kindee_before_013_data.sql` (2 ตาราง, data-only) | 1,624 B | `27c0cfe115f241d07f99d9d5f15b9ac9eefc0962d19a7342315c032f096d913d` |
| `before_013_funcs.tsv` (ACL snapshot) | 1,481 B | `5e655b8bd973f365d0c8fbba52db8bc99ab4b20e766286e81216e01d754da9bb` |
| `before_013_policies.tsv` (policy snapshot) | 1,166 B | `0a7fecdf1b92e425cc562b31f339ba2d80d54edc4ff7ec1d51021a768ca1a2c4` |
| `before_013_tables.tsv` (table ACL snapshot) | 198 B | `080ea15a974a14cb3b768c9c8ea16382257a8ef6baea4c427e60c61e4630903e` |

**Snapshot หลัง Execute (เก็บไว้เทียบ):**

| ไฟล์ | SHA256 |
|------|--------|
| `after_013_funcs.tsv` | `7953735df35f69ff8a4025034f61164fe3bc60414f4712cbc437945b23b7863b` |
| `after_013_policies.tsv` | `61818c15280d5d1bb52edff0dcd6ae22539fc3e0e4972e88779d59e653097009` |

สำรองเสร็จและตรวจ integrity ด้วย `pg_restore --list` (106 entries, มี `TABLE DATA public store_memberships` และ `store_membership_audit_log` ครบ) ก่อน Execute

---

## 4. ผลการ Execute

```
BEGIN
DO            <- precondition guard ผ่าน
REVOKE x10    <- ฟังก์ชันของ 010 (anon)
GRANT  x5     <- helper ที่ authenticated ต้องใช้
REVOKE x2     <- ตาราง (anon / authenticated บน audit log)
GRANT  x1     <- authenticated CRUD บน store_memberships
DROP POLICY / CREATE POLICY x5 คู่
COMMIT
EXITCODE = 0
```

ไม่มี error, ไม่มี warning, commit สำเร็จ

---

## 5. ผลตรวจหลัง Execute (Structural)

### 5.1 Function Privileges

| ฟังก์ชัน | anon | authenticated | service_role |
|----------|------|---------------|--------------|
| `is_store_owner` | **f** | t | t |
| `jsonb_bool` | **f** | t | t |
| `is_active_store_manager` | **f** | t | t |
| `is_active_store_member` | **f** | t | t |
| `validate_store_member_permissions` | **f** | t | t |
| `prevent_sole_owner_change` | **f** | **f** | t |
| `prevent_sole_owner_delete` | **f** | **f** | t |
| `store_memberships_guard_insert` | **f** | **f** | t |
| `store_memberships_guard_update` | **f** | **f** | t |
| `audit_store_membership_change` | **f** | **f** | t |

**สรุป:** `anon` = **0/10** (เป้าหมาย: 0), `authenticated` = 5 helper + 0 trigger functions (เป้าหมาย: 5/0), `service_role` คงเดิม 10/10 (trusted backend)

### 5.2 Table Privileges

| ตาราง | ACL หลัง Execute |
|--------|-------------------|
| `store_memberships` | `postgres=arwdDxt, authenticated=arwd, service_role=arwd` — **ไม่มี anon** |
| `store_membership_audit_log` | `postgres=arwdDxt, service_role=arwd` — **ไม่มี anon, ไม่มี authenticated** |

### 5.3 RLS Policies

| ตาราง | Policy | Roles | Command |
|-------|--------|-------|---------|
| `store_memberships` | `store_memberships_select` | **{authenticated}** | SELECT |
| `store_memberships` | `store_memberships_insert` | **{authenticated}** | INSERT |
| `store_memberships` | `store_memberships_update` | **{authenticated}** | UPDATE |
| `store_memberships` | `store_memberships_delete` | **{authenticated}** | DELETE |
| `conversations` | `conversations_store_members_select` | **{authenticated}** | SELECT |
| `conversations` | `test_conversations_read` | {public} | SELECT |

> `test_conversations_read` เป็น policy ของ test harness (`supabase/tests/010/00_base_schema.sql:118`) ที่มีอยู่ก่อนแล้ว — **ไม่ได้ถูกสร้างโดย 013** และไม่มีอยู่ใน production (ต้องตรวจใน Cloud Verification)
> `USING` / `WITH CHECK` ของทั้ง 5 policy **เหมือน 010 ทุกตัวอักษร** (เทียบ `before_013_policies.tsv` กับ `after_013_policies.tsv` แล้วต่างกันเฉพาะคอลัมน์ `roles`)

### 5.4 Triggers / RLS Flags / Data

| รายการ | ผล |
|--------|-----|
| Trigger ทั้ง 5 (`tgname`) | `tgenabled = O` ครบ (ยังทำงาน) |
| `relrowsecurity` ทั้ง 2 ตาราง | `true` (ไม่ถูกปิด) |
| `relforcerowsecurity` | `false` (คงเดิม — จำเป็นต่อ audit writer) |
| `store_memberships` row count | **2** (เท่าก่อน Execute) |
| `store_membership_audit_log` row count | **0** (เท่าก่อน Execute) |
| `pg_default_acl` | **ไม่เปลี่ยน** (`anon=X` / `anon=arwd` ยังอยู่ — Part B ไม่ได้ Execute) |

---

## 6. Regression Tests (Execute ซ้ำทั้งชุด)

รูปแบบ: ทุกเคสรันใน `BEGIN … ROLLBACK` ยกเว้น A4 ที่ต้อง commit fixture ชั่วคราวเพื่อทดสอบ concurrency จริง (และ cleanup แล้ว — ดูหัวข้อ 6.5)

### 6.1 ผลรวม

| ชุด | จำนวน | PASS | FAIL |
|-----|-------|------|------|
| A. Owner Protection | 5 | 5 | 0 |
| B. Manager Restrictions | 5 | 5 | 0 |
| C. RLS / IDOR | 5 | 5 | 0 |
| D. Audit Log | 7 | 7 | 0 |
| E. Privilege / Escalation (post-013) | 6 | 6 | 0 |
| **รวม** | **28** | **28** | **0** |

> เทียบกับรายงาน 010 เดิม (25 เคส): 25 เคสหลัก = A1–A5 (5) + B1–B5 (5) + C1–C5 (5) + D1–D7 (7) + E1–E3 (3) → **25/25 PASS**
> เคสเสริมที่รันเพิ่มในรอบนี้: E4, E5, E6 → PASS ทั้งหมด (รวมเป็น 28)

### 6.2 ชุด A — Owner Protection

| # | การทดสอบ | ผลจริง | สถานะ |
|---|-----------|---------|-------|
| A1 | Owner ลบ owner คนสุดท้าย | `P0001: Cannot delete the sole active owner of store 2a12be88…` | **PASS** |
| A2 | Owner ลดสิทธิ์ owner คนสุดท้าย | `P0001: Cannot demote, remove, or suspend the sole active owner…` | **PASS** |
| A3 | Owner ระงับ owner คนสุดท้าย | `P0001: Cannot demote, remove, or suspend…` | **PASS** |
| A4 | Concurrency: 2 owner ถูกลดสิทธิ์พร้อมกัน (2 session จริง) | S1 สำเร็จ / S2 `P0001: Cannot demote…sole active owner` → active owner เหลือ 1 | **PASS** |
| A5 | Invariant: ทุกร้านมี active owner = 1 | `active_owner_mismatch=0` | **PASS** |

**A4 รายละเอียด:** seed owner คนที่ 2 (`f094b189…`) แบบ commit ชั่วคราว → Session 1 ลดสิทธิ์ `dd5caa6b…` แล้วถือ advisory lock + `pg_sleep(4)` ก่อน commit → Session 2 ลดสิทธิ์ `f094b189…` พร้อมกัน ถูกบล็อกที่ lock แล้ว re-check เห็นว่าเหลือ 0 owner → ถูกปฏิเสธด้วย P0001 → หลังจบมี active owner 1 คน (invariant ยังคง) — ตรงตามดีไซน์ของ 010 และ **ไม่ได้รับผลกระทบจาก 013**

### 6.3 ชุด B — Manager Restrictions

| # | การทดสอบ | ผลจริง | สถานะ |
|---|-----------|---------|-------|
| B1 | Manager แก้ owner row | `P0001: Cannot demote…sole active owner` (sole-owner trigger ทำงานก่อน guard) | **PASS** |
| B2 | Manager เพิ่มตัวเอง | `P0001: Managers cannot add themselves as members` | **PASS** |
| B3 | Manager ให้ `member_write` | `P0001: Managers cannot grant member_write` | **PASS** |
| B4 | Manager เปลี่ยน role ของ staff | `P0001: Only the store owner may change a member role` | **PASS** |
| B5 | Trusted context (ไม่มี JWT) insert | สำเร็จ (`trusted insert succeeded`) | **PASS** |

### 6.4 ชุด C — RLS / IDOR

| # | การทดสอบ | ผลจริง | สถานะ |
|---|-----------|---------|-------|
| C1 | Owner เห็นเฉพาะร้านตัวเอง | `rows_storeA=3, rows_storeB=0` | **PASS** |
| C2 | IDOR: owner A UPDATE/DELETE แถวร้าน B | แถวร้าน B ยังอยู่ครบ (`storeB_owner_rows_after=1`) | **PASS** |
| C3 | Staff เห็นเฉพาะแถวตัวเอง | `staff_visible=1`, ไม่เห็นแถวอื่น | **PASS** |
| C4 | Outsider เห็น 0 แถว | `outsider_visible=0` | **PASS** |
| C5 | Staff insert ตัวเอง | `P0001: Not authorized to insert store membership` | **PASS** |

> **หมายเหตุความโปร่งใส:** การรันรอบแรกของ C2 ขึ้น `FAIL` เนื่องจาก **assertion ของสคริปต์ผิด** (นับแถวร้าน B ด้วยสิทธิ์ owner A ซึ่ง RLS กรองอยู่แล้ว) ไม่ใช่ฐานข้อมูลผิด → แก้ assertion เป็น `RESET ROLE` แล้วนับด้วยสิทธิ์ postgres ผลคือ **PASS** (`storeB_owner_rows_after=1`)

### 6.5 ชุด D — Audit Log

| # | การทดสอบ | ผลจริง | สถานะ |
|---|-----------|---------|-------|
| D1 | authenticated INSERT audit log | `42501: permission denied for table store_membership_audit_log` | **PASS** |
| D2 | authenticated UPDATE audit log | `42501` | **PASS** |
| D3 | authenticated DELETE audit log | `42501` | **PASS** |
| D4 | Trigger เขียน audit อัตโนมัติ | `audit_insert_rows=1` | **PASS** |
| D5 | Actor attribution `end_user` | `actor_id = dd5caa6b…`, `actor_kind = end_user` | **PASS** |
| D6 | Actor attribution `service_role` | `actor_kind = service_role`, `actor_jwt_role = service_role` | **PASS** |
| D7 | Actor attribution `sql_editor` | `actor_kind = sql_editor`, `actor_db_role = postgres` | **PASS** |

### 6.6 ชุด E — Privilege / Escalation (ความคาดหวังใหม่หลัง 013)

| # | การทดสอบ | ผลจริง | สถานะ |
|---|-----------|---------|-------|
| E1 | authenticated เรียก helper ที่ RLS ต้องใช้ | `is_store_owner` t/f ถูกต้อง, `jsonb_bool` t, `validate…` t | **PASS** |
| E2 | authenticated เรียก trigger function ตรง | `42501: permission denied for function prevent_sole_owner_change` | **PASS** |
| E3 | anon เรียก `is_store_owner` | `42501: permission denied for function is_store_owner` | **PASS** (พฤติกรรมเปลี่ยนตามการ hardening) |
| E4 | anon SELECT `store_memberships` | `42501: permission denied for table store_memberships` | **PASS** (เดิม 0 แถว → ตอนนี้ปฏิเสธที่ privilege) |
| E5 | authenticated SELECT audit log | `42501` | **PASS** |
| E6 | SECURITY DEFINER ที่ไม่ pin `search_path` | `unpinned=0` | **PASS** |

**การเปลี่ยนแปลงพฤติกรรมที่ต้องรับทราบ (intentional):**

| ก่อน 013 | หลัง 013 |
|-----------|-----------|
| `anon` SELECT `store_memberships` → `200` + `[]` | `401/403` (permission denied) |
| `anon` เรียก `is_store_owner` → ได้ boolean | `401/403` (permission denied) |
| `authenticated` เรียก trigger function → error "trigger functions can only be called as triggers" | `42501 permission denied` |

ทั้งสามกรณีเป็นไปตามเป้าหมายของ 013 และตรวจแล้วว่าไม่มี Frontend/Backend ใช้งานเส้นทางเหล่านี้

### 6.7 การ Cleanup หลัง A4

| การตรวจ | ผล |
|---------|-----|
| คืนสิทธิ์ owner ให้ `dd5caa6b…` | `UPDATE 1` |
| ลบ membership ชั่วคราวของ `f094b189…` | `DELETE 1` |
| ลบ audit rows ที่เกิดจาก test | `DELETE 4` |
| สถานะสุดท้าย | `memberships=2`, `audit=0`, owner ร้าน A/B ตรงกับก่อน Execute |

---

## 7. Owner / Manager / Staff Permissions (ยืนยันเชิงพฤติกรรม)

| บทบาท | การกระทำที่ทดสอบ | ผล |
|-------|-------------------|-----|
| **Owner** | อ่านทุกแถวในร้าน (C1), แก้/ลบข้ามร้านไม่ได้ (C2), ถูก block เมื่อลดสิทธิ์ owner คนสุดท้าย (A2/A3), เพิ่มสมาชิกแบบ trusted (B5), เขียน audit attribution (D5) | ✅ ทำงานครบ |
| **Manager** | เห็นสมาชิกในร้าน (C1 โดย owner; manager ใช้ policy เดียวกัน), เพิ่มตัวเองไม่ได้ (B2), ให้ member_write ไม่ได้ (B3), เปลี่ยน role ไม่ได้ (B4), แก้ owner ไม่ได้ (B1) | ✅ ข้อจำกัดครบ |
| **Staff** | เห็นเฉพาะแถวตัวเอง (C3), insert ตัวเองไม่ได้ (C5), อ่าน conversations ผ่าน `is_active_store_member` (E1 ยืนยันฟังก์ชันใช้งานได้) | ✅ |
| **Outsider/anon** | เห็น 0 แถว / ถูกปฏิเสธที่ privilege (C4, E3, E4) | ✅ |

---

## 8. PASS / FAIL / NOT VERIFIED

### PASS (28)

- Execute สำเร็จใน transaction เดียว, exit code 0
- `anon` EXECUTE = 0/10, `anon` table grants = 0
- `authenticated` EXECUTE = 5 helper (คงไว้) / 0 trigger function (ถอนแล้ว)
- RLS policies = `{authenticated}` 5/5, expressions ไม่เปลี่ยน
- Trigger 5/5 ยัง enabled, RLS ยังเปิด, ไม่มี FORCE RLS
- Regression 28/28 PASS
- Audit log ยังถูกเขียนโดย trigger + actor attribution ถูกต้อง 3 แบบ
- Sole-owner protection ยังทำงานรวมถึง concurrency
- SECURITY DEFINER 6/6 pin `search_path`
- ข้อมูลไม่ถูกแก้ไข (2 แถว / audit 0)

### FAIL (0)

ไม่มี

### NOT VERIFIED (4)

| # | รายการ | เหตุผล | วิธีตรวจต่อ |
|---|--------|--------|-------------|
| N1 | พฤติกรรมบน Supabase Cloud / PostgREST HTTP status | ข้อกำหนดห้ามเชื่อมต่อ Cloud | ตรวจบน staging ด้วย anon key: คาด `401/403` แทน `200 []` |
| N2 | `authenticator` role ไม่มี direct grant | role นี้ไม่มีใน DB ทดสอบ | `SELECT ... has_function_privilege('authenticator', ...)` บน Cloud → ต้องเป็น `f` |
| N3 | policy `test_conversations_read` บน production | เป็น artifact ของ test harness (local เท่านั้น) | `SELECT ... WHERE policyname LIKE 'test\_%'` → ต้องได้ 0 แถว |
| N4 | Part B (`ALTER DEFAULT PRIVILEGES`) | ห้าม Execute ตามข้อกำหนด | ตัดสินใจแยก (ดู `KINDEE_MIGRATION_013_REVIEW_REPORT.md` หัวข้อ 8) |

---

## 9. Rollback Plan

> 013 **ไม่แก้ schema และไม่แก้ข้อมูล** → rollback เป็นการคืนสิทธิ์/policy เท่านั้น ไม่ต้อง restore data

### Level 1 — SQL rollback (เร็วที่สุด, แนะนำ)

```sql
BEGIN;

-- คืน EXECUTE ให้ anon (เฉพาะที่ต้องการจริง — ไม่แนะนำให้คืนทั้งหมด)
GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid, uuid)               TO anon;
GRANT EXECUTE ON FUNCTION public.is_active_store_manager(uuid, uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.is_active_store_member(uuid, uuid)       TO anon;
GRANT EXECUTE ON FUNCTION public.jsonb_bool(jsonb, text)                  TO anon;
GRANT EXECUTE ON FUNCTION public.validate_store_member_permissions(jsonb) TO anon;

-- คืน table privileges ให้ anon
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_memberships TO anon;

-- คืน trigger function EXECUTE ให้ authenticated (ไม่จำเป็นต่อการทำงานของ trigger)
GRANT EXECUTE ON FUNCTION public.prevent_sole_owner_change()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_sole_owner_delete()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_memberships_guard_insert()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_memberships_guard_update()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_store_membership_change()      TO authenticated;

-- คืน policy เป็นแบบ 010 (ไม่มี TO => PUBLIC)
DROP POLICY IF EXISTS store_memberships_select ON public.store_memberships;
CREATE POLICY store_memberships_select ON public.store_memberships
    FOR SELECT USING (
        profile_id = auth.uid()
        OR public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), FALSE)
    );

DROP POLICY IF EXISTS store_memberships_insert ON public.store_memberships;
CREATE POLICY store_memberships_insert ON public.store_memberships
    FOR INSERT WITH CHECK (
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
    FOR UPDATE
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
    FOR DELETE USING (
        public.is_store_owner(store_id, auth.uid())
    );

DROP POLICY IF EXISTS conversations_store_members_select ON public.conversations;
CREATE POLICY conversations_store_members_select ON public.conversations
    FOR SELECT USING (
        public.is_store_owner(conversations.store_id, auth.uid())
        OR public.is_active_store_member(conversations.store_id, auth.uid())
    );

COMMIT;
```

**ตรวจหลัง rollback:**
```sql
SELECT p.proname, has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('is_store_owner','jsonb_bool','is_active_store_manager','is_active_store_member',
  'validate_store_member_permissions','prevent_sole_owner_change','prevent_sole_owner_delete',
  'store_memberships_guard_insert','store_memberships_guard_update','audit_store_membership_change')
ORDER BY 1;

SELECT tablename, policyname, roles::text FROM pg_policies
WHERE schemaname='public' AND tablename IN ('store_memberships','conversations') ORDER BY 1,2;
```

### Level 2 — Selective restore จาก dump

```powershell
# ใน container
pg_restore -U postgres -d kindee --data-only --table=public.store_memberships \
           --table=public.store_membership_audit_log /tmp/kindee_before_013.dump
```
(ใช้เฉพาะกรณีข้อมูลเสียหาย — 013 ไม่แตะข้อมูล จึงไม่จำเป็น)

### Level 3 — Full restore (กรณีฉุกเฉิน)

```powershell
docker exec -i kindee_pg_test dropdb -U postgres --if-exists kindee_restore_013
docker exec -i kindee_pg_test createdb -U postgres kindee_restore_013
docker exec -i kindee_pg_test pg_restore -U postgres -d kindee_restore_013 /tmp/kindee_before_013.dump
```
แล้วสลับชื่อ database ภายใต้Downtime window (ไม่แนะนำให้ทำบน production โดยตรง)

### Rollback Triggers (เงื่อนไขที่ต้อง rollback ทันที)

1. Owner/Manager/Staff ถูกปฏิเสธ `permission denied for function` บน helper 5 ตัว
2. มี query จาก client ที่ได้ `401/403` ในเส้นทางที่ธุรกิจต้องใช้ (เช่น หน้า store management)
3. Audit log ไม่ถูกเขียน หรือ actor attribution ผิด
4. ตรวจพบว่ามี policy หายไปจากตาราง

---

## 10. เงื่อนไขก่อนนำขึ้น Cloud (Gate)

| # | Gate | สถานะ |
|---|------|-------|
| G1 | Local Execute PASS ครบ (28/28) | ✅ |
| G2 | Backup + hashes พร้อม | ✅ |
| G3 | Rollback SQL พร้อมใช้ | ✅ |
| G4 | Smoke test 3 บทบาทบน staging ผ่าน | ⬜ ต้องทำบน staging |
| G5 | ตรวจ N1–N3 บน Cloud | ⬜ |
| G6 | ตัดสินใจ Part B | ⬜ (แยกอนุมัติ) |

**ยังห้ามนำขึ้น Cloud** จนกว่า G4–G6 จะเสร็จ

---

## 11. การปฏิบัติตามข้อกำหนด

- [x] ตรวจไฟล์ SQL และ Precondition Guard ก่อน Execute
- [x] เชื่อมต่อเฉพาะ Local Docker `kindee_pg_test` (port 55432)
- [x] ตรวจ Database Identity ก่อน Execute (container / image / db / role / version / row counts)
- [x] สำรองข้อมูลและ Schema + ACL/policy snapshot พร้อม SHA256
- [x] Execute Part A ทั้งหมดใน Transaction เดียว (`BEGIN … COMMIT`, exit 0)
- [x] **ไม่ Execute Part B**
- [x] ไม่เชื่อมต่อ Supabase Cloud
- [x] ไม่แก้ Migration 010
- [x] ไม่เปิดเผย Secrets
- [x] รัน Regression ครบ 25 เคสหลัก (+3 เสริม) — PASS ทั้งหมด
- [x] Cleanup fixture ของ concurrency test และยืนยันข้อมูลกลับสู่สภาพเดิม

---

**สรุป:** Migration 013 Part A Execute สำเร็จบน Local PostgreSQL — สิทธิ์ส่วนเกินถูกถอนครบ, ระบบ Owner/Manager/Staff, RLS, Audit และ Sole-owner Protection ยังทำงานสมบูรณ์ (28/28 PASS) ข้อมูลไม่ถูกแก้ไข และมี Rollback Plan 3 ระดับพร้อมใช้ — **ยังไม่ควรขึ้น Cloud จนกว่าจะทำ staging smoke test และตรวจ N1–N3**
