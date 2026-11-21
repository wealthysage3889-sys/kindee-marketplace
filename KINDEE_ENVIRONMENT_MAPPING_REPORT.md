# KINDEE_ENVIRONMENT_MAPPING_REPORT.md

**วันที่สร้าง:** 2026-11-18T14:40:00Z  
**วันที่อัปเดต:** 2026-11-18T14:50:00Z (หลังตรวจสอบจริงผ่าน Vercel CLI)  
**โครงการ:** kindee-marketplace  
**ขอบเขต:** ตรวจสอบเฉพาะอ่านอย่างเดียว (Read-only) ไม่เข้าถึงหน้าจอ Vercel dashboard แก้ไขค่าใด ๆ ไม่แสดง Secrets / API Keys / Passwords  
**Vercel CLI:** v65.17.0, ล็อกอินเป็น `wealthysage3889-2509`, พบโครงการ `kindee-marketplace`

---

## 1. Vercel CLI สิทธิ์เข้าถึงโครงการ Kindee

| รายการ | ผล | หลักฐาน |
|--------|-----|----------|
| Vercel CLI ติดตั้ง | ✅ | `vercel --version` → `65.17.0` |
| Vercel CLI ล็อกอิน | ✅ | `vercel whoami` → `wealthysage3889-2509` |
| โครงการ `kindee-marketplace` พบ | ✅ | `vercel project ls` → โครงการ `kindee-marketplace`, latest production URL `https://kindee-marketplace.vercel.app`, updated `2026-11-18T11:30:40.531Z` |
| Vercel project linked ใน repo | ✅ | `.vercel/project.json` → `projectName: "kindee-marketplace"`, `projectId: "prj_qx2yXC8NieewrTcheJZHOR1n5XSr"` |

**ข้อสรุป:** Vercel CLI มีสิทธิ์เข้าถึงโครงการ Kindee แล้ว สามารถใช้ `vercel env` คำสั่งต่าง ๆ เพื่อตรวจสอบ environment variables ได้

---

## 2. Environment Variables ที่เกี่ยวข้องกับ Supabase (ต่อจากไฟล์ repo + Vercel CLI)

### 2.1 ตัวแปรที่พบในไฟล์ repo (ค่าไม่ได้เปิดเผย)

| ไฟล์ | ตัวแปรที่พบ | โครงการ / Host ที่อ้างถึง | สถานะ |
|------|------------|------------------------|--------|
| `backend/.env` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | **Project Ref `bzkjtvsqqxnbbnkgcrko`** | VERIFIED (ไฟล์มี ref) |
| `backend/.env.example` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Placeholder `your-project-ref.supabase.co` | VERIFIED (template) |
| `backend/.env.test` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `test.supabase.co` | VERIFIED (test placeholder) |
| `supabase/.temp/project-ref` | CLI link metadata | **`henhkouetfjelkqsfzgu`** | VERIFIED (ไฟล์บนดิสก์) |
| `supabase/.temp/linked-project.json` | CLI link metadata | **`henhkouetfjelkqsfzgu`** | VERIFIED (ไฟล์บนดิสก์) |
| `frontend/.env` | `VITE_GOOGLE_CLIENT_ID`, `VITE_API_BASE` | ไม่พบ Supabase project ref/URL | VERIFIED (ไม่มี) |
| `.env.local` (root) | `VERCEL_OIDC_TOKEN` เท่านั้น (คืนค่าแล้ว ไม่มี secrets) | ไม่พบ Supabase project ref/URL | VERIFIED (ไม่มี) |

### 2.2 ตัวแปรจาก Vercel CLI (`vercel env ls`) — ค่าถูกซ่อนเป็น "Hidden"

| ตัวแปร | ประเภท | Environments | หมายเหตุ |
|--------|--------|-------------|----------|
| `DATABASE_URL` | Secret | Production, Preview, Development | มีในทุก environment |
| `SUPABASE_URL` | Secret | Production เท่านั้น | ไม่มีใน Preview / Development |
| `SUPABASE_ANON_KEY` | Secret | Production เท่านั้น | ไม่มีใน Preview / Development |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Production เท่านั้น | ไม่มีใน Preview / Development |
| `VITE_API_BASE` | Config | Production เท่านั้น | ค่าไม่ใช่ secret แสดงเป็น Config |

