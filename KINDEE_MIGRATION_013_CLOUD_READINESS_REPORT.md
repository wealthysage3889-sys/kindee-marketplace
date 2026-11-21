# KINDEE_MIGRATION_013_CLOUD_READINESS_REPORT.md

**วันที่ตรวจ:** 2026-11-18T16:30:00Z
**โครงการ:** kindee-marketplace
**เป้าหมาย:** Supabase Project `bzkjtvsqqxnbbnkgcrko` (`kindee`, region Northeast Asia / Tokyo, สร้าง 2026-11-15)
**รูปแบบการตรวจ:** **READ-ONLY ทั้งหมด** — catalog query ผ่าน pooler + HTTP GET ผ่าน PostgREST/Auth
**ผลรวม:** N1 **PASS** · N2 **PASS** · N3 **PASS** · Smoke Test Readiness **PARTIAL (NOT VERIFIED สำหรับ Manager/Staff)**

> **ไม่มีการ Execute Migration 013 บน Cloud, ไม่ได้รัน Part B, ไม่ได้แก้ Schema/Policy/ACL/ข้อมูล และไม่ได้สร้าง Staging Project ใหม่**

---

## 0. สรุปผู้บริหาร

| รายการ | ผล |
|--------|-----|
| N1 — `authenticator` privileges | **PASS** (ไม่มี direct privilege ใด ๆ บน object ของ 010) |
| N2 — RLS policy ชื่อ `test_*` | **PASS** (0 แถว) |
| N3 — PostgREST / API access | **PASS** (GoTrue 200, PostgREST ตอบถูกต้อง, anon อ่าน `stores` ได้, `store_memberships` ได้ `[]`) |
| 013 ถูก apply บน Cloud แล้วหรือยัง | **ยังไม่ apply** (policy ยัง `{public}`, anon ยัง EXECUTE 10/10) |
| Smoke Test Owner | **พร้อม** (มี owner จริง 4 ร้าน) |
| Smoke Test Manager / Staff | **NOT VERIFIED** (production ไม่มี membership ของ manager/staff) |
| ความเสี่ยงใหม่ที่พบจาก Cloud | **`anon` มี TRUNCATE / TRIGGER / MAINTAIN บน `store_memberships`** (PG17 + default ACL ของ Supabase) |

**คำตัดสิน:** N1–N3 ผ่านทั้งหมด → **เงื่อนไข G5 ในรายงาน Local Execution ถูกปิด** แต่ยังมี 3 เรื่องต้องตัดสินใจก่อนอนุมัติ (หัวข้อ 7) และมี 1 เหตุการณ์ด้านความปลอดภัยที่ต้องแก้ (หัวข้อ 6)

---

## 1. การเข้าถึงและความถูกต้องของเป้าหมาย

| การตรวจ | ผล | หลักฐาน |
|---------|-----|----------|
| Project ตรงกับที่ระบุ | ✅ | `supabase projects list` → `bzkjtvsqqxnbbnkgcrko` / `kindee` / Tokyo |
| Supabase URL ใน `.env` ชี้ project เดียวกัน | ✅ | host = `bzkjtvsqqxnbbnkgcrko.supabase.co` |
| **`supabase/.temp/project-ref`** | ⚠️ **ไม่ตรง** | ไฟล์ระบุ `henhkouetfjelkqsfzgu` (people/โปรเจกต์อื่น) |
| **`supabase/.temp/pooler-url`** | ⚠️ **ไม่ตรง** | pooler username = `postgres.henhkouetfjelkqsfzgu` (โปรเจกต์อื่น) |
| วิธีเชื่อมต่อที่ใช้จริง | pooler `aws-0-ap-northeast-1.pooler.supabase.com:5432` + role `postgres.bzkjtvsqqxnbbnkgcrko` | `current_database()` = `postgres`, `inet_server_addr` = `2406:da14:311:1500:…` |
| Server version | PostgreSQL **17.11** | ต่างจาก local PG15 |
| Read-only enforcement | `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=20000'` | ทุก session เป็น read-only |
| Direct DB (`db.<ref>.supabase.co:5432`) | ❌ เข้าไม่ได้จากเครื่องนี้ (มีเฉพาะ AAAA record) | TCP 5432 = False; ใช้ pooler แทน |

