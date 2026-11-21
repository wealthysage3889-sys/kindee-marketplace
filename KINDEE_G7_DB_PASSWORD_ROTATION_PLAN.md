# KINDEE_G7_DB_PASSWORD_ROTATION_PLAN.md

**โครงการ:** kindee-marketplace  
**เป้าหมาย:** Supabase project `bzkjtvsqqxnbbnkgcrko`  
**ขอบเขต:** เตรียมแผนเท่านั้น — ห้ามเปลี่ยนรหัสผ่านจริง / ห้ามแก้ production secrets / ห้าม execute migration

---

## 1. Secret Dependencies (ไม่แสดงค่า)

| ตัวแปร | แหล่ง | ใช้ใน | หมายเหตุ |
|--------|-------|-------|----------|
| `DATABASE_URL` | backend/.env (local), Vercel (prod/preview/dev) | backend DB connection | ชี้ project `bzkjtvsqqxnbbnkgcrko` (dev ยืนยันแล้ว; prod ปกปิดเป็น [SENSITIVE]) |
| `SUPABASE_URL` | backend/.env, Vercel | backend client | project ref `bzkjtvsqqxnbbnkgcrko` |
| `SUPABASE_SERVICE_ROLE_KEY` | backend/.env, Vercel | backend service role | ไม่หมุนในแผนนี้ (G7 เฉพาะ DB password) |
| `SUPABASE_ANON_KEY` | backend/.env, Vercel | auth flows | ไม่หมุนในแผนนี้ |
| `supabase/.temp/pooler-url` | CLI metadata | pooler endpoint (ไม่มี inline password) | host/user เท่านั้น |
| `supabase/.temp/project-ref` | CLI metadata | project ref | ต้องเป็น `bzkjtvsqqxnbbnkgcrko` เท่านั้น |

**Render:** ต้องตรวจ `DATABASE_URL` และ Supabase vars ใน service `kindee-marketplace-api` (ผู้ใช้ต้องตรวจเอง; ไม่มี auto access)  
**Vercel:** Production secrets ปกปิด ([SENSITIVE]) — ต้องอัปเดตผ่าน Dashboard/API ด้วย token ที่มีสิทธิ์  
**Local:** `backend/.env` (gitignored) — อัปเดตด้วย script ที่ไม่ echo ค่า

---

## 2. ขั้นตอน DB Password Rotation (รออนุมัติ)

1. **Pre-check (read-only):**
   - ยืนยัน project ref = `bzkjtvsqqxnbbnkgcrko` (`.temp/project-ref`, pooler-url)
   - ตรวจ `.temp` ไม่ชี้ `henhkouetfjelkqsfzgu`
   - บันทึก backup ปัจจุบัน (full dump + SHA256) ก่อน rotate
2. **Rotate (Dashboard):**
   - Supabase Dashboard → Project `bzkjtvsqqxnbbnkgcrko` → Settings → Database → Reset password
   - คัดลอก connection string ใหม่ (pooled + direct) โดย **ไม่ print ลง terminal**
3. **อัปเดต secrets อย่างปลอดภัย:**
   - Local: ใช้ `PGPASSFILE` หรือ env var; แก้ `backend/.env` ด้วย editor ไม่ echo
   - Render: Dashboard → Environment → update `DATABASE_URL`
   - Vercel: Dashboard/API → update Production `DATABASE_URL` (และ Development/Preview ถ้ามี)
   - ห้าม commit ค่า secret; ห้าม print ใน logs/history
4. **Restart services:**
   - Render service restart; Vercel redeploy (หรือ env change triggers redeploy)
5. **Verify connections:**
   - Backend health check; Supabase client queries; migration runner dry-run (read-only)
   - ตรวจ pooler + direct (ถ้า DNS พร้อม)
6. **Cleanup:**
   - ลบ temp files ที่มี credential; ห้ามใช้ `sh -x`/`set -x`
   - หมุน session tokens ถ้าจำเป็น

---

## 3. Impact Analysis

| ระบบ | ผลกระทบ | การบรรเทา |
|------|---------|-----------|
| Backend (Render) | connection string เก่าใช้ไม่ได้ | อัปเดต `DATABASE_URL` + restart |
| Vercel functions | เหมือนกัน | อัปเดต env + redeploy |
| Local dev | connection string เก่าใช้ไม่ได้ | อัปเดต `backend/.env` |
| Supabase CLI | pooler auth | ใช้ password ใหม่เมื่อจำเป็น; หลีกเลี่ยง CLI push |
| Migration execute | ต้องใช้ connection ใหม่ | ทำหลัง rotation + backup |

---

## 4. Rollback / Recovery Plan

1. ถ้า service fail หลัง rotate: ย้อนกลับด้วย password เก่า **เฉพาะถ้า Dashboard ยังอนุญาต** (โดยทั่วไป rotate ไม่สามารถย้อน password เก่าได้ → ต้อง rotate ใหม่อีกครั้ง)
2. Restore จาก backup dump หากข้อมูลเสียหาย (ห้าม restore ในขั้นนี้; เตรียมไว้เท่านั้น)
3. ยืนยัน service ด้วย health check + smoke query (read-only)
4. หาก connection fail: ตรวจ env vars ทั้ง Render/Vercel/local, pooler host, project ref

---

## 5. Connection Verification Checklist (หลัง rotate)

- [ ] Backend health endpoint 200
- [ ] Supabase client `stores` query 200
- [ ] `store_memberships` anon 401/403 (หลัง apply 013)
- [ ] Migration runner ไม่มี error (dry-run/read-only)
- [ ] Render/Vercel logs ไม่มี auth failure
- [ ] `.temp/project-ref` = `bzkjtvsqqxnbbnkgcrko`

---

## 6. G8 — Supabase CLI Metadata

| ไฟล์ | ค่าปัจจุบัน | สถานะ |
|------|-------------|-------|
| `supabase/.temp/project-ref` | `bzkjtvsqqxnbbnkgcrko` | ✅ |
| `supabase/.temp/pooler-url` | `postgres.bzkjtvsqqxnbbnkgcrko@...` | ✅ |
| Forbidden ref `henhkouetfjelkqsfzgu` | ไม่ปรากฏในไฟล์ปัจจุบัน | ✅ |

**คำสั่งตรวจสอบ (read-only, ไม่ echo secrets):**
```
Get-Content supabase/.temp/project-ref
Get-Content supabase/.temp/pooler-url
```
ห้ามใช้ Supabase CLI migration push; ห้าม link ไป project อื่น

---

## 7. จุดที่ต้องอนุมัติ (STOP)

1. อนุมัติ rotate DB password บน Supabase Dashboard
2. อนุมัติอัปเดต secrets ใน Render/Vercel/local (ไม่แสดงค่า)
3. อนุมัติ restart/redeploy services
4. อนุมัติ verify connections (read-only)
5. อนุมัติดำเนินการ migration 011→012→013 หลัง rotation (แยกจากแผนนี้)

**ห้ามดำเนินการจริงจนกว่าผู้ใช้อนุมัติ** — แผนนี้เป็นการเตรียมความพร้อมเท่านั้น

---

**สรุป:** G7 rotation plan พร้อม; secrets ไม่ถูกแสดง; G8 verified ชี้ `bzkjtvsqqxnbbnkgcrko`; หยุดรอผู้ใช้อนุมัติ