**ตัวแปร Supabase ที่ระบบใช้งานจริง (backend):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`  
**ตัวแปร Supabase ที่ frontend ใช้:** ไม่พบ `VITE_SUPABASE_*` (frontend เรียกผ่าน backend API ผ่าน `VITE_API_BASE`)

---

## 3. เปรียบเทียบ SUPABASE_URL / DATABASE_URL ระหว่าง Production / Preview / Development

### 3.1 Development (ยืนยันจากการ pull env จริงผ่าน Vercel CLI)

| รายการ | ค่า (แยกเฉพาะ project ref) | สถานะ |
|--------|---------------------------|--------|
| `DATABASE_URL` | `db.bzkjtvsqqxnbbnkgcrko.supabase.co` → **`bzkjtvsqqxnbbnkgcrko`** | ✅ ยืนยันจากไฟล์ `.env.local` หลังรัน `vercel env pull --environment development` |
| `SUPABASE_URL` | ไม่พบใน development env | ไม่มีตัวแปรนี้ใน development environment |

### 3.2 Production (ยืนยันจากการ pull env ผ่าน Vercel CLI)

| รายการ | ค่า | สถานะ |
|--------|-----|--------|
| `DATABASE_URL` | ถูกซ่อนเป็น `[SENSITIVE]` (Vercel CLI ไม่ยอมดึงค่า secret จาก production) | ⚠️ ไม่สามารถยืนยัน project ref จริงจาก CLI ได้ |
| `SUPABASE_URL` | ถูกซ่อนเป็น `[SENSITIVE]` | ⚠️ ไม่สามารถยืนยัน project ref จริงจาก CLI ได้ |
| `SUPABASE_ANON_KEY` | ถูกซ่อนเป็น `[SENSITIVE]` | — |
| `SUPABASE_SERVICE_ROLE_KEY` | ถูกซ่อนเป็น `[SENSITIVE]` | — |

**หมายเหตุ:** รัน `vercel env pull --environment production` แล้ว Vercel CLI แจ้งว่า `12 Secret values cannot be pulled from the production Environment` รวมถึง `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` เขียน `[SENSITIVE]` แทนค่าจริง

### 3.3 Preview (ยืนยันจากการ pull env ผ่าน Vercel CLI)

| รายการ | ค่า | สถานะ |
|--------|-----|--------|
| `DATABASE_URL` | ไม่พบใน preview env | ไม่มีตัวแปรนี้ใน preview environment |
| `SUPABASE_URL` | ไม่พบใน preview env | ไม่มีตัวแปรนี้ใน preview environment |

**หมายเหตุ:** รัน `vercel env pull --environment preview` แล้วพบเฉพาะ system vars ของ Vercel (VERCEL_ENV, VERCEL_URL, ฯลฯ) ไม่มี `DATABASE_URL` หรือ `SUPABASE_URL` แจ้ง `1 Secret value cannot be pulled` (รายละเอียดไม่ระบุว่าเป็นตัวแปรใด)

---

## 4. เปรียบเทียบ Project Reference จาก URL (ไม่แสดง Secrets)

| ตำแหน่ง | Project Ref ที่สังเกตได้ | สภาพแวดล้อม | สถานะ |
|---------|----------------------|-------------|--------|
| `backend/.env` (DATABASE_URL / SUPABASE_URL host) | `bzkjtvsqqxnbbnkgcrko` | Development (local) | ✅ VERIFIED |
| Vercel Development (`vercel env pull --environment development`) | `bzkjtvsqqxnbbnkgcrko` | Development (Vercel) | ✅ VERIFIED |
| Vercel Production | ไม่สามารถยืนยันได้ (ค่าถูกซ่อนเป็น secret) | Production | ⚠️ BLOCKED |
| Vercel Preview | ไม่พบ `DATABASE_URL` / `SUPABASE_URL` | Preview | ⚠️ ไม่มีตัวแปร Supabase |
| `supabase/.temp/project-ref` | `henhkouetfjelkqsfzgu` | CLI-linked (local metadata) | ✅ VERIFIED แต่ **ต่างจาก backend/.env** |
| `backend/.env.test` | ไม่พบ (ใช้ `test.supabase.co`) | Test | VERIFIED (test placeholder) |

**ข้อควรระวัง:** `backend/.env` (Development) กับ `supabase/.temp` (CLI-linked) **อ้างถึงโครงการ Supabase คนละตัวกัน** (`bzkjtvsqqxnbbnkgcrko` vs `henhkouetfjelkqsfzgu`) หากรันคำสั่ง Supabase CLI โดยไม่ระบุ project ref อาจกระทำกับโครงการผิด

**ข้อสรุป:** โครงการเป้าหมายสำหรับตรวจสอบ Migration 010 คือ **`bzkjtvsqqxnbbnkgcrko`** (ยืนยันจากทั้ง `backend/.env` และ Vercel Development env)

---

## 5. Production ชี้ไป `bzkjtvsqqxnbbnkgcrko` หรือไม่

**ไม่สามารถยืนยันได้จาก Vercel CLI โดยตรง** เนื่องจาก `DATABASE_URL` และ `SUPABASE_URL` ใน Production เป็น secrets ที่ Vercel CLI ปกปิดค่าไว้ (`[SENSITIVE]`)

**ข้อมูลที่พบโดยอ้อม:**
- Vercel Development `DATABASE_URL` ชี้ไปที่ `bzkjtvsqqxnbbnkgcrko` (ยืนยันแล้ว)
- `backend/.env` (local development) ชี้ไปที่ `bzkjtvsqqxnbbnkgcrko` (ยืนยันแล้ว)
- Production Vercel project URL คือ `https://kindee-marketplace.vercel.app` แต่ไม่ทราบว่า backend server (Render) ใช้ Supabase project ใด

