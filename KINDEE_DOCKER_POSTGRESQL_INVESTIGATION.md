# KINDEE_DOCKER_POSTGRESQL_INVESTIGATION.md

**วันที่สร้าง:** 2026-11-18T15:00:00Z  
**โครงการ:** kindee-marketplace  
**ขอบเขต:** ตรวจสอบ Docker Container `kindee_pg_test` แบบ Read-only เท่านั้น  
**ข้อห้ามที่ปฏิบัติตาม:** ไม่ลบ Container/Volume, ไม่แก้ไขฐานข้อมูล, ไม่รัน Migration/Rollback, ไม่เปิดเผย Credentials/Secrets

---

## 1. สรุปภาพรวม (Executive Summary)

| รายการ | ผล |
|--------|-----|
| Container `kindee_pg_test` | ✅ ทำงานอยู่ (Running) |
| Image | `postgres:15-bookworm` (PostgreSQL 15.20) |
| Host Port | `55432` (映射ไปยัง `5432` ภายใน container) |
| Database | `kindee` |
| Migration 010 objects | ✅ ครบถ้วนตรงกับไฟล์ SQL (ตาราง, ดัชนี, คอนสตรินต์, ทริกเกอร์, นโยบาย RLS, ฟังก์ชัน) |
| ตาราง `schema_migrations` | ❌ ไม่มี (เป็น PostgreSQL แยกต่างหาก ไม่ใช่แพลตฟอร์ม Supabase) |
| เชื่อมต่อ Supabase Cloud | ❌ **ไม่มีการเชื่อมต่อถาวร** (Isolated / Standalone) |

**ข้อสรุป:** `kindee_pg_test` เป็น PostgreSQL แบบ isolated ใน Docker ใช้สำหรับทดสอบใน lokal/staging เท่านั้น ไม่ได้เชื่อมต่อกับ Supabase Cloud Project `bzkjtvsqqxnbbnkgcrko` ของระบบจริง และ Migration 010 ถูกนำไปใช้บนฐานข้อมูล lokal แล้วแต่ไม่มีการติดตามเวอร์ชันผ่าน `schema_migrations`

---

## 2. รายละเอียด Docker Container `kindee_pg_test`

### 2.1 สถานะ Container

| รายการ | ค่า |
|--------|-----|
| Container ID | `95a3021bb088` |
| Image | `postgres:15-bookworm` |
| สถานะ | Running (Up About an hour) |
| คำสั่ง | `postgres` |
| พอร์ตที่เปิดเผย | `0.0.0.0:55432->5432/tcp`, `[::]:55432->5432/tcp` |
| Volume ที่ mount | ชื่อวอลุ่มตามระบบ Docker, mount ที่ `/var/lib/postgresql/data` (ไม่ลบ, ไม่แก้ไข) |

### 2.2 ตัวแปรสภาพแวดล้อม (ค่าจริงถูกปกปิดในรายงานนี้)

ตัวแปรที่ตรวจพบใน container (ไม่แสดงค่าจริง): `POSTGRES_DB`, `POSTGRES_PASSWORD`, `PG_MAJOR`, `PG_VERSION`, `PGDATA`, ฯลฯ  
ฐานข้อมูลที่สร้างอัตโนมัติ: `kindee`

**หมายเหตุ:** ไม่เปิดเผยรหัสผ่านหรือ secrets ตามข้อกำหนด

---

## 3. PostgreSQL และฐานข้อมูล `kindee` (อ่านอย่างเดียว)

### 3.1 เวอร์ชันและเอกซ์เทนชัน

| รายการ | ค่า |
|--------|-----|
| PostgreSQL version | `PostgreSQL 15.20 (Debian 15.20-1.pgdg12+1)` |
| เอกซ์เทนชันที่ติดตั้ง | `pgcrypto 1.3`, `plpgsql 1.0`, `uuid-ossp 1.1` |
| ฐานข้อมูลที่มีอยู่ | `kindee`, `postgres` |