> **ต้องแก้ก่อนอนุมัติ:** `.temp/project-ref` และ `.temp/pooler-url` เป็นของ project อื่น (`henhkouetfjelkqsfzgu`) — ต้องไม่ถูกใช้ในขั้นตอน deployment ใด ๆ (เช่น `supabase db push --linked` จะชี้ผิด project) แนะนำ `supabase link --project-ref bzkjtvsqqxnbbnkgcrko` หรือลบไฟล์ `.temp/*` ก่อนใช้ CLI

---

## 2. N1 — สิทธิ์ของ `authenticator`

### 2.1 Role attributes และ membership

| Role | super | bypassrls | canlogin | inherit |
|------|-------|-----------|----------|---------|
| `authenticator` | f | f | **t** | **f** |
| `anon` | f | f | f | t |
| `authenticated` | f | f | f | t |
| `service_role` | f | **t** | f | t |

`authenticator` เป็นสมาชิกของ `anon`, `authenticated`, `service_role` โดย **ไม่มี `ADMIN OPTION`** → เป็น login role ที่ทำหน้าที่ `SET ROLE` เท่านั้น (ถูกต้องตามดีไซน์ Supabase)

### 2.2 Direct privileges ของ `authenticator` บน object ของ 010

| การตรวจ | ผล |
|---------|-----|
| EXECUTE บน 10 ฟังก์ชันของ 010 | **f ทั้ง 10** |
| SELECT/INSERT/UPDATE/DELETE บน `store_memberships` | **f ทั้งหมด** |
| USAGE บน schema `public` | t (จำเป็น) |
| CREATE บน schema `public` | f |

**N1 = PASS** — `authenticator` ไม่มีสิทธิ์เกิน และไม่มีทาง bypass RLS (ไม่ใช่ owner, ไม่ใช่ superuser, ไม่มี bypassrls)

### 2.3 Baseline ก่อน 013 (ยืนยันว่า 013 ยังไม่ถูก apply)

| ฟังก์ชัน | anon | authenticated | service_role |
|----------|------|---------------|--------------|
| 10 ฟังก์ชันของ 010 | **t ทั้ง 10** | t ทั้ง 10 | t ทั้ง 10 |

```
store_memberships        : postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
store_membership_audit_log: postgres=arwdDxtm, service_role=arwdDxtm
```

---

## 3. N2 — RLS policy ชื่อ `test_*`

```sql
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'test\_%';
```

**ผล: 0 แถว** → **N2 = PASS** (ไม่มี policy จาก test harness หลุดขึ้น production)

Policy ที่เกี่ยวข้องกับ 010 ใน Cloud (baseline ก่อน 013):

| ตาราง | Policy | Roles | Command |
|-------|--------|-------|---------|
| `store_memberships` | `store_memberships_select` | `{public}` | SELECT |
| `store_memberships` | `store_memberships_insert` | `{public}` | INSERT |
| `store_memberships` | `store_memberships_update` | `{public}` | UPDATE |
| `store_memberships` | `store_memberships_delete` | `{public}` | DELETE |
| `conversations` | `conversations_store_members_select` | `{public}` | SELECT |

ตรงกับ local ก่อน apply 013 → **013 จะเปลี่ยนเฉพาะ `roles` เป็น `{authenticated}`**

**ตรวจเพิ่มเติมที่ผ่าน:**
- RLS เปิดทั้ง 2 ตาราง (`relrowsecurity = t`), `FORCE RLS = f` (ถูกต้อง — audit writer ต้อง bypass)
- Trigger ของ 010 ครบ 5 ตัว สถานะ `O`
- SECURITY DEFINER 6/6 pin `search_path=public, pg_catalog`
- policy ที่พึ่ง helper functions มีเพียง 5 รายการ (ทั้งหมดจาก 010) → ไม่มีผลข้างเคียงข้ามตาราง

