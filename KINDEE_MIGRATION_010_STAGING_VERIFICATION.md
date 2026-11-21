# KINDEE_MIGRATION_010_STAGING_VERIFICATION.md

**วันที่สร้าง:** 2026-11-18  
**วันที่อัปเดตล่าสุด:** 2026-11-18T14:55:00Z  
**โครงการ:** kindee-marketplace  
**ขอบเขต:** ตรวจสอบ Migration 010 (`supabase/migrations/010_store_memberships.sql`) แบบ Read-only บน Supabase Project ที่ Kindee ใช้งานจริง  
**ข้อจำกัด:** ไม่สร้าง Supabase Staging Project ใหม่, ไม่แก้ไขฐานข้อมูล, ไม่รัน Migration หรือ Rollback จนกว่าจะได้รับอนุมัติ

---

## 1. ยืนยัน Production Supabase Project Reference

| รายการ | สถานะ | หลักฐาน |
|--------|-------|----------|
| Project Ref จาก `backend/.env` | ✅ VERIFIED | `DATABASE_URL=postgresql://postgres:****@db.bzkjtvsqqxnbbnkgcrko.supabase.co:5432/postgres` → **`bzkjtvsqqxnbbnkgcrko`** |
| Project Ref จาก Vercel Development env | ✅ VERIFIED | `vercel env pull --environment development` → `DATABASE_URL` ชี้ไปที่ `db.bzkjtvsqqxnbbnkgcrko.supabase.co` → **`bzkjtvsqqxnbbnkgcrko`** |
| Project Ref จาก Vercel Production env | ⚠️ NOT CONFIRMED | Vercel CLI ปกปิดค่า secrets (`DATABASE_URL`, `SUPABASE_URL`) เป็น `[SENSITIVE]` ไม่สามารถอ่านค่าจริงได้จาก CLI |
| Project Ref จาก Vercel Preview env | ⚠️ NOT APPLICABLE | Preview environment ไม่มี `DATABASE_URL` หรือ `SUPABASE_URL` |

**ข้อสรุป:** ยืนยันได้จาก `backend/.env` และ Vercel Development env ว่าระบบใช้ `bzkjtvsqqxnbbnkgcrko` แต่ **ยังไม่ได้รับการยืนยันว่า Production ชี้ไปที่ `bzkjtvsqqxnbbnkgcrko` จริงหรือไม่** (ต้องเข้าดูใน Vercel dashboard หรือใช้ Vercel API ที่มีสิทธิ์อ่าน secrets)

**ข้อควรระวัง:** `supabase/.temp` (CLI-linked metadata) อ้างถึง `henhkouetfjelkqsfzgu` ซึ่ง **ต่างจาก** `bzkjtvsqqxnbbnkgcrko` ห้ามสับสนระหว่างโครงการทั้งสอง

---

## 2. ตรวจสอบการเชื่อมต่อ PostgreSQL จากเครื่อง Local

| การทดสอบ | ผล | รายละเอียด |
|----------|-----|------------|
| DNS resolve `db.bzkjtvsqqxnbbnkgcrko.supabase.co` | ❌ ล้มเหลว | `Test-NetConnection` RemoteAddress ว่างเปล่า, PingSucceeded = False |
| DNS resolve `bzkjtvsqqxnbbnkgcrko.supabase.co` | ✅ สำเร็จ | RemoteAddress `104.18.38.10` |
| TCP port 443 (HTTPS) | ✅ สำเร็จ | TcpTestSucceeded = True |
| TCP port 5432 (PostgreSQL) | ❌ ไม่สามารถทดสอบได้ | ホ스트 `db.bzkjtvsqqxnbbnkgcrko.supabase.co` ไม่ resolve DNS จึงเชื่อมต่อ port 5432 ไม่ได้ |
| Supabase Connection Pooler | ❌ ไม่สามารถทดสอบได้ | ต้องใช้ hostname ของ pooler (เช่น `db.bzkjtvsqqxnbbnkgcrko.pooler.supabase.co`) ซึ่งยังไม่ได้รับการยืนยัน |

**ข้อสรุป:** เครื่อง Local (sandbox นี้) **ไม่สามารถเชื่อมต่อ PostgreSQL ของ Supabase project `bzkjtvsqqxnbbnkgcrko` ได้** เนื่องจาก DNS ของ host database (`db.*.supabase.co`) ไม่ resolve จากสภาพแวดล้อมนี้ HTTPS port 443 ต่อถึง project host ได้ แต่ไม่เพียงพอสำหรับการเชื่อมต่อฐานข้อมูล

---

## 3. ตรวจ DNS, IPv4/IPv6 และ Supabase Connection Pooler

| รายการ | ผล | หมายเหตุ |
|--------|-----|----------|
| IPv4 resolve `db.bzkjtvsqqxnbbnkgcrko.supabase.co` | ❌ ไม่พบบันทึก DNS ที่มองเห็นได้จาก sandbox นี้ | อาจถูกบล็อกโดยเครือข่ายหรือ DNS ภายในองค์กร |
| IPv6 resolve | ❌ ไม่สามารถทดสอบได้ | 同上 |
| Supabase Connection Pooler hostname | ❌ ยังไม่ระบุ | ต้องยืนยันจาก Supabase dashboard หรือ connection string ที่ถูกต้อง |
| Connection string | ⚠️ ห้ามเปลี่ยนเอง | ตามข้อกำหนด "ห้ามเปลี่ยน Connection String เอง" |

---

## 4. ตรวจ Migration 010 แบบ Read-only (เมื่อเชื่อมต่อได้)

**สถานะปัจจุบัน:** ❌ **ยังไม่สามารถดำเนินการได้** เนื่องจากไม่มีการเชื่อมต่อฐานข้อมูลจริง

