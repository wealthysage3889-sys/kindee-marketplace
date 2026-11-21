# KINDEE_MIGRATIONS_011_013_CLOUD_PREDEPLOY_REPORT.md

**วันที่:** 2026-11-18  
**โครงการ:** kindee-marketplace  
**เป้าหมาย:** Supabase Cloud project `bzkjtvsqqxnbbnkgcrko` (kindee, Tokyo, PG17.11)  
**ขอบเขต:** Read-only inspection เท่านั้น — ห้าม execute migration / ห้ามแก้ schema / ห้ามแก้ข้อมูล Cloud

---

## 0. สรุปผู้บริหาร

| รายการ | ผล |
|--------|-----|
| Project identity (G8) | ✅ `.temp/project-ref` = `bzkjtvsqqxnbbnkgcrko`, pooler-url ชี้ project เดียวกัน |
| Cloud baseline (013 readiness) | ✅ N1/N2/N3 PASS — 013 ยังไม่ถูก apply (anon EXECUTE 10/10, policy `{public}`) |
| Migration readiness 011/012/013 | ✅ ทุกไฟล์ idempotent, transactional, PG17-compatible |
| G7 DB password rotation | ⚠️ ยังไม่หมุน (มี incident credential exposure ใน log) — ต้องอนุมัติ |
| Backup & rollback | ✅ แผนพร้อม, rollback 011/012/013 ทดสอบบนสำเนา lokal แล้ว |
| คำแนะนำ | **NO-GO จนกว่า G7 หมุนรหัสผ่าน และได้รับอนุมัติจากผู้ใช้** |

---

## 1. Cloud Schema Drift (เปรียบเทียบ Cloud vs Local)

| ด้าน | Cloud (PG17.11) | Local (PG15.20) | ความต่าง | ผลกระทบ |
|------|-----------------|-----------------|-----------|---------|
| Version | 17.11 | 15.20 | ต่าง (major) |  syntax/privilege semantics (MAINTAIN) ต้องตรวจเมทริกซ์ PG17 |
| 010 objects | มีครบ (RLS=t, force=f, trigger 5/5 O, SECURITY DEFINER 10/10 search_path pin) | มีครบ (หลัง apply) | ไม่ต่าง | 013 preconditions ผ่าน |
| 010 privileges | anon EXECUTE 10/10, policy `{public}`, ACL `arwdDxtm` (รวม TRUNCATE/TRIGGER/MAINTAIN) | anon EXECUTE 0/10 หลัง apply, policy `{authenticated}`, ACL `arwd` | **ต่าง (013 ยังไม่ apply บน Cloud)** | ต้อง apply 013 ใน transaction เดียว |
| `authenticator` | ไม่มี direct privilege (N1 PASS) | N/A (local ไม่มี role) | ไม่เทียบได้ | ไม่กระทบ |
| `test_*` policies | 0 แถว (N2 PASS) | มี artifact `test_conversations_read` | ต่าง (local artifact) | ไม่กระทบ production |
| `schema_migrations` ledger | ไม่มี (M1 NOT VERIFIED) | ไม่มี | เหมือนกัน | ไม่สามารถยืนยันประวัติ apply 010 ผ่าน CLI |
| 011/012 objects | ต้องตรวจ catalog บน Cloud (ไม่ได้รันในรอบนี้) | มีครบ (customer_id, FK, index, trigger, function) | NOT VERIFIED | ต้องยืนยันก่อน execute 011→012→013 บน Cloud |

**สรุป drift:** ความต่างหลักคือ (ก) 013 ยังไม่ apply บน Cloud (anon privileges/policy `{public}`), (ข) PG17 vs PG15, (ค) ACL ของ Cloud มี privilege เพิ่ม (TRUNCATE/TRIGGER/MAINTAIN) ที่ 013 จะถอนให้, (ง) ไม่มี CLI migration ledger.

---

## 2. Migration Readiness

| Migration | Idempotent | Transactional | PG17 OK | ผลกระทบ |
|-----------|-----------|---------------|---------|---------|
| 011 `conversation_customer_id` | ✅ (DO guard, IF NOT EXISTS) | ✅ (BEGIN/COMMIT) | ✅ | Chat (store_customer merge), customer_id FK profiles |
| 012 `update_store_order_status_with_reason` | ✅ (CREATE OR REPLACE, DROP IF EXISTS) | ✅ | ✅ | Store orders, order_status_history, stock fulfill/release |
| 013 `harden_migration_010_privileges` (Part A) | ✅ (REVOKE/GRANT idempotent, DROP/CREATE POLICY) | ✅ (BEGIN/COMMIT) | ✅ (REVOKE ALL ครอบ MAINTAIN) | Owner/Manager/Staff/Customer RLS, anon deny |