> **หมายเหตุ:** ไม่มี schema `supabase_migrations` และไม่มีตาราง `schema_migrations` ของ CLI (`auth`/`realtime`/`storage` มีของตัวเอง) → **ไม่สามารถยืนยันได้ว่า 010 ถูก apply ผ่าน CLI ledger** แม้ object จะมีอยู่จริง (ถือเป็น NOT VERIFIED ข้อ M1)

---

## 4. N3 — PostgREST / API access

| Endpoint | Method | ผล |
|----------|--------|-----|
| `/auth/v1/health` (apikey) | GET | **200** — GoTrue **v2.198.0** |
| `/rest/v1/` (apikey) | GET | **401** — `Secret API key required` (root OpenAPI ต้องใช้ secret key; พฤติกรรมปกติของ platform รุ่นนี้) |
| `/rest/v1/store_memberships?select=id&limit=1` (anon) | GET | **200** — body `[]` (RLS กรอง) |
| `/rest/v1/store_membership_audit_log?select=id&limit=1` (anon) | GET | **401** (ไม่มี grant) |
| `/rest/v1/stores?select=id&limit=1` (anon) | GET | **200** — คืน 1 ร้าน (public read ทำงาน) |

**N3 = PASS** — PostgREST และ Auth ทำงานปกติ, schema cache เห็นตารางครบ, สิทธิ์สาธารณะทำงานตามที่ออกแบบ

**ผลคาดหมายหลัง apply 013 (ใช้เป็นเกณฑ์ตรวจ):**

| Endpoint | ก่อน 013 | หลัง 013 |
|----------|-----------|-----------|
| `/rest/v1/store_memberships` (anon) | `200 []` | **401/403** |
| `/rest/v1/store_member…` ด้วย JWT ของ owner | 200 (แถวของร้านตัวเอง) | เหมือนเดิม |
| `/rest/v1/rpc/is_store_owner` (anon) | 200 | **401/403** |

---

## 5. ข้อค้นพบใหม่จาก Cloud (local PG15 ไม่แสดง)

### F-C1: `anon` มี TRUNCATE / TRIGGER / MAINTAIN บน `store_memberships` — **P2 (High impact if reached)**

| Privilege | anon | authenticated | service_role |
|-----------|------|---------------|--------------|
| SELECT / INSERT / UPDATE / DELETE | t | t | t |
| **TRUNCATE** | **t** | t | t |
| **TRIGGER** | **t** | t | t |
| **MAINTAIN** (PG17) | **t** | t | t |

สาเหตุ: default ACL ของ Supabase ใช้ `GRANT ALL` (ไม่ใช่แค่ CRUD) → ACL เป็น `arwdDxtm` ต่างจาก local test ที่เป็น `arwd`

**การประเมิน exploitability (สำคัญ):**
- `anon` ไม่สามารถ login ได้ (`rolcanlogin = f`) และไม่สามารถถือ credential ตรงได้
- PostgREST **ไม่รองรับ TRUNCATE/DDL** → ไม่สามารถเรียกผ่าน API
- ดังนั้นยังไม่ใช่ช่องโหว่ที่ใช้ได้จากภายนอกผ่าน anon key **แต่** `TRUNCATE` ไม่ถูกจำกัดด้วย RLS และเป็น operation ที่ทำลายข้อมูลทั้งตาราง → ถ้ามีช่องทางใดที่ได้ session ในฐานะ role `anon` (หรือ role ที่สืบทอดสิทธิ์) ผลกระทบคือ **ข้อมูลสมาชิกร้านทั้งหมดหาย**

**013 แก้ข้อนี้อยู่แล้ว** (`REVOKE ALL ON TABLE ... FROM anon` จะถอน `D`, `t`, `m` ด้วย) → หลัง apply ต้องตรวจว่า `TRUNCATE/TRIGGER/MAINTAIN` ของ anon = `f`

### F-C2: Default ACL มีเจ้าของ 2 role

```
r,f,S : postgres=… / supabase_admin=…
```