**ข้อเสนอ:** ต้องเข้าสู่หน้าจอ Vercel dashboard (หรือใช้ Vercel API ด้วย token ที่มีสิทธิ์อ่าน secrets) เพื่อยืนยันค่า `SUPABASE_URL` / `DATABASE_URL` จริงของ Production

---

## 6. DNS และการเชื่อมต่อ Supabase จากเครื่อง Local

| การทดสอบ | ผล | รายละเอียด |
|----------|-----|------------|
| `Test-NetConnection db.bzkjtvsqqxnbbnkgcrko.supabase.co:5432` | ❌ ล้มเหลว | DNS resolve ไม่สำเร็จ, PingSucceeded = False |
| `Test-NetConnection bzkjtvsqqxnbbnkgcrko.supabase.co:443` | ✅ สำเร็จ | RemoteAddress `104.18.38.10`, TcpTestSucceeded = True |

**ข้อสรุป:** HTTPS endpoint ของ Supabase project เข้าถึงได้จากเครื่องนี้ แต่ **พอร์ตฐานข้อมูล 5432 ไม่ resolve DNS** จึงไม่สามารถเชื่อมต่อ PostgreSQL โดยตรงจาก sandbox นี้ได้

---

## 7. ตรวจสอบ Migration 010 แบบ Read-only

**ไม่สามารถดำเนินการได้ในขณะนี้** เนื่องจาก:
- ไม่สามารถเชื่อมต่อฐานข้อมูล Supabase จริง (port 5432 DNS ไม่ resolve จากเครื่องนี้)
- Vercel CLI ปกปิดค่า `DATABASE_URL` / `SUPABASE_URL` ของ Production (เป็น secrets)
- ไม่มี Staging Project ที่ยืนยันแล้วว่าแยกจาก Production

**เมื่อใดที่สามารถเชื่อมต่อ DB จริงได้** (ผ่านเครื่องที่มีเครือข่ายออกสู่ Supabase cloud หรือมี credentials ที่ถูกต้อง) ให้รันคำสั่งตรวจสอบต่อไปนี้ (อ่านอย่างเดียว ไม่แก้ไขข้อมูล):

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

## 8. Environment ที่ปลอดภัยสำหรับการตรวจสอบแบบ Read-only