เมื่อเชื่อมต่อฐานข้อมูลจริงได้แล้ว ให้รันคำสั่งตรวจสอบต่อไปนี้ (อ่านอย่างเดียว ไม่แก้ไขข้อมูล):

```sql
-- 1. สถานะ migration 010
SELECT version, name, executed_at FROM supabase.schema_migrations WHERE version = '010';

-- 2. RLS สถานะ
SELECT table_name, rowsecurity, forcerowlevelsecurity FROM pg_tables WHERE schemaname='public' AND table_name IN ('store_memberships','store_membership_audit_log');

-- 3. Policies
SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('store_memberships','store_membership_audit_log','conversations');

-- 4. Triggers
SELECT trigger_name, event_manipulation, action_timing FROM information_schema.triggers WHERE event_object_schema='public' AND event_object_table='store_memberships';

-- 5. Functions (010)
SELECT routine_name, security_definer FROM information_schema.routines WHERE routine_schema='public' AND (routine_name LIKE '%store_membership%' OR routine_name LIKE '%sole_owner%' OR routine_name LIKE '%audit_store%');

-- 6. Privileges ตาราง
SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('store_memberships','store_membership_audit_log');

-- 7. Privileges ฟังก์ชัน
SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_schema='public' AND (routine_name LIKE '%store_membership%' OR routine_name LIKE '%sole_owner%' OR routine_name LIKE '%audit_store%');

-- 8. จำนวนแถว (อ่านอย่างเดียว)
SELECT 'store_memberships' AS t, count(*) FROM store_memberships UNION ALL SELECT 'store_membership_audit_log', count(*) FROM store_membership_audit_log;
```

---

## 5. สรุปผล PASS / FAIL / NOT VERIFIED

| รายการตรวจสอบ | ผล | เหตุผล |
|---------------|-----|--------|
| 1. ยืนยัน Production Supabase Project Ref | **NOT VERIFIED** | Vercel CLI ปกปิดค่า secrets ของ Production ต้องยืนยันจาก dashboard |
| 2. ตรวจสอบการเชื่อมต่อ PostgreSQL จาก Local | **FAIL** | DNS `db.bzkjtvsqqxnbbnkgcrko.supabase.co` ไม่ resolve จาก sandbox นี้ |
| 3. ตรวจ DNS / IPv4 / IPv6 / Connection Pooler | **NOT VERIFIED** | ไม่สามารถ resolve database host ได้ |
| 4. ตรวจ Migration 010 แบบ Read-only | **NOT VERIFIED** | ไม่มีการเชื่อมต่อฐานข้อมูลจริง |
| 5. รัน Migration หรือ Rollback | **ไม่ได้ดำเนินการ** | ตามข้อกำหนด "ห้ามแก้ไขหรือ Migration ซ้ำจนกว่าจะได้รับอนุมัติ" |

**ผลรวม:** **NOT VERIFIED** (ไม่สามารถยืนยันสถานะ Migration 010 บนฐานข้อมูลจริงได้ในขณะนี้)

---

## 6. ข้อเสนอขั้นตอนต่อไป

1. **ยืนยัน Production Supabase Project Reference:** เข้าสู่หน้าจอ Vercel dashboard ของโครงการ `kindee-marketplace` ตรวจค่า `SUPABASE_URL` และ `DATABASE_URL` ของ environment Production ยืนยันว่า host ชี้ไปที่ `db.bzkjtvsqqxnbbnkgcrko.supabase.co` (project `bzkjtvsqqxnbbnkgcrko`) หรือไม่
2. **ใช้เครื่องที่เชื่อมต่อ internet ได้:** เนื่องจาก sandbox นี้ไม่สามารถ resolve DNS ของ database host ได้ ต้องใช้เครื่องอื่นที่มีเครือข่ายออกสู่ Supabase cloud เพื่อเชื่อมต่อ PostgreSQL
3. **เมื่อเชื่อมต่อ DB จริงได้แล้ว:** รันคำสั่งตรวจสอบ Migration 010 แบบ Read-only ตามที่ระบุไว้ในหัวข้อ 4
4. **สำรองข้อมูลก่อนการเปลี่ยนแปลงที่มีความเสี่ยง:** หากพบข้อผิดพลาดและต้องแก้ไข ให้สำรองข้อมูล (pg_dump / Supabase backup) และทำงานภายใน transaction
5. **ห้ามรัน Migration หรือ Rollback จนกว่าจะได้รับอนุมัติ:** ตามข้อกำหนดของผู้ใช้งาน

---

## 7. ข้อปฏิบัติตาม (ข้อห้ามที่ยืนยันแล้ว)

- [x] ไม่สร้าง Supabase Staging Project ใหม่
- [x] ไม่แยก Project เพื่อทดลอง
- [x] ไม่แก้ไข Connection String เอง
- [x] ไม่แก้ไขหรือ Migration ซ้ำจนกว่าจะได้รับอนุมัติ
- [x] ไม่รัน Migration หรือ Rollback
- [x] ไม่แก้ไขข้อมูลจริงในฐานข้อมูล
- [x] ไม่เปิดเผย Secrets / API Keys / Passwords
- [x] ไม่เปลี่ยนข้อมูลสมาชิก ร้านค้า และสินค้าโดยไม่จำเป็น

---

**รายงานนี้จัดทำขึ้นเพื่อเป็นแนวทางการตรวจสอบ Migration 010 เท่านั้น ไม่ใช่ผลการตรวจสอบฐานข้อมูลจริง** เนื่องจากยังไม่ได้รับการยืนยัน Production project reference และไม่สามารถเชื่อมต่อฐานข้อมูลจริงจากสภาพแวดล้อมปัจจุบันได้