ถ้าจะทำ Part B (`ALTER DEFAULT PRIVILEGES`) ต้องรันให้ครบ **ทั้ง `postgres` และ `supabase_admin`** มิฉะนั้น object ที่สร้างโดยอีก role จะยังได้ `anon` grant

### F-C3: Cloud เป็น PostgreSQL 17.11 (local เป็น 15.20)

013 ใช้ syntax ที่ไม่ผูกกับ version และ `REVOKE ALL` ครอบ privilege ใหม่ (`MAINTAIN`) ได้ — แต่ **ต้องตรวจหลัง apply ด้วยเมทริกซ์ของ PG17** ไม่ใช่แค่ CRUD

---

## 6. เหตุการณ์ด้านความปลอดภัยที่ต้องแก้ (Credential Exposure)

ระหว่างการเชื่อมต่อ pooler มีการใช้ `sh -x` เพื่อ debug และ trace แสดง **connection string ที่มีรหัสผ่านของ role `postgres`** ใน log ของ session นี้ (ไม่ได้บันทึกลงไฟล์รายงาน และไม่ได้ถูกส่งออกนอกเครื่อง)

| มาตรการ | รายละเอียด |
|---------|-------------|
| ระดับความเสี่ยง | ปานกลาง — รหัสผ่านอยู่ใน log ของ session/terminal history |
| ต้องทำ | **Rotate database password ของ project `bzkjtvsqqxnbbnkgcrko`** (Dashboard → Settings → Database → Reset password) แล้วอัปเดต `.env` ของ backend |
| ไฟล์ชั่วคราว | ลบ `/tmp/pg_target_url`, `/tmp/run_*.sh`, `/tmp/cloud_*.sql` ใน container และไฟล์ใน `%TEMP%\kilo\` แล้ว (ยืนยันแล้ว) |
| ข้อปฏิบัติต่อไป | ห้ามใช้ `sh -x`/`set -x` กับคำสั่งที่มี credential; ใช้ `PGPASSFILE` หรือ env var ที่ไม่ echo |

> รหัสผ่านไม่ได้ถูกคัดลอกลงในรายงานนี้หรือไฟล์ใด ๆ ที่ส่งมอบ

---

## 7. Smoke Test Readiness (3 บทบาท)

### 7.1 ข้อมูลจริงบน Production (metadata)

| ร้าน | Owner profile | is_active | is_verified | Manager | Staff |
|------|----------------|-----------|-------------|---------|-------|
| `0c139035…` | `424541d8…` | t | t | — | — |
| `02651d33…` | `c04cc1b5…` | t | f | — | — |
| `8e8f36d7…` | `5cfee7c4…` | t | f | — | — |
| `be9d162e…` | `d5f3e4ba…` | t | f | — | — |

- `store_memberships` = **4 แถว** (owner ทั้งหมด), `store_membership_audit_log` = **0 แถว**
- **ไม่มี manager/staff membership ใน production** → ไม่สามารถ smoke test 2 บทบาทนี้ได้โดยไม่สร้างข้อมูล

### 7.2 แผนทดสอบที่แนะนำ (3 ชั้น)

**T1 — Catalog verification (ทำได้ทันทีหลัง apply, ความเสี่ยง 0)**

```sql
-- anon ต้องไม่มี EXECUTE และไม่มี table privilege ใด ๆ (รวม TRUNCATE/TRIGGER/MAINTAIN)
SELECT p.proname, has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('is_store_owner','jsonb_bool','is_active_store_manager','is_active_store_member',
  'validate_store_member_permissions','prevent_sole_owner_change','prevent_sole_owner_delete',
  'store_memberships_guard_insert','store_memberships_guard_update','audit_store_membership_change')
ORDER BY 1;

SELECT has_table_privilege('anon','public.store_memberships','SELECT')   AS sel,
       has_table_privilege('anon','public.store_memberships','INSERT')   AS ins,
       has_table_privilege('anon','public.store_memberships','UPDATE')   AS upd,
       has_table_privilege('anon','public.store_memberships','DELETE')   AS del,
       has_table_privilege('anon','public.store_memberships','TRUNCATE') AS trunc,
       has_table_privilege('anon','public.store_memberships','TRIGGER')  AS trg,
       has_table_privilege('anon','public.store_memberships','MAINTAIN') AS maint;