| Environment | ปลอดภัยสำหรับ Read-only หรือไม่ | เหตุผล |
|-------------|----------------------------------|--------|
| Development (`bzkjtvsqqxnbbnkgcrko`) | **มีความเสี่ยง** | เป็นโครงการที่แอปใช้งานจริง การอ่าน catalog (SELECT) ปลอดภัย แต่หากเผลอรัน migration/rollback อาจกระทบระบบจริง |
| Test (`test.supabase.co`) | **ปลอดภัยกว่า** | ใช้ host placeholder สำหรับทดสอบ locally แต่ไม่ใช่ Supabase project จริงที่ provisioned ไว้ |
| CLI-linked (`henhkouetfjelkqsfzgu`) | **ไม่แนะนำ** | อ้างถึงโครงการต่างจาก backend/.env อาจสับสน และไม่รู้ว่าเป็น production หรือไม่ |
| Staging (แยกต่างหาก) | **ไม่พบหลักฐาน** | ไม่มีไฟล์ config หรือ project ref ที่ยืนยันว่าเป็น staging แยกจาก production |

---

## 9. ข้อเสนอขั้นตอนต่อไป (ก่อนตรวจสอบ Migration 010)

1. **ยืนยัน Project Ref เป้าหมาย:** ใช้ `bzkjtvsqqxnbbnkgcrko` (จาก `backend/.env` และ Vercel Development env) เป็นโครงการที่ระบบใช้งานจริง **ไม่ใช่** `henhkouetfjelkqsfzgu`
2. **ยืนยันค่า SUPABASE_URL / DATABASE_URL ของ Production:** เข้าสู่ Vercel dashboard หรือใช้ Vercel API ด้วย token ที่มีสิทธิ์อ่าน secrets เพื่อยืนยันว่า production ใช้ project ref `bzkjtvsqqxnbbnkgcrko` หรือไม่
3. **ยืนยันว่ามี Staging Project แยกต่างหากหรือไม่:** หากไม่มี ให้ใช้ Supabase Local (Docker) หรือโครงการทดสอบที่แยกต่างหากสำหรับตรวจสอบ migration ก่อนลง production
4. **เตรียมเครื่องที่เชื่อมต่อ Supabase cloud ได้:** เนื่องจาก sandbox นี้ไม่สามารถ resolve DNS ของ `db.bzkjtvsqqxnbbnkgcrko.supabase.co:5432` ได้ จึงต้องใช้เครื่องอื่นที่มีเครือข่ายออกสู่ internet ได้
5. **เมื่อมีการเชื่อมต่อ DB จริงแล้ว:** รันคำสั่งตรวจสอบ schema_migrations, RLS, policies, triggers, functions, privileges, audit log ภายใน transaction และสำรองข้อมูลก่อนการเปลี่ยนแปลงที่มีความเสี่ยง

---

## 10. ข้อปฏิบัติตาม (ข้อห้ามที่ยืนยันแล้ว)

- [x] ไม่แก้ไข Environment Variables ใด ๆ (`.env.local` คืนค่าแล้ว ไม่มี secrets คงเหลือ)
- [x] ไม่แสดง API Keys, Passwords, หรือ Secrets (ค่า Vercel env ถูกซ่อนเป็น `[SENSITIVE]` / `Hidden`)
- [x] ไม่รัน Migration หรือ Rollback
- [x] ไม่แก้ไขข้อมูลจริงในฐานข้อมูล
- [x] ไม่สมมติว่า Preview คือ Staging (Preview ไม่มี `DATABASE_URL` / `SUPABASE_URL` แม้แต่ตัวแปรเดียว)
- [x] ไม่สร้าง Supabase Staging Project ใหม่

---

**รายงานนี้จัดทำขึ้นเพื่อเป็นแนวทางการตรวจสอบสภาพแวดล้อมเท่านั้น ไม่ใช่ผลการตรวจสอบฐานข้อมูลจริง** เนื่องจากไม่สามารถเชื่อมต่อ Supabase project จริงได้จากสภาพแวดล้อมปัจจุบัน (port 5432 DNS ไม่ resolve)
