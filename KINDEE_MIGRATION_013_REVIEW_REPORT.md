# KINDEE_MIGRATION_013_REVIEW_REPORT.md

**วันที่สร้าง:** 2026-11-18T16:15:00Z
**โครงการ:** kindee-marketplace
**ขอบเขต:** Review Migration 013 (Privilege Hardening) — ตรวจแบบ Read-only บน Local Docker PostgreSQL
**ฐานข้อมูล:** container `kindee_pg_test` (PostgreSQL 15.20) → database `kindee`
**รายงานอ้างอิง:** `KINDEE_MIGRATION_010_FINAL_HARDENING_REPORT.md`

---

## 0. Checkpoint ความต่อเนื่อง (ทำงานต่อจากจุดที่หยุด)

| ขั้นตอน | สถานะ |
|---------|-------|
| อ่านรายงาน 010 FINAL HARDENING | ✅ เสร็จ (ก่อน interruption) |
| ค้นหาไฟล์ `013_harden_migration_010_privileges.sql` | ✅ เสร็จ — **ไม่พบไฟล์ในโปรเจกต์** |
| ตรวจ baseline สิทธิ์บน DB (ACL, default ACL, policies, functions) | ✅ เสร็จ |
| ตรวจ dependency ของ RLS policies ต่อ helper functions | ✅ เสร็จ |
| ตรวจ Frontend / Backend impact | ✅ เสร็จ |
| ตรวจ trigger / sole-owner / audit preservation | ✅ เสร็จ |
| จัดทำรายงาน + SQL พร้อมอนุมัติ | ✅ เสร็จในรอบนี้ |

**ข้อค้นพบสำคัญเรื่องเป้าหมายการตรวจ:** ไม่มีไฟล์ `supabase/migrations/013_harden_migration_010_privileges.sql` อยู่ในโปรเจกต์ (ตรวจด้วย glob ทั้ง repo และ listing `supabase/migrations/` พบเพียง `001`–`012`) เนื้อหา SQL ที่ต้องตรวจจึงมาจาก **ข้อเสนอในหัวข้อ 10 ของ `KINDEE_MIGRATION_010_FINAL_HARDENING_REPORT.md`** และรอบนี้ได้จัดทำเป็นไฟล์ SQL ฉบับพร้อมอนุมัติที่ `supabase/migrations/013_harden_migration_010_privileges.sql` (ยังไม่ Execute)

---

## 1. สรุปผู้บริหาร

| มิติ | ผล |
|------|-----|
| ความถูกต้องของ SQL ที่เสนอ (Part A) | **PASS — อนุมัติได้หลังเพิ่ม Precondition Guard** |
| ผลข้างเคียงต่อ Owner / Manager / Staff | **ไม่มี (PASS)** |
| ผลข้างเคียงต่อ RLS / Audit / Sole-owner Protection | **ไม่มี (PASS)** |
| ผลกระทบ Frontend | **ไม่มี (PASS)** |
| ผลกระทบ Backend | **ไม่มี (PASS)** — ใช้ `service_role` |
| ความเสี่ยงรวมของ Part A | **LOW** |
| ส่วน Default Privileges (Part B) | **HOLD — ต้องอนุมัติแยก** |
| สถานะ Cloud Verification | **GO (หลัง apply Part A บน staging)** |

**คำตัดสิน:** ข้อเสนอ Part A ถูกต้องและปลอดภัยในเชิงตรรกะ แต่ **ยังไม่สมบูรณ์ในเชิงปฏิบัติการ** ขาด 2 อย่าง: (1) precondition guard กัน migration ล้มกลางทาง (2) การจัดการ `pg_default_acl` ตามเป้าหมายข้อ 1 ซึ่งต้องแยกการอนุมัติเพราะกระทบอนาคต ไม่กระทบของเดิม

---

## 2. Baseline หลักฐานจากฐานข้อมูล (ตรวจซ้ำได้)

```
store_memberships            : postgres=arwdDxt, anon=arwd, authenticated=arwd, service_role=arwd
store_membership_audit_log   : postgres=arwdDxt, service_role=arwd
                               (anon, authenticated: ไม่มีสิทธิ์ใด ๆ)

pg_default_acl (schema public):
  TABLES    : anon=arwd, authenticated=arwd, service_role=arwd
  FUNCTIONS : anon=X,    authenticated=X,    service_role=X

ฟังก์ชันของ 010 ที่ anon มี EXECUTE : 10 / 10
RLS ของ 2 ตาราง                    : ENABLED, FORCE = OFF (ถูกต้องสำหรับ SECURITY DEFINER writer)
เจ้าของตาราง                       : postgres (ทั้งสองตาราง)
Realtime publication               : ไม่มี (0 publications) → ไม่กระทบ Realtime
Views / Materialized views         : ไม่มีใน schema public
Policy ที่อ้าง helper functions    : 5 รายการ (ทั้งหมดมาจาก 010)
```