**ลำดับ execute:** 011 → 012 → 013 (ตาม dependency: 013 preconditions ต้องการ 010 objects; 011/012 ไม่พึ่ง 013)  
**Preconditions:** 010 ต้องถูก apply แล้วบน Cloud (N1/N2 PASS ยืนยัน objects มีอยู่)  
**Idempotency:** ทุกไฟล์เขียนแบบ guard/idempotent — รันซ้ำปลอดภัย  
**transaction behavior:** ทั้ง 3 ไฟล์หุ้มด้วย BEGIN/COMMIT, ON_ERROR_STOP=1  
**ผลกระทบ Chat/Voice/Store/สมาชิก:** 011 รวม conversation ซ้ำ (merge archive); 012 เพิ่ม reason ใน history + stock; 013 ปิด anon access (ไม่มี client anon เรียก RPC เหล่านี้ — ยืนยัน N3) — ไม่มีผลกระทบต่อ user flow

---

## 3. G7 — Database Password

| รายการ | สถานะ |
|--------|-------|
| Incident credential exposure (trace log) | ⚠️ เกิดขึ้น (รหัสผ่านอยู่ใน log session) |
| Rotation แล้วหรือไม่ | ❌ **ยังไม่หมุน** |
| Render/Vercel secret dependencies | ต้องอัปเดต `.env` backend หลัง rotate; ตรวจ secret ที่เกี่ยวข้องก่อน deploy |
| Secrets ในรายงาน | ไม่มี (ห้ามแสดง/บันทึก) |

**แผน (รออนุมัติ):**
1. Rotate password ผ่าน Supabase Dashboard (Settings → Database → Reset password) สำหรับ project `bzkjtvsqqxnbbnkgcrko`
2. อัปเดต connection string ใน backend env (Render/Vercel) ผ่าน secret manager — ไม่ commit
3. ลบ temp files ที่มี credential แล้ว (ยืนยันแล้ว)
4. ห้ามใช้ `sh -x` กับคำสั่งที่มี credential; ใช้ PGPASSFILE/env var
5. ยืนยัน service ยังเชื่อมต่อได้หลัง rotate

**สถานะ: หยุดรออนุมัติ — ไม่ rotate ในขั้นนี้**

---

## 4. G8 — Project Identity

| รายการ | ผล |
|--------|-----|
| Project ref ที่ใช้ | `bzkjtvsqqxnbbnkgcrko` ✅ |
| `.temp/project-ref` | `bzkjtvsqqxnbbnkgcrko` ✅ |
| `.temp/pooler-url` | `postgres.bzkjtvsqqxnbbnkgcrko@...pooler.supabase.com:5432` ✅ |
| ห้ามเชื่อมต่อ/deploy ไป `henhkouetfjelkqsfzgu` | ✅ ไม่ได้ใช้ |
| ห้ามใช้ Supabase CLI migration push | ✅ ไม่ได้ใช้ |

**หมายเหตุ:** รายงาน 013 readiness เดิมระบุ `.temp` ชี้ผิด project (`henhkouetfjelkqsfzgu`) — ปัจจุบันไฟล์ถูกแก้แล้วชี้ถูก project แล้ว ยืนยันอีกครั้งก่อน deploy

---

## 5. Cloud Backup & Rollback Plan

**Backup (ยังไม่ได้รัน — ต้องอนุมัติก่อน):**
1. Full backup ผ่าน pooler (custom format) + schema-only + data-only (ตารางสำคัญ)
2. บันทึก SHA256 ทุกไฟล์
3. ตรวจ integrity ด้วย `pg_restore --list` (คาดหวัง ≥ entries ตาม baseline)
4. เก็บ backup นอกเครื่อง + ทดสอบ restore บน DB สำเนา (ไม่ใช่ production)

**Rollback (ตาม dependency, ทดสอบบนสำเนา lokal แล้ว):**
| Migration | ขั้น rollback | ผลทดสอบ |
|-----------|--------------|---------|
| 013 | GRANT EXECUTE คืน anon 10 fn, table grant คืน anon, policies → `{public}` | ✅ สำเร็จบนสำเนา |
| 012 | DROP trigger + function `log_store_order_status_change`, `update_store_order_status_with_reason` | ✅ สำเร็จบนสำเนา |
| 011 | drop index `ux_conversations_store_customer`, `idx_conversations_customer_id`, drop constraint `conversation_members_role_check`, drop column `customer_id` | ✅ ขั้น 2–3 สำเร็จ (ขั้น 1 archive no-op เพราะ archive ว่าง) |

**ผลกระทบต่อข้อมูลจริง:** 013 ไม่แตะข้อมูล (4 memberships / 0 audit คงเดิม); rollback 013 ไม่ต้อง restore dump; 011 merge มี archive สำหรับ forensic; 012 เพิ่ม history row เท่านั้น  
**ข้อห้าม:** ห้าม restore หรือแก้ไขข้อมูล Cloud ในขั้นนี้

