# KINDEE_G7_OWNER_ACTION_HANDOFF.md

**โครงการ:** kindee-marketplace  
**เป้าหมาย:** Supabase project `bzkjtvsqqxnbbnkgcrko`  
**สถานะ:** หยุดรอเจ้าของโปรเจกต์ดำเนินการ Reset DB Password

---

## 1. Project Identity (ยืนยัน)

- `supabase/.temp/project-ref` = `bzkjtvsqqxnbbnkgcrko` ✅
- `supabase/.temp/pooler-url` = `postgres.bzkjtvsqqxnbbnkgcrko@...` ✅
- ห้ามเชื่อมต่อ project อื่น (`henhkouetfjelkqsfzgu` ต้องไม่ปรากฏ)

---

## 2. DATABASE_URL Dependencies

| แหล่ง | ตัวแปร | วิธีอัปเดต (ไม่แสดง secret) |
|-------|--------|------------------------------|
| Local `backend/.env` | DATABASE_URL | แก้ไขด้วย editor/PGPASSFILE; ห้าม echo |
| Render `kindee-marketplace-api` | DATABASE_URL | Dashboard → Environment → update |
| Vercel Production | DATABASE_URL | Dashboard/API → update (secrets ปกปิด) |
| Vercel Development | DATABASE_URL | Dashboard/API → update |

---

## 3. Safe Update Procedure (หลัง owner reset)

1. Owner reset password ใน Supabase Dashboard (project `bzkjtvsqqxnbbnkgcrko`)
2. คัดลอก connection string ใหม่โดย **ไม่ส่งในแชต** และไม่บันทึกลง Git
3. อัปเดต Render → Vercel Production → Vercel Development → Local (ตามลำดับ)
4. Restart Render + Redeploy Vercel
5. Verify connections (read-only):
   - Backend health endpoint
   - Supabase client query (`stores`)
   - API smoke tests (read-only)
   - ตรวจ logs ไม่มี auth/connection error
6. ยืนยัน project ref ทุก environment = `bzkjtvsqqxnbbnkgcrko`

---

## 4. Checklist (บันทึก PASS/FAIL)

- [ ] Owner reset password สำเร็จ (owner ยืนยัน)
- [ ] Render DATABASE_URL อัปเดต
- [ ] Vercel Production DATABASE_URL อัปเดต
- [ ] Vercel Development DATABASE_URL อัปเดต
- [ ] Local backend/.env อัปเดต (ไม่ echo)
- [ ] Render restarted
- [ ] Vercel redeployed
- [ ] Backend health 200
- [ ] Supabase client query 200
- [ ] API smoke (read-only) PASS
- [ ] Logs ไม่มี auth/connection error
- [ ] Project ref ทุก environment = `bzkjtvsqqxnbbnkgcrko`

---

## 5. Owner Action Required

**หยุดรอเจ้าของโปรเจกต์ Reset Database Password ใน Supabase Dashboard**

- ห้ามขอให้ผู้ใช้ส่งรหัสผ่านในแชต
- ห้ามบันทึกรหัสผ่านลงไฟล์หรือ Git
- ห้ามแสดง connection string
- ห้ามแก้ production secrets ก่อน owner ดำเนินการ reset และยืนยัน

เมื่อ owner แจ้งว่า Reset สำเร็จ → ดำเนินการอัปเดต secrets ผ่านช่องทางปลอดภัย + ตรวจสอบการเชื่อมต่อ

---

## ข้อห้าม (ยังคงมีผล)

- ห้าม Execute Migration 011–013
- ห้ามเปลี่ยน Schema หรือ Production data
- ห้าม Reset Database
- ห้ามเปลี่ยน Service Role Key หรือ Anon Key

**หยุดรอเจ้าของโปรเจกต์ — ไม่ดำเนินการต่อจนกว่าได้รับการยืนยัน**