SELECT tablename, policyname, roles::text FROM pg_policies
WHERE schemaname='public' AND tablename IN ('store_memberships','conversations') ORDER BY 1,2;

SELECT t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname='store_memberships';
```

**T2 — Owner smoke (transactional, rollback, ความเสี่ยงต่ำ)**

ใช้ owner จริง 1 ร้าน (`0c139035…` / `424541d8…`) — ทดสอบใน `BEGIN … ROLLBACK` เท่านั้น

```sql
BEGIN;
SELECT set_config('request.jwt.claim.sub','424541d8-2a27-41c2-b11e-8a4c781760b5',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;

-- 1) owner เห็นสมาชิกในร้านตัวเอง
SELECT count(*) AS owner_visible FROM public.store_memberships;
-- 2) owner เรียก helper ได้
SELECT public.is_store_owner('0c139035-f34a-4764-b630-ece7988b7065',
                             '424541d8-2a27-41c2-b11e-8a4c781760b5') AS is_owner;
-- 3) owner ลดสิทธิ์ตัวเอง (owner คนเดียว) ต้องได้ P0001
UPDATE public.store_memberships SET role='staff'
 WHERE store_id='0c139035-f34a-4764-b630-ece7988b7065'
   AND profile_id='424541d8-2a27-41c2-b11e-8a4c781760b5';
-- คาด: ERROR P0001 Cannot demote…sole active owner
ROLLBACK;
```

**T3 — Manager / Staff smoke (ต้องสร้าง fixture ใน transaction เท่านั้น)**

```sql
BEGIN;
-- fixture: manager + staff ในร้านทดสอบ (จะถูก rollback ทั้งหมด)
INSERT INTO public.store_memberships (store_id, profile_id, role, permissions)
VALUES ('0c139035-f34a-4764-b630-ece7988b7065','270333a4-dee4-4210-83df-d301f19e4dc6','manager','{"member_write":true}'),
       ('0c139035-f34a-4764-b630-ece7988b7065','43bb6697-ba1a-4d25-a05d-59a571e8e880','staff','{}');