ไม่มีเอกซ์เทนชัน `dblink` หรือ `postgres_fdw` ซึ่งสนับสนุนข้อสรุปว่าไม่มีการเชื่อมต่อออกไปยังฐานข้อมูลภายนอก เช่น Supabase Cloud

### 3.2 ตารางในสคีมา `public`

| ตาราง | ประมาณจำนวนแถว |
|-------|------------------|
| `conversations` | -1 (ค่าประมาณจากระบบ) |
| `profiles` | 7 |
| `store_membership_audit_log` | 0 |
| `store_memberships` | 2 |
| `stores` | 2 |

---

## 4. ตรวจสอบ Migration 010 แบบ Read-only

### 4.1 โครงสร้างตาราง `store_memberships`

คอลัมน์ทั้งหมดตรงกับไฟล์ `supabase/migrations/010_store_memberships.sql`:
`id`, `store_id`, `profile_id`, `role`, `permissions`, `joined_at`, `left_at`, `suspended_at`, `suspended_by`, `suspended_reason`, `removed_by`, `removed_reason`, `rejoined_at`

คีย์หลัก: `store_memberships_pkey` (id)

ดัชนีที่มีอยู่:
- `store_memberships_pkey` (PRIMARY KEY)
- `ux_store_memberships_active` (UNIQUE, partial: WHERE left_at IS NULL)
- `idx_store_memberships_active` (partial: WHERE left_at IS NULL)
- `idx_store_memberships_profile`
- `idx_store_memberships_store`
- `idx_store_memberships_store_role_active` (partial: WHERE left_at IS NULL)
- `idx_store_memberships_suspended` (partial: WHERE suspended_at IS NOT NULL)

คอนสตรินต์เช็ค: `store_memberships_role_check` (role IN owner/manager/staff)

คีย์ต่างประเทศ (FK): `store_id` → `stores(id)`, `profile_id` → `profiles(id)`, `suspended_by` → `profiles(id)`, `removed_by` → `profiles(id)` (ทั้งหมด ON DELETE CASCADE/SET NULL ตามไฟล์ SQL)

### 4.2 โครงสร้างตาราง `store_membership_audit_log`

คอลัมน์: `id`, `actor_id`, `actor_db_role`, `actor_jwt_role`, `actor_kind`, `store_id`, `member_id`, `operation`, `old_values`, `new_values`, `reason`, `created_at`

ดัชนี: `store_membership_audit_log_pkey`, `idx_store_membership_audit_store`, `idx_store_membership_audit_member`, `idx_store_membership_audit_created`

### 4.3 สถานะ Row Level Security (RLS)

| ตาราง | rowsecurity |
|-------|-------------|
| `store_memberships` | t (เปิดใช้งาน) |
| `store_membership_audit_log` | t (เปิดใช้งาน, ไม่มีนโยบาย = ปฏิเสธทั้งหมดสำหรับ anon/authenticated/PUBLIC) |

### 4.4 นโยบาย RLS (อ่านอย่างเดียว)

| ตาราง | นโยบาย | คำสั่ง |
|-------|--------|--------|
| `store_memberships` | `store_memberships_delete` | DELETE |
| `store_memberships` | `store_memberships_insert` | INSERT |
| `store_memberships` | `store_memberships_select` | SELECT |
| `store_memberships` | `store_memberships_update` | UPDATE |
| `conversations` | `conversations_store_members_select` | SELECT |

(นโยบายอื่น ๆ เช่น `test_conversations_read`, `test_profiles_self`, `test_stores_read` เป็นของตารางทดสอบอื่น ไม่เกี่ยวกับ migration 010 โดยตรง)

### 4.5 ทริกเกอร์บน `store_memberships`

| ทริกเกอร์ | เหตุการณ์ | เวลาทำงาน |
|-----------|-----------|----------|
| `trg_prevent_sole_owner_delete` | DELETE | BEFORE |
| `trg_prevent_sole_owner_update` | UPDATE | BEFORE |
| `trg_store_membership_audit` | INSERT/UPDATE/DELETE | AFTER |
| `trg_store_memberships_guard_insert` | INSERT | BEFORE |
| `trg_store_memberships_guard_update` | UPDATE | BEFORE |