**การแก้ไขข้อมูลในรายงาน 010 (F4):** ตัวเลข "56/56 ฟังก์ชันที่ anon execute ได้" แยกได้เป็น **10 ฟังก์ชันแอป (จาก 010)** + **46 ฟังก์ชันของ extension** (`pgcrypto`, `uuid-ossp` ที่ติดตั้งใน schema `public`) → ไม่มีฟังก์ชันแอปอื่นที่ `anon` เรียกได้เลย นี่คือบริบทสำคัญที่ทำให้ Part B ประเมินความเสี่ยงได้แม่นขึ้น

---

## 3. ผลตรวจตามเป้าหมาย 8 ข้อ

### 3.1 `pg_default_acl` ของ `anon` (เป้าหมาย 1)

| การตรวจ | ผล |
|---------|-----|
| default ACL ของ FUNCTIONS ใน `public` | `anon=X` → ฟังก์ชันใหม่ทุกตัวที่ `postgres` สร้างจะได้ EXECUTE ให้ `anon` โดยอัตโนมัติ |
| default ACL ของ TABLES ใน `public` | `anon=arwd` → ตารางใหม่ทุกตารางจะได้ CRUD ให้ `anon` |
| สาเหตุที่ 010 แก้ไม่ได้ | `REVOKE ... FROM PUBLIC` ไม่แตะ grant ตรงของ role (ACL ไม่มี entry ของ PUBLIC) |
| SQL เสนอเดิม (Part A) แก้ข้อนี้หรือไม่ | **ไม่แก้** — Part A แก้เฉพาะ object ที่มีอยู่แล้ว |
| ผลต่อ object ในอนาคต | ยังคงได้ `anon` grant อัตโนมัติ (regression risk) |

**สรุป:** เป้าหมายข้อ 1 ยัง **ไม่ถูกปิด** ด้วย SQL ที่เสนอ → ต้องมี Part B (แยกอนุมัติ) ดูหัวข้อ 8

### 3.2 จำกัด `anon` บน `store_memberships` (เป้าหมาย 2)

```sql
REVOKE ALL ON TABLE public.store_memberships FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_memberships TO authenticated;
```

| ประเด็น | ผล |
|---------|-----|
| ครอบคลุมทุกสิทธิ์ที่ anon มี (arwd) | ✅ ครบ |
| ไม่กระทบ `authenticated` | ✅ (`GRANT` ซ้ำเป็น idempotent safeguard) |
| ไม่กระทบ `service_role` | ✅ |
| ไม่กระทบ FK / trigger / audit | ✅ (FK ทำงานด้วยสิทธิ์เจ้าของตาราง) |
| ผลข้างเคียงที่ต้องยอมรับ | anon REST call ที่ `store_memberships` เปลี่ยนจาก `200 []` เป็น `401/403` |

### 3.3 ถอน EXECUTE จาก `anon` ครบ 10 ฟังก์ชัน (เป้าหมาย 3)

SQL ระบุครบ **10/10** signature ตรงกับ DB จริง (ตรวจ `to_regprocedure` เทียบแล้ว):

```text
is_store_owner(uuid,uuid)                      is_active_store_manager(uuid,uuid,boolean)
jsonb_bool(jsonb,text)                         is_active_store_member(uuid,uuid)
validate_store_member_permissions(jsonb)       prevent_sole_owner_change()
prevent_sole_owner_delete()                     store_memberships_guard_insert()
store_memberships_guard_update()                audit_store_membership_change()
```

ผลลัพธ์ที่ต้องการหลัง apply: `anon` = 0/10 (คงเหลือ `authenticated` 5 ตัวที่จำเป็น + `service_role` 10 ตัว)

### 3.4 ถอน EXECUTE ส่วนเกินจาก `authenticated` (เป้าหมาย 4)