-- Manager: เห็นสมาชิก, เพิ่มตัวเองไม่ได้, ให้ member_write ไม่ได้, เปลี่ยน role ไม่ได้
SELECT set_config('request.jwt.claim.sub','270333a4-dee4-4210-83df-d301f19e4dc6',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS manager_visible FROM public.store_memberships;   -- คาด 3
-- ทดสอบเชิงลบ: INSERT ตัวเอง / grant member_write / UPDATE role  → คาด P0001

RESET ROLE;
-- Staff: เห็นเฉพาะแถวตัวเอง
SELECT set_config('request.jwt.claim.sub','43bb6697-ba1a-4d25-a05d-59a571e8e880',true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS staff_visible FROM public.store_memberships;     -- คาด 1
ROLLBACK;
```

**Cleanup:** ไม่ต้องมี — ทุกอย่างอยู่ใน transaction ที่ `ROLLBACK` เสมอ ถ้า session หลุด กลางทาง PostgreSQL rollback อัตโนมัติ
**ตรวจหลังทดสอบ:** `memberships = 4`, `audit_rows = 0` (ต้องเท่าเดิม)

**T4 — API-level smoke (ยัง NOT VERIFIED):** ต้องมีบัญชีทดสอบ + JWT ของ manager/staff และต้องสร้าง membership จริง → **ไม่แนะนำบน production** ถ้าจำเป็นต้องทำ ควรทำบน preview/branch ที่ได้รับอนุมัติแยก

### 7.3 สรุปความพร้อม Smoke Test

| บทบาท | ความพร้อม | หมายเหตุ |
|-------|-----------|----------|
| Owner | ✅ พร้อม (T1+T2) | มี owner จริง 4 ร้าน |
| Manager | ⚠️ พร้อมเฉพาะ T3 (transactional fixture) | ไม่มี manager จริงบน production |
| Staff | ⚠️ พร้อมเฉพาะ T3 (transactional fixture) | ไม่มี staff จริงบน production |

---

## 8. การรับประกันว่าไม่กระทบข้อมูลจริง

| มาตรการ | สถานะ |
|---------|-------|
| Session ทั้งหมดเป็น `default_transaction_read_only=on` | ✅ |
| ไม่มี DDL/DML ใด ๆ ถูกส่งไปยัง Cloud (เฉพาะ SELECT catalog + HTTP GET) | ✅ |
| ไม่มีการ Execute 013 / Part B | ✅ |
| ไม่มีการสร้าง/ลบ project, branch, หรือ user | ✅ |
| ข้อมูลก่อน/หลังตรวจ | `memberships=4`, `audit=0` (อ่านเท่านั้น ไม่เปลี่ยน) |
| ไฟล์ credential ชั่วคราว | ลบครบทั้งใน container และ host แล้ว |
| Secrets ในรายงาน | ไม่มี (ระบุเฉพาะ host/role/ref) |

**วิธี cleanup หากจำเป็น (สำหรับ T2/T3):** ใช้ `ROLLBACK` เท่านั้น — ไม่มีข้อมูลถูกเขียนถาวร จึงไม่มี cleanup SQL ให้รัน
**หากอนุมัติให้ทดสอบแบบ commit (ไม่แนะนำ):** ต้องลบตามลำดับ `store_memberships` → ตรวจ FK → และ audit log เป็น append-only (ลบได้เฉพาะ role ที่มีสิทธิ์) พร้อมนับแถวก่อน/หลัง

---

## 9. PASS / FAIL / NOT VERIFIED

### PASS

| ID | รายการ | หลักฐาน |
|----|--------|---------|
| N1 | `authenticator` ไม่มี direct privilege บน object ของ 010 | 10/10 EXECUTE = f, table priv = f ทั้งหมด |
| N1b | `authenticator` เป็นสมาชิก anon/authenticated/service_role แบบไม่มี ADMIN OPTION | `pg_auth_members` 3 แถว, `admin_option=f` |
| N2 | ไม่มี policy `test_*` | 0 แถว |
| N2b | RLS/Trigger/SECDEF ของ 010 บน Cloud ตรงกับ local | RLS=t, force=f, trigger 5/5 `O`, search_path pin 10/10 |
| N3 | PostgREST/Auth ทำงาน | GoTrue 200, anon `stores` 200, `store_memberships` 200 `[]`, audit 401 |
| — | 013 ยังไม่ถูก apply บน Cloud | anon EXECUTE 10/10, policy `{public}` |

### FAIL

ไม่มี (ไม่พบว่าสภาพ Cloud ขัดกับสิ่งที่ 013 คาดหวัง)

### NOT VERIFIED

| ID | รายการ | เหตุผล | วิธีปิด |
|----|--------|--------|---------|
| M1 | ประวัติการ apply migration 010 ผ่าน CLI ledger | ไม่มี schema `supabase_migrations` (อาจ apply ด้วย SQL editor) | ตรวจกับผู้ดูแลว่า apply 010 ด้วยวิธีใด / ใช้ `supabase migration repair` |
| M2 | Manager/Staff smoke บนข้อมูลจริง | production ไม่มี manager/staff membership | อนุมัติ T3 (transactional) หรือทดสอบบน preview |
| M3 | API-level smoke ด้วย JWT จริง | ไม่มีบัญชีทดสอบ/รหัสผ่าน | ต้องได้รับอนุมัติ + บัญชีทดสอบ |
| M4 | พฤติกรรมหลัง apply 013 บน Cloud | ห้าม Execute 013 | รัน T1 + REST probe หลัง apply |

---

## 10. คำนวณผลกระทบถ้าอนุมัติ 013 บน Cloud

| การเปลี่ยนแปลง | ผล | ความเสี่ยง |
|-----------------|-----|-----------|
| anon EXECUTE 10 → 0 | ปิด oracle + ปิด EXECUTE บนฟังก์ชันที่ RLS ใช้ | ต่ำ (ไม่มี client anon เรียก RPC เหล่านี้) |
| anon table privileges → 0 (รวม TRUNCATE/TRIGGER/MAINTAIN) | ปิด F-C1 | ต่ำ — anon ไม่ได้ใช้ตารางนี้ผ่าน API อยู่แล้ว (ได้ `[]`) |
| authenticated EXECUTE 10 → 5 | ถอน 5 trigger functions | ต่ำ — trigger ไม่ต้อง EXECUTE ตอน runtime |
| policy `{public}` → `{authenticated}` | anon ได้ default-deny | ต่ำ — REST ของ anon เปลี่ยนจาก `200 []` เป็น `401/403` |
| ไม่แตะข้อมูล | 4 memberships / 0 audit คงเดิม | — |

**Rollback บน Cloud** (ถ้าพบปัญหา): ใช้ SQL ชุดเดียวกับหัวข้อ 9 ของ `KINDEE_MIGRATION_013_LOCAL_EXECUTION_REPORT.md` (GRANT คืน + DROP/CREATE policy แบบไม่มี `TO`) — 013 ไม่แตะข้อมูล จึง rollback ได้ทันทีโดยไม่ต้อง restore dump

**สิ่งที่ต้องเตรียมก่อน apply บน Cloud:**
1. Snapshot ACL/policy ปัจจุบัน (ตามหัวข้อ 2.3 และ 3) เก็บเป็นไฟล์หลักฐาน
2. รัน 013 ใน transaction เดียว (ไฟล์มี `BEGIN/COMMIT` อยู่แล้ว) ผ่าน pooler session ที่ **ไม่ใช่** read-only
3. รัน T1 ทันทีหลัง apply + REST probe (anon → 401/403)
4. เฝ้าดู error rate 5–10 นาที; ถ้าพบ `permission denied for function` จาก client ให้ rollback

---

## 11. Gate สรุป

| Gate | สถานะ |
|------|-------|
| G4 — Smoke test 3 บทบาท | ⚠️ Owner พร้อม / Manager-Staff ต้องอนุมัติ T3 |
| G5 — ตรวจ N1–N3 บน Cloud | ✅ **ปิดแล้ว** |
| G6 — ตัดสินใจ Part B | ⬜ ยังไม่ตัดสิน (ต้องครอบทั้ง `postgres` และ `supabase_admin`) |
| G7 — หมุนรหัสผ่าน DB หลังเหตุการณ์ credential exposure | ⬜ **ต้องทำก่อนอนุมัติ** |
| G8 — แก้ `.temp/project-ref` / `pooler-url` ที่ชี้ผิด project | ⬜ **ต้องทำก่อนใช้ CLI** |

---

## 12. การปฏิบัติตามข้อกำหนด

- [x] ตรวจ N1–N3 แบบ READ-ONLY กับ project `bzkjtvsqqxnbbnkgcrko`
- [x] ไม่ได้รัน Migration 013 บน Cloud
- [x] ไม่ได้รัน Part B
- [x] ไม่ได้แก้ Schema / Policy / ACL / ข้อมูล Cloud (read-only session ทั้งหมด)
- [x] ไม่ได้สร้าง Staging Project ใหม่
- [x] ไม่เปิดเผย Secrets ในรายงาน (มีเหตุการณ์ trace แสดง credential → รายงานเป็น incident + แนะนำ rotate โดยไม่ระบุค่า)
- [x] หยุดหลังสร้างรายงาน เพื่อรออนุมัติ

---

**สรุป:** Cloud พร้อมในเชิงโครงสร้างสำหรับ 013 (N1–N3 PASS, baseline ตรงกับที่ 013 คาดหวัง และ 013 ยังไม่ถูก apply) — แต่ก่อนอนุมัติต้องจัดการ 2 เรื่องคือ **หมุนรหัสผ่าน DB** และ **แก้ไฟล์ `.temp` ที่ชี้ผิด project** พร้อมตัดสินใจว่าจะอนุมัติ T3 (transactional smoke สำหรับ Manager/Staff) หรือยอมรับว่าบทบาทเหล่านั้นตรวจได้เฉพาะบน local/preview