ทั้ง 7 ทริกเกอร์ตรงกับที่ระบุในไฟล์ migration 010

### 4.6 ฟังก์ชัน (Security Definer ตามไฟล์ SQL)

| ฟังก์ชัน | SECURITY DEFINER | search_path |
|----------|-----------------|-------------|
| `is_store_owner` | ใช่ | public, pg_catalog |
| `is_active_store_manager` | ใช่ | public, pg_catalog |
| `is_active_store_member` | ใช่ | public, pg_catalog |
| `prevent_sole_owner_change` | ใช่ | public, pg_catalog |
| `prevent_sole_owner_delete` | ใช่ | public, pg_catalog |
| `audit_store_membership_change` | ใช่ | public, pg_catalog |
| `jsonb_bool` | ไม่ใช่ | public, pg_catalog |
| `validate_store_member_permissions` | ไม่ใช่ | public, pg_catalog |
| `store_memberships_guard_insert` | ไม่ใช่ | public, pg_catalog |
| `store_memberships_guard_update` | ไม่ใช่ | public, pg_catalog |

ทุกฟังก์ชันตรงกับการกำหนดในไฟล์ `010_store_memberships.sql`

### 4.7 สถานะเวอร์ชัน Migration

- **ไม่มีตาราง `supabase.schema_migrations`** ในฐานข้อมูล `kindee` (ค้นหาแล้วไม่พบในสคีมาใด ๆ)
- ดังนั้นจึง **ไม่สามารถยืนยันเวอร์ชัน migration ที่ถูกนำไปใช้** ผ่านระบบติดตามของ Supabase ได้
- อย่างไรก็ตาม วัตถุทั้งหมดที่ migration 010 กำหนดไว้ (ตาราง, ดัชนี, คอนสตรินต์, ทริกเกอร์, นโยบาย RLS, ฟังก์ชัน) มีอยู่ครบถ้วนในฐานข้อมูล lokal แล้ว

---

## 5. ความสัมพันธ์ระหว่าง Local PostgreSQL กับ Supabase Cloud

| ประเด็น | ผลการตรวจสอบ |
|-----------|----------------|
| Container `kindee_pg_test` | เป็น `postgres:15-bookworm` แบบ standalone ไม่ใช่ container ของ Supabase |
| เอกซ์เทนชันสำหรับเชื่อมต่อภายนอก | ไม่มี `dblink` / `postgres_fdw` |
| การเข้าถึง Supabase Project `bzkjtvsqqxnbbnkgcrko` | ไม่สามารถเชื่อมต่อได้ (จากรายการก่อนหน้า: DNS `db.bzkjtvsqqxnbbnkgcrko.supabase.co:5432` ไม่ resolve จาก sandbox นี้) |
| ข้อมูลใน lokal | `stores` 2 แถว, `profiles` 7 แถว, `store_memberships` 2 แถว เป็นข้อมูลทดสอบ/seed ใน lokal ไม่ได้ซิงก์กับ Supabase Cloud |
| Supabase stack อื่นที่รันอยู่ | พบ stack `line-campaign-manager-new` (แยกต่างหาก, ไม่เกี่ยวกับ kindee) |

**ข้อสรุป:** Local PostgreSQL (`kindee_pg_test`) **ไม่มีความสัมพันธ์การเชื่อมต่อถาวรกับ Supabase Cloud** เป็นฐานข้อมูล isolated ที่ใช้สำหรับทดสอบ migration 010 ใน lokal/staging เท่านั้น ไม่กระทบฐานข้อมูลจริงของ Supabase project `bzkjtvsqqxnbbnkgcrko`

---

## 6. สรุปผล PASS / FAIL / NOT VERIFIED