| ฟังก์ชัน | จำเป็นสำหรับ authenticated | SQL ถอน |
|----------|---------------------------|---------|
| `is_store_owner` | ใช่ (policy) | ไม่ถอน ✅ |
| `is_active_store_manager` | ใช่ (policy) | ไม่ถอน ✅ |
| `is_active_store_member` | ใช่ (policy) | ไม่ถอน ✅ |
| `jsonb_bool` | ใช่ (`WITH CHECK`) | ไม่ถอน ✅ |
| `validate_store_member_permissions` | ใช่ (`WITH CHECK`) | ไม่ถอน ✅ |
| `prevent_sole_owner_change/delete` | ไม่ (trigger-only) | ถอน ✅ |
| `store_memberships_guard_insert/update` | ไม่ (trigger-only) | ถอน ✅ |
| `audit_store_membership_change` | ไม่ (trigger-only) | ถอน ✅ |

**หลักฐานว่าไม่ทำให้ trigger 停止:** PostgreSQL 15 documentation (`CREATE TRIGGER`, Notes) ระบุชัดว่า — *"To create or replace a trigger on a table, the user must have the TRIGGER privilege on the table. The user must also have EXECUTE privilege on the trigger function."* → **ตรวจ EXECUTE เฉพาะตอนสร้าง trigger** ไม่ตรวจตอน trigger ทำงาน

**ยืนยันจาก DB:** trigger ทั้ง 5 ตัวมีสถานะ `tgenabled = 'O'` (enabled ปกติ) และไม่ได้ถูกแก้โดย 013

### 3.5 รักษาสิทธิ์ของ Owner / Manager / Staff (เป้าหมาย 5)

| บทบาท | สิ่งที่ต้องใช้ | สิทธิ์หลัง 013 | ผล |
|-------|----------------|-----------------|-----|
| Owner | table CRUD (authenticated) + `is_store_owner` + `validate...` + `jsonb_bool` | คงอยู่ครบ | ✅ |
| Manager | table CRUD + `is_active_store_manager(TRUE)` + `validate...` + `jsonb_bool` | คงอยู่ครบ | ✅ |
| Staff | table SELECT (เฉพาะแถวตัวเอง) + `is_active_store_member` (อ่าน conversations) | คงอยู่ครบ | ✅ |
| anon | ไม่ต้องใช้ | ถูกถอน | ✅ |

**ตรวจ policy dependency ทั้งระบบ (สำคัญ):** policy ที่เรียก helper มีเพียง 5 รายการ และ **ทั้งหมดเป็น policy ของ 010** → ไม่มี policy ของตารางอื่นที่จะพังเมื่อ `anon` ไม่มี EXECUTE

### 3.6 SECURITY DEFINER และ `search_path` (เป้าหมาย 6)

| การตรวจ | ผล |
|---------|-----|
| 013 แก้ body / `search_path` ของฟังก์ชัน | **ไม่แก้** (มีแต่ REVOKE/GRANT) |
| SECURITY DEFINER ทั้งหมด | 6 ตัว (ทั้งหมดจาก 010) |
| ตัวที่ไม่มี `search_path` pin | **0** |
| ค่า `proconfig` | `search_path=public, pg_catalog` ทุกตัว |
| `anon`/`authenticated` มี CREATE บน `public` | ไม่มี → ไม่มี function-shadowing risk |
| 013 เพิ่มความเสี่ยงใหม่หรือไม่ | ไม่ (ไม่แตะ DDL ของฟังก์ชัน) |

### 3.7 ผลกระทบ Frontend / Backend (เป้าหมาย 7)

**Frontend**

```text
grep "supabase" ใน frontend/src  → 0 match
grep ".rpc(" , "createClient"     → 0 match
```

Frontend เรียกผ่าน Backend REST API เท่านั้น → ไม่มีการใช้ anon key กับ `store_memberships` หรือ helper functions → **ไม่กระทบ**

**Backend**

| จุดที่แตะ `store_memberships` | client ที่ใช้ | ผล |
|-------------------------------|---------------|-----|
| `backend/services/socketService.js:110-118` (`joinStore` access check) | `supabaseAdmin` (service_role) | ไม่กระทบ |
| `backend/config/supabase.js` (`supabase` = anon key) | ใช้กับ endpoint สาธารณะอื่น | ไม่มี endpoint ไหน query `store_memberships` ด้วย anon |
| `createUserClient(token)` | role `authenticated` | สิทธิ์ที่จำเป็นคงอยู่ |

**Realtime:** ไม่มี publication → ไม่มีผล
**PostgREST embedding:** ถ้าเคยมี `stores?select=*,store_memberships(*)` ด้วย anon จะได้ 401 หลัง apply — ตรวจแล้วไม่มีในโค้ด

### 3.8 ไม่ทำลาย RLS / Audit / Sole-owner Protection (เป้าหมาย 8)