---

## 6. PASS / FAIL / NOT VERIFIED

### PASS
- G8 project identity ตรง (`bzkjtvsqqxnbbnkgcrko`) ใน `.temp` และ pooler-url
- N1/N2/N3 บน Cloud PASS (authenticator ไม่มี direct priv, ไม่มี test_* policy, PostgREST/Auth ทำงาน)
- Migration files 011/012/013 idempotent + transactional + PG17-compatible
- Backup & rollback plan พร้อม, rollback ทดสอบบนสำเนาแล้ว
- Local execution 011→012→013 PASS ครบ (อ้างอิง local report)

### FAIL
- ไม่มีรายการ FAIL ด้านโครงสร้าง (Cloud baseline ตรงกับที่ 013 คาดหวัง)

### NOT VERIFIED
- M1: ประวัติ apply 010 ผ่าน CLI ledger (ไม่มี schema supabase_migrations)
- M2: Manager/Staff smoke บนข้อมูลจริง (production ไม่มี manager/staff membership)
- M3: API-level smoke ด้วย JWT จริง (ไม่มีบัญชีทดสอบ)
- M4: พฤติกรรมหลัง apply 013 บน Cloud (ห้าม execute)
- Cloud schema drift รายตาราง (Tables/Columns/Types/Constraints/FK/Indexes/Functions/Triggers/RLS/Policies/Grants) ยังไม่ได้ dump/เปรียบเทียบจริง เพราะ read-only ผ่าน pooler ยังไม่รันในรอบนี้ — ต้องรัน catalog query แบบ read-only ก่อน execute

---

## 7. ความเสี่ยงและข้อเสนอแก้ไข

1. **G7 ยังไม่ rotate** (ความเสี่ยง credential exposure) → ต้อง rotate ก่อนอนุมัติ apply
2. **Cloud ACL มี TRUNCATE/TRIGGER/MAINTAIN บน anon** (F-C1) → 013 REVOKE ALL จะถอนให้; ตรวจหลัง apply ด้วยเมทริกซ์ PG17
3. **Default ACL มีเจ้าของ 2 role** (postgres + supabase_admin) → Part B ถ้าทำต้องครอบทั้งสอง (Part B ยังห้ามในขั้นนี้)
4. **ไม่มี CLI migration ledger** → ยืนยันกับผู้ดูแลว่า 010 apply ด้วยวิธีใด หรือใช้ `supabase migration repair`
5. **rollback_011 ขั้น 1 อ้างอิง `last_message_at` ซึ่งไม่มี** → no-op เพราะ archive ว่าง; ขั้น 2–3 ทดสอบสำเร็จ

---

## 8. คำแนะนำ GO / NO-GO

**NO-GO** — จนกว่า:
- G7 หมุนรหัสผ่าน DB สำเร็จและอัปเดต secret Render/Vercel
- ได้รับอนุมัติจากผู้ใช้ให้ execute 011→012→013 บน Cloud
- ยืนยัน cloud schema drift รายตารางด้วย catalog query read-only (M4)
- ตัดสินใจ Part B (อนุมัติแยก) และ T3 smoke test (Manager/Staff)

---

## 9. ขั้นตอนที่ยังต้องได้รับอนุมัติ

1. อนุมัติ rotate DB password (G7)
2. อนุมัติรัน catalog query read-only เพื่อเปรียบเทียบ schema Cloud vs Local (M4)
3. อนุมัติ full backup + integrity check บน Cloud
4. อนุมัติ execute 011 → 012 → 013 บน Cloud (transaction ละไฟล์, ON_ERROR_STOP=1)
5. อนุมัติ T1 (catalog verify) + REST probe หลัง apply
6. อนุมัติ T3 (transactional smoke Manager/Staff) หรือยอมรับ NOT VERIFIED
7. อนุมัติ/ปฏิเสธ Part B (ALTER DEFAULT PRIVILEGES) แยก

**หยุดรอผู้ใช้อนุมัติก่อน Execute Cloud ทุกกรณี** — ไม่ execute, ไม่แก้ schema/ข้อมูล Cloud, ไม่ apply Part B, ไม่เปลี่ยน production secrets ในขั้นนี้

---

**สรุปสุดท้าย:** Cloud พร้อมในเชิงโครงสร้าง (N1–N3 PASS, baseline ตรงกับที่ 013 คาดหวัง, migration files idempotent/transactional) แต่ **NO-GO** จนกว่า G7 rotate password และได้รับอนุมัติจากผู้ใช้; ขั้นนี้เป็น read-only inspection เท่านั้น