| รายการตรวจสอบ | ผล | เหตุผล |
|---------------|-----|--------|
| 1. Container `kindee_pg_test` ทำงานอยู่ | **PASS** | สถานะ Running, พอร์ต 55432 เปิดใช้งาน |
| 2. PostgreSQL เวอร์ชันและเอกซ์เทนชัน | **PASS** | PostgreSQL 15.20, มี pgcrypto/plpgsql/uuid-ossp |
| 3. ตาราง `store_memberships` ตาม migration 010 | **PASS** | คอลัมน์, ดัชนี, คอนสตรินต์, FK ครบถ้วนตรงกับ SQL |
| 4. ตาราง `store_membership_audit_log` | **PASS** | โครงสร้างและดัชนีตรงกับไฟล์ SQL |
| 5. RLS เปิดใช้งานบนตารางสมาชิก | **PASS** | `rowsecurity = t` ทั้งสองตาราง |
| 6. นโยบาย RLS ตาม migration 010 | **PASS** | นโยบาย SELECT/INSERT/UPDATE/DELETE ครบถ้วน |
| 7. ทริกเกอร์ตาม migration 010 | **PASS** | ทั้ง 7 ทริกเกอร์มีอยู่และตรงกับไฟล์ SQL |
| 8. ฟังก์ชัน Security Definer ตาม migration 010 | **PASS** | ฟังก์ชันทั้ง 10 ตัวมี flag และ search_path ตรงกับ SQL |
| 9. ติดตามเวอร์ชันผ่าน `schema_migrations` | **NOT VERIFIED** | ไม่มีตาราง `schema_migrations` ในฐานข้อมูล lokal |
| 10. เชื่อมต่อกับ Supabase Cloud | **FAIL (โดยตั้งใจ)** | `kindee_pg_test` เป็น isolated, ไม่ได้เชื่อมต่อ Supabase Cloud |

---

## 7. ข้อปฏิบัติตาม (ข้อห้ามที่ยืนยันแล้ว)

- [x] ไม่ลบ Docker Container `kindee_pg_test`
- [x] ไม่ลบหรือแก้ไข Docker Volume
- [x] ไม่แก้ไขข้อมูลในฐานข้อมูล
- [x] ไม่รัน Migration หรือ Rollback
- [x] ไม่เปิดเผย Credentials, API Keys, หรือ Secrets (รหัสผ่านถูกปกปิดในรายงานนี้)
- [x] ตรวจสอบแบบ Read-only ทั้งหมด (คำสั่ง SELECT / \d / ตารางระบบเท่านั้น)

---

## 8. ข้อเสนอขั้นตอนต่อไป

1. **ยืนยันว่า `kindee_pg_test` ใช้สำหรับทดสอบ lokal/staging เท่านั้น** ไม่ควรนำข้อมูลจาก container นี้ไปถือว่าเป็นสถานะจริงของ Supabase Cloud
2. **หากต้องการยืนยัน Migration 010 กับ Supabase จริง** ต้องใช้เครื่องที่สามารถเชื่อมต่อ `db.bzkjtvsqqxnbbnkgcrko.supabase.co:5432` ได้ (จากรายการก่อนหน้า sandbox นี้ไม่สามารถ resolve DNS ได้) และมี credentials ที่ถูกต้อง โดยทำแบบ Read-only
3. **พิจารณาเพิ่มตาราง `schema_migrations`** หากต้องการติดตามเวอร์ชัน migration บน lokal PostgreSQL (ขณะนี้ไม่มีระบบติดตามเวอร์ชัน)
4. **ดำเนินการตรวจสอบบน Supabase Staging/Production จริง** เฉพาะเมื่อได้รับอนุมัติและมีการเชื่อมต่อที่ปลอดภัยแล้ว

---

**รายงานนี้จัดทำขึ้นเพื่อเป็นบันทึกผลการตรวจสอบ Docker Container `kindee_pg_test` แบบ Read-only ไม่ใช่ผลการตรวจสอบฐานข้อมูล Supabase จริง**