| กลไก | ผลกระทบจาก 013 | หลักฐาน |
|------|------------------|---------|
| RLS (enabled) | ไม่ปิด ไม่แตะ `ENABLE` | 013 ไม่มี `ALTER TABLE ... ROW LEVEL SECURITY` |
| Policy expressions | **คงเดิมทุกตัวอักษร** เปลี่ยนเฉพาะ `TO authenticated` | ตาราง diff ในหัวข้อ 6 |
| Audit log table | ไม่แตะ grant (anon/authenticated ยัง无权) | ACL ก่อน/หลังไม่เปลี่ยน |
| Audit trigger | ยังทำงาน (ไม่ต้อง EXECUTE ตอน runtime) | PostgreSQL docs + `tgenabled='O'` |
| Sole-owner protection | ยังทำงาน (trigger ที่ห้าม demote/suspend/delete owner คนสุดท้าย) | trigger enabled + ไม่มีการแตะ function body |
| FORCE RLS | **ไม่เพิ่ม** — ถ้าเพิ่มจะทำให้ SECURITY DEFINER writer (owner=postgres) write audit log ไม่ได้ | เหตุผลในหัวข้อ 9 |

---

## 4. Risk Register

| ID | ความเสี่ยง | โอกาส | ผลกระทบ | ระดับ | การจัดการ |
|----|-----------|-------|---------|-------|-----------|
| **R1** | ถ้ารัน H1 (revoke function) โดยไม่รัน H3 (policy → `authenticated`) พร้อมกัน: query ของ `anon` บน `conversations`/`store_memberships` จะ error `42501 permission denied for function` แทนการคืน 0 แถว | กลาง | กลาง (error หลุดถึง client สาธารณะ) | **P2** | รวม H1+H3 ในไฟล์/transaction เดียว (ทำแล้ว) + ห้ามแยก deploy |
| **R2** | 013 ไม่มี precondition guard → ถ้า 010 ยังไม่ถูกใช้ หรือ signature เพี้ยน REVOKE จะ abort กลางไฟล์ | กลาง | ต่ำ (DDL transactional → rollback ทั้งหมด) | **P3** | เพิ่ม `DO $$ ... RAISE EXCEPTION` ตรวจ 10 ฟังก์ชัน + 2 ตาราง + 5 policy |
| **R3** | `DROP POLICY` + `CREATE POLICY` ถ้าพิมพ์ expression คลาดเคลื่อน จะเปลี่ยน semantics ของ RLS | ต่ำ | สูง | **P2** | คัดลอก expression จาก 010 แบบตรงตัว (ตรวจ diff ในหัวข้อ 6) + post-apply diff query |
| **R4** | ยังไม่แก้ `pg_default_acl` → migration ในอนาคตได้ `anon` grant ซ้ำ (regression) | สูง | กลาง | **P2** | Part B (อนุมัติแยก) + CI guard query |
| **R5** | `anon` เปลี่ยนพฤติกรรมจาก `200 []` → `401/403` (intentional) | แน่นอน | ต่ำ | **P3** | ยืนยันแล้วว่าไม่มี client ใช้ (Frontend ไม่มี Supabase client) |
| **R6** | `authenticator` role ไม่มีใน DB ทดสอบ → ตรวจ local ไม่ได้ | ต่ำ | ต่ำ | **P3** | ตรวจบน Cloud: `authenticator` ต้องไม่มี direct grant (SET ROLE เท่านั้น) |
| **R7** | 46 ฟังก์ชัน extension (`pgcrypto`, `uuid-ossp`) ใน schema `public` ยัง anon-executable | แน่นอน | ต่ำ (ไม่ใช่ logic แอป) | **P3** | งานแยก: ย้าย extension ไป schema `extensions` (ไม่อยู่ในขอบเขต 013) |
| **R8** | ถ้ามีคนเพิ่ม `FORCE ROW LEVEL SECURITY` ในอนาคต audit writer จะเขียนไม่ได้ | ต่ำ | สูง | **P3** | บันทึกห้ามไว้ในคอมเมนต์ migration |

**ไม่มี R1 ระดับ P1** — ไม่มีความเสี่ยงที่ทำให้ Owner/Manager/Staff ใช้งานไม่ได้ และไม่มีการเปิดช่อง escalation ใหม่

---

## 5. สิ่งที่ต้องแก้ก่อนอนุมัติ (Diff จากข้อเสนอเดิม)

| # | ข้อเสนอเดิม | ปรับเป็น | เหตุผล |
|---|-------------|----------|--------|
| 1 | ไม่มี guard | เพิ่ม `DO` block ตรวจ object ที่ต้องมีก่อน | กัน migration ล้มกลางทางด้วย error ที่อ่านไม่รู้เรื่อง (R2) |
| 2 | ไม่มี revoke บน audit log | เพิ่ม `REVOKE ALL ON TABLE store_membership_audit_log FROM anon, authenticated;` | idempotent defense (ไม่เปลี่ยนสถานะจริงเพราะ无权อยู่แล้ว) |
| 3 | ไม่มีคอมเมนต์เตือน | เพิ่มคอมเมนต์ "ห้ามแยก H1/H3", "ห้าม FORCE RLS", "ห้ามถอน 5 helper จาก authenticated" | กัน regression จากคนแก้ไฟล์ในอนาคต |
| 4 | ไม่มี post-apply verification | เพิ่ม verification queries ในรายงาน (หัวข้อ 7) | ตรวจผลหลัง apply ได้ทันที |
| 5 | ไม่แตะ default ACL | แยกเป็น Part B พร้อม risk/decision record | ปิดเป้าหมายข้อ 1 โดยไม่ผูกความเสี่ยงเข้ากับ Part A |

---

## 6. หลักฐานว่า RLS Semantics ไม่เปลี่ยน (Policy Diff)

| Policy | 010 (เดิม) | 013 (ใหม่) | USING / WITH CHECK |
|--------|------------|------------|--------------------|
| `store_memberships_select` | roles `{public}` | `TO authenticated` | เหมือนเดิมทุกตัวอักษร |
| `store_memberships_insert` | roles `{public}` | `TO authenticated` | เหมือนเดิมทุกตัวอักษร |
| `store_memberships_update` | roles `{public}` | `TO authenticated` | เหมือนเดิมทุกตัวอักษร |
| `store_memberships_delete` | roles `{public}` | `TO authenticated` | เหมือนเดิมทุกตัวอักษร |
| `conversations_store_members_select` | roles `{public}` | `TO authenticated` | เหมือนเดิมทุกตัวอักษร |

**ผลลัพธ์:** เฉพาะ "ใครถูกประเมิน policy" เปลี่ยน จากทุก role → `authenticated` เท่านั้น — `service_role` ยัง bypass RLS ตามเดิม, `anon` ได้ default-deny (0 แถว ไม่ error)

---

## 7. SQL ฉบับพร้อมอนุมัติ (Part A — APPROVED-READY, NOT EXECUTED)

> ไฟล์จริง: `supabase/migrations/013_harden_migration_010_privileges.sql`
> สถานะ: **รออนุมัติ — ยังไม่ Execute** (ตามข้อกำหนด)

```sql
-- 013_harden_migration_010_privileges.sql
-- Least-privilege hardening for objects created by migration 010.
-- REVIEW: KINDEE_MIGRATION_013_REVIEW_REPORT.md
--
-- DO NOT split the function revokes from the policy role changes: revoking first
-- alone makes anon queries hit "permission denied for function" instead of an
-- empty result. Both live in one transaction here on purpose.
--
-- DO NOT enable FORCE ROW LEVEL SECURITY on store_membership_audit_log: the
-- SECURITY DEFINER audit writer relies on table-owner (postgres) RLS bypass.
--
-- DO NOT revoke EXECUTE on is_store_owner / is_active_store_manager /
-- is_active_store_member / jsonb_bool / validate_store_member_permissions from
-- authenticated: RLS policies call them with the caller's privileges.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preconditions: fail fast with a clear message before touching anything.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF to_regclass('public.store_memberships') IS NULL THEN
        v_missing := v_missing || 'table public.store_memberships'::text;
    END IF;
    IF to_regclass('public.store_membership_audit_log') IS NULL THEN
        v_missing := v_missing || 'table public.store_membership_audit_log'::text;
    END IF;

    IF to_regprocedure('public.is_store_owner(uuid,uuid)') IS NULL THEN
        v_missing := v_missing || 'public.is_store_owner(uuid,uuid)'::text;
    END IF;
    IF to_regprocedure('public.jsonb_bool(jsonb,text)') IS NULL THEN
        v_missing := v_missing || 'public.jsonb_bool(jsonb,text)'::text;
    END IF;
    IF to_regprocedure('public.is_active_store_manager(uuid,uuid,boolean)') IS NULL THEN
        v_missing := v_missing || 'public.is_active_store_manager(uuid,uuid,boolean)'::text;
    END IF;
    IF to_regprocedure('public.is_active_store_member(uuid,uuid)') IS NULL THEN
        v_missing := v_missing || 'public.is_active_store_member(uuid,uuid)'::text;
    END IF;
    IF to_regprocedure('public.validate_store_member_permissions(jsonb)') IS NULL THEN
        v_missing := v_missing || 'public.validate_store_member_permissions(jsonb)'::text;
    END IF;
    IF to_regprocedure('public.prevent_sole_owner_change()') IS NULL THEN
        v_missing := v_missing || 'public.prevent_sole_owner_change()'::text;
    END IF;
    IF to_regprocedure('public.prevent_sole_owner_delete()') IS NULL THEN
        v_missing := v_missing || 'public.prevent_sole_owner_delete()'::text;
    END IF;
    IF to_regprocedure('public.store_memberships_guard_insert()') IS NULL THEN
        v_missing := v_missing || 'public.store_memberships_guard_insert()'::text;
    END IF;
    IF to_regprocedure('public.store_memberships_guard_update()') IS NULL THEN
        v_missing := v_missing || 'public.store_memberships_guard_update()'::text;
    END IF;
    IF to_regprocedure('public.audit_store_membership_change()') IS NULL THEN
        v_missing := v_missing || 'public.audit_store_membership_change()'::text;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'store_memberships'
          AND policyname IN ('store_memberships_select','store_memberships_insert',
                             'store_memberships_update','store_memberships_delete')
        HAVING count(*) <> 4
    ) THEN
        v_missing := v_missing || 'expected 4 store_memberships policies'::text;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'conversations'
          AND policyname = 'conversations_store_members_select'
    ) = false THEN
        v_missing := v_missing || 'policy conversations.conversations_store_members_select'::text;
    END IF;

    IF array_length(v_missing, 1) IS NOT NULL THEN
        RAISE EXCEPTION '013 preconditions failed; apply migration 010 first. Missing: %',
            array_to_string(v_missing, ', ');
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- H1. Remove anon EXECUTE from every function introduced by migration 010.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_store_owner(uuid, uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.jsonb_bool(jsonb, text)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_store_manager(uuid, uuid, boolean)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_store_member(uuid, uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_store_member_permissions(jsonb)       FROM PUBLIC, anon;

-- Trigger / guard functions: no client role needs EXECUTE (PostgreSQL checks
-- EXECUTE only when CREATE TRIGGER runs, not when the trigger fires).
REVOKE ALL ON FUNCTION public.prevent_sole_owner_change()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_sole_owner_delete()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_memberships_guard_insert()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_memberships_guard_update()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_store_membership_change()              FROM PUBLIC, anon, authenticated;

-- Keep the five helpers that RLS policies invoke as the caller.
GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid, uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_manager(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_member(uuid, uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.jsonb_bool(jsonb, text)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_store_member_permissions(jsonb)    TO authenticated;

-- ---------------------------------------------------------------------------
-- H2. Remove direct table privileges for anon.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.store_memberships FROM anon;
REVOKE ALL ON TABLE public.store_membership_audit_log FROM anon, authenticated;

-- Keep PostgREST CRUD for signed-in users (idempotent safeguard).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_memberships TO authenticated;

-- ---------------------------------------------------------------------------
-- H3. Restrict RLS policies to authenticated (expressions unchanged from 010).
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

### Verification หลัง Apply (อ่านเท่านั้น)

```sql
-- 1) anon ต้องได้ 0 และ authenticated ต้องได้ 5
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('is_store_owner','jsonb_bool','is_active_store_manager',
                    'is_active_store_member','validate_store_member_permissions',
                    'prevent_sole_owner_change','prevent_sole_owner_delete',
                    'store_memberships_guard_insert','store_memberships_guard_update',
                    'audit_store_membership_change')
ORDER BY p.proname;

-- 2) anon ต้องไม่มี table privilege ใด ๆ
SELECT c.relname, coalesce(array_to_string(c.relacl, ','), '(default)') AS acl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('store_memberships','store_membership_audit_log');

-- 3) policy ต้องเป็น {authenticated} ทั้ง 5
SELECT tablename, policyname, roles::text
FROM pg_policies
WHERE schemaname='public' AND policyname IN
      ('store_memberships_select','store_memberships_insert','store_memberships_update',
       'store_memberships_delete','conversations_store_members_select')
ORDER BY tablename, policyname;

-- 4) trigger ต้องยัง enabled
SELECT t.tgname, c.relname, t.tgenabled
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1;
```

**ผลที่ต้องได้:** `anon_exec = f` ทั้ง 10, `auth_exec = t` 5 ตัวแรก และ `f` 5 ตัวหลัง, `anon` ไม่มี table privilege, policies เป็น `{authenticated}`, trigger `tgenabled='O'` ครบ 5

### Rollback

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid,uuid) TO anon;   -- คืนเฉพาะที่ต้องการ
GRANT EXECUTE ON FUNCTION public.jsonb_bool(jsonb,text)    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_memberships TO anon;
-- policy rollback: DROP + CREATE ใหม่โดยไม่ระบุ TO (ตาม 010)
COMMIT;
```

---

## 8. Part B — Default Privileges (HOLD, ต้องอนุมัติแยก)

**เป้าหมาย:** ปิด F4 ไม่ให้ฟังก์ชัน/ตารางในอนาคตได้ `anon` grant อัตโนมัติ

### 8.1 ข้อเท็จจริงที่ต้องชั่งน้ำหนัก

| ข้อ | รายละเอียด |
|-----|-------------|
| `ALTER DEFAULT PRIVILEGES` มีผลกับ **object ที่สร้างใหม่เท่านั้น** | ไม่ย้อนไปแก้ของเดิม (จึงไม่ซ้ำกับ Part A) |
| มีผลเฉพาะ object ที่สร้างโดย role ที่รันคำสั่ง | ต้องรันเป็น `postgres` (ตรงกับ migration runner) |
| ไม่มีผลกับ extension ที่ติดตั้งแล้ว | 46 ฟังก์ชัน pgcrypto/uuid-ossp ยังคงเดิม |
| ถ้าตั้งกับ FUNCTIONS | ฟังก์ชันแอปใหม่จะไม่เปิดให้ anon อัตโนมัติ → ต้อง `GRANT` เองถ้าตั้งใจให้ public |
| ถ้าตั้งกับ TABLES | ตารางใหม่ (เช่น ตารางสินค้าสาธารณะ) จะอ่านด้วย anon ไม่ได้ จนกว่าจะ grant → **เสี่ยงสูงกว่า** |

### 8.2 SQL ที่เสนอ (ยังไม่อนุมัติ)

```sql
-- 014_revoke_anon_default_privileges.sql  (HOLD — separate approval)
BEGIN;
-- Functions only: new app functions must opt-in explicitly for anon.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM anon;
COMMIT;
```

**ยังไม่แนะนำให้ทำกับ TABLES** — จะทำให้ตาราง public-read ในอนาคตพังเงียบ ๆ ควรใช้วินัยใน migration แทน (grant เองทุกครั้งที่สร้างตารางสาธารณะ)

### 8.3 CI Guard (แนะนำให้เพิ่มแทนการแก้ default ACL ทันที)

```sql
-- ต้องได้ 0 แถว มิฉะนั้น fail
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND pg_get_userbyid(p.proowner) = 'postgres'
  AND p.proname NOT LIKE 'pgp\_%' AND p.proname NOT LIKE '%uuid%'
  AND p.proname NOT LIKE 'gen\_random%' AND p.proname NOT IN
      ('armor','dearmor','crypt','gen_salt','digest','hmac','encrypt','decrypt',
       'encrypt_iv','decrypt_iv','pgp_armor_headers','pgp_key_id','uuid_nil',
       'uuid_ns_dns','uuid_ns_oid','uuid_ns_url','uuid_ns_x500',
       'uuid_generate_v1','uuid_generate_v1mc','uuid_generate_v3','uuid_generate_v5');
```

---

## 9. เหตุผลที่ **ห้าม** เพิ่ม `FORCE ROW LEVEL SECURITY` (คำเตือนสำหรับผู้อนุมัติ)

`store_membership_audit_log` ถูกเขียนโดย trigger `SECURITY DEFINER` ที่ owner = `postgres` และตารางมี RLS เปิดแต่ **ไม่มี policy ใด ๆ** → การเขียนสำเร็จได้เพราะ owner bypass RLS

ถ้าเพิ่ม `ALTER TABLE store_membership_audit_log FORCE ROW LEVEL SECURITY`:
- owner จะไม่ bypass RLS อีก
- ไม่มี policy สำหรับ INSERT → audit insert จะ fail
- ผลคือ **ทุกการเปลี่ยนแปลง membership จะล้มเหลว** (audit trigger เป็น AFTER trigger แต่ error จะ abort transaction)

→ 013 ไม่แตะ FORCE RLS และไม่ควรมีใครแตะในอนาคต

---

## 10. ผลการทดสอบเชิงตรรกะ (Static Verification)

| # | การตรวจ | วิธี | ผล |
|---|---------|-----|-----|
| V1 | 10 signature ตรงกับ DB | `to_regprocedure` | ✅ ครบ 10/10 |
| V2 | policy ที่พึ่ง helper มีเพียง 5 และเป็นของ 010 | `pg_policies` scan | ✅ |
| V3 | trigger ทั้ง 5 enabled | `pg_trigger.tgenabled='O'` | ✅ |
| V4 | ตาราง owner = postgres (runnable โดย migration runner) | `pg_class.relowner` | ✅ |
| V5 | ไม่มี publication (Realtime) | `pg_publication` = 0 | ✅ |
| V6 | ไม่มี view/materialized view | `pg_class.relkind` | ✅ |
| V7 | Frontend ไม่ใช้ Supabase client | grep `frontend/src` | ✅ 0 match |
| V8 | Backend ใช้ service_role กับ `store_memberships` | `socketService.js:110` | ✅ |
| V9 | `anon`/`authenticated` ไม่มี CREATE บน `public` | `has_schema_privilege` | ✅ |
| V10 | `REVOKE ... FROM PUBLIC, role` เป็น syntax ที่ถูกต้อง | `\h REVOKE` | ✅ |

---

## 11. PASS / FAIL / RECOMMENDATION

| รายการ | ผล |
|--------|-----|
| H1 — ถอน anon 10 ฟังก์ชัน | **PASS** |
| H2 — ตัด anon table grants | **PASS** |
| H3 — จำกัด policy เป็น authenticated | **PASS** (semantics คงเดิม) |
| H4 — ถอน authenticated 5 trigger functions | **PASS** (trigger ไม่พัง) |
| Owner / Manager / Staff ทำงานได้ | **PASS** |
| RLS / Audit / Sole-owner ไม่ถูกทำลาย | **PASS** |
| SECURITY DEFINER + search_path | **PASS** (ไม่ถูกแก้) |
| Frontend impact | **PASS** (ไม่มี) |
| Backend impact | **PASS** (service_role) |
| Precondition guard | **เพิ่มแล้ว** (เดิมขาด) |
| Default Privileges (เป้าหมาย 1) | **HOLD** — ต้องอนุมัติแยก (Part B) |

### Recommendation

1. **อนุมัติ Part A** (ไฟล์ `013_harden_migration_010_privileges.sql`) — ความเสี่ยง LOW, rollback ง่าย, ไม่กระทบผู้ใช้
2. **อย่าแยก deploy** H1 กับ H3 (เหตุผล R1)
3. **Apply บน staging ก่อน** แล้วรัน verification 4 ชุดในหัวข้อ 7 + smoke test 3 บทบาท (Owner เพิ่ม/แก้/ลบ staff, Manager เพิ่ม staff, Staff อ่าน conversations)
4. **Part B: ตัดสินใจแยก** — แนะนำทำเฉพาะ FUNCTIONS และใช้ CI guard แทนการแตะ TABLES
5. **Cloud Verification:** ตรวจ `authenticator` ว่าไม่มี direct grant (ตรวจ local ไม่ได้เพราะ role ไม่มีใน DB ทดสอบ) และตรวจว่าไม่มี policy `test_*` บน production

---

## 12. การปฏิบัติตามข้อกำหนด

- [x] ตรวจบน Local Docker PostgreSQL เท่านั้น (`kindee_pg_test`)
- [x] **ไม่ Execute SQL** (013 และ Part B ยังไม่ถูกนำไปใช้)
- [x] ไม่แก้ไขฐานข้อมูล (ทุก query เป็น read-only / metadata)
- [x] ไม่แก้ Migration 010
- [x] ไม่เชื่อมต่อ Supabase Cloud
- [x] ไม่ลบข้อมูล
- [x] ไม่เปิดเผย Secrets
- [x] ไม่เริ่มตรวจ Migration 010 ใหม่ทั้งหมด (ใช้ผลเดิม 25/25 + baseline ที่มี)

---

**สรุปสุดท้าย:** SQL ฉบับพร้อมอนุมัติอยู่ในหัวข้อ 7 และไฟล์ `supabase/migrations/013_harden_migration_010_privileges.sql` — ผ่านการตรวจครบ 8 เป้าหมาย โดยเป้าหมายข้อ 1 (Default Privileges) ถูกแยกเป็น Part B เพราะต้องอนุมัติเชิงนโยบาย ไม่ใช่เชิงเทคนิค
