# Kindee Marketplace — Phase 1D: Supabase Auth Proof of Concept Report

**สถานะ:** READ-ONLY AUDIT + ISOLATED POC ONLY — ห้ามแก้ไขโค้ดระบบจริง, ห้ามแก้ `.env`, ห้ามแก้ SQL/Migrations ในโปรเจกต์หลัก, ห้ามเขียนข้อมูลลง Supabase Production, ห้าม commit/push/deploy  
**วันที่:** 2026-11-16  
**อ้างอิง:** `PHASE_1C_AUTH_ARCHITECTURE.md`, `AUTH_AUDIT_REPORT.md`, `AUTH_RECOVERY_PLAN.md`

---

## 1. Environment และการยืนยันว่าไม่ใช้ Production

### 1.1 การตรวจสอบไฟล์ environment (นับจำนวนบรรทัดเท่านั้น ไม่เปิดเผยค่า)

| คีย์ | backend/.env | frontend/.env | หมายเหตุ |
|-----|-------------|---------------|----------|
| `SUPABASE_URL` | 1 (มี) | — | ไม่ทราบว่าเป็น production หรือ staging (ไม่ได้อ่านค่า) |
| `SUPABASE_ANON_KEY` | 1 (มี) | — | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | 1 (มี) | — | 同上 |
| `LINE_CHANNEL_ID` | 0 (ไม่มี) | — | จำเป็นสำหรับ LINE PoC |
| `LINE_CHANNEL_SECRET` | 0 (ไม่มี) | — | จำเป็นสำหรับ LINE PoC |
| `JWT_SECRET` | 1 (มี) | — | Legacy custom transition |
| `VITE_API_BASE` | — | 1 (มี) | |
| `VITE_GOOGLE_CLIENT_ID` | — | 1 (มี) | |

### 1.2 ข้อจำกัดที่พบ

1. **ไม่ทราบว่า Supabase credentials ใน `backend/.env` เป็น production หรือ staging** — เนื่องจากห้ามอ่านค่าจริง (ปกป้อง secrets) จึงไม่สามารถยืนยันได้ว่าเป็นโปรเจกต์แยกต่างหาก
2. **ไม่มี `LINE_CHANNEL_ID` และ `LINE_CHANNEL_SECRET`** ใน `backend/.env` — จำเป็นสำหรับการทดสอบ LINE Login
3. **ห้ามใช้ production credentials สำหรับ PoC** ตามข้อกำหนด Phase 1D ข้อ 7
4. **ห้ามขอ secrets จากผู้ใช้ผ่านแชต** ตามข้อกำหนด Phase 1D ข้อ 1

### 1.3 สรุปสภาพแวดล้อมสำหรับ PoC

| รายการ | สถานะ | เหตุผล |
|--------|-------|--------|
| Staging Supabase project | ❌ ไม่ยืนยัน | มี credentials แต่อ่านค่าไม่ได้ ไม่รู้ว่าเป็น production หรือ staging |
| Staging Supabase URL/Anon Key | ❌ BLOCKED | 同上 |
| Staging Supabase Service Role Key | ❌ BLOCKED | 同上 |
| LINE Login Channel (staging) | ❌ BLOCKED | ไม่มี `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` |
| LINE verify endpoint | ✅ เข้าถึงได้ทางเอกสาร | `https://api.line.me/oauth2/v2.1/verify` (สาธารณะ, ไม่ต้อง credentials) |
| Supabase signInWithPassword | ❌ BLOCKED | ต้องมี staging credentials |
| Supabase refreshSession | ❌ BLOCKED | ต้องมี staging credentials |
| Supabase signOut(global) | ❌ BLOCKED | ต้องมี staging credentials |

**ข้อสรุป:** ไม่สามารถรันการทดสอบจริงกับ Supabase staging ได้ในรอบนี้ เนื่องจากไม่มี staging credentials ที่ยืนยันแล้ว และไม่มี LINE credentials ผู้ใช้ต้องตั้งค่า staging project และ credentials ด้วยตนเองผ่านช่องทางปลอดภัยก่อนจึงจะดำเนินการทดสอบต่อได้

---

## 2. Test Case และขั้นตอนทดสอบ (ออกแบบไว้พร้อมรันเมื่อมี credentials)

### PoC A — LINE Identity → Supabase Session

| ID | Test Case | ขั้นตอนทดสอบ | ผลลัพธ์ที่คาดหวัง |
|----|-----------|--------------|-------------------|
| A-1 | Server-side LINE code exchange | Backend รับ `code` + `redirectUri` → POST `https://api.line.me/oauth2/v2.1/token` ด้วย `client_id`, `client_secret`, `grant_type=authorization_code` | ได้ `{ access_token, id_token }` จาก LINE |
| A-2 | Verify LINE ID Token | POST `https://api.line.me/oauth2/v2.1/verify` ด้วย `id_token` + `client_id` | ได้ payload `{ sub, email, name, picture, iss, aud, exp }` |
| A-3 | Validate issuer/audience/expiration | ตรวจ `iss = https://access.line.me`, `aud = channel_id`, `exp > now` | ผ่านทุกเงื่อนไข |
| A-4 | State validation | Frontend สร้าง state สุ่ม เก็บไว้ → LINE redirect กลับมาพร้อม state → backend เปรียบเทียบ | State ตรงกัน → ดำเนินต่อ; ไม่ตรง → ยกเลิก |
| A-5 | ค้นหา user เดิมโดย line_id | ค้นหา `profiles.line_id` หรือ `user_metadata.line_id` | พบ user เดิม → คืน session เดิม (idempotent) |
| A-6 | สร้าง user ใหม่ถ้ายังไม่มี | `supabaseAdmin.auth.admin.createUser({ email: placeholder, password: randomServerSide, email_confirm, user_metadata })` | สร้าง auth user ใหม่สำเร็จ |
| A-7 | signInWithPassword ด้วยรหัสสุ่มฝั่งเซิร์ฟเวอร์ | `supabase.auth.signInWithPassword({ email, password: randomPassword })` | ได้ Supabase session `{ access_token, refresh_token }` |
| A-8 | ไม่ส่งรหัสผ่านสุ่มให้ frontend | Backend คืนเฉพาะ `accessToken` + `refreshToken` + `profile` | Frontend ไม่ได้รับรหัสผ่านสุ่ม |
| A-9 | ไม่บันทึกรหัสผ่าน/token ลง log | backend ไม่ log `password`, `access_token`, `refresh_token` | log ปราศจาก secrets |
| A-10 | LINE account เดิม login ซ้ำ | login ด้วย line-id เดิมอีกครั้ง | ได้ `auth.users.id` เดิม ไม่สร้าง user ซ้ำ |
| A-11 | LINE account ใหม่ callback ซ้ำ | เรียก callback เดิมซ้ำหลายครั้ง | ไม่สร้าง user ซ้ำ (idempotent) |
| A-12 | ห้าม auto-link ด้วย email เพียงอย่างเดียว | email ซ้ำกับบัญชีเดิมแต่ไม่มีการยืนยัน owner | คืน 409 ต้องยืนยันตัวตนก่อน link |

### PoC B — Placeholder Email vs Nullable Email

| ID | Test Case | แนวทาง A (Placeholder) | แนวทาง B (Nullable) |
|----|-----------|----------------------|---------------------|
| B-1 | Supabase Auth ยอมรับสร้าง user แบบใด | `email = line-{id}@kindee.local` (NOT NULL slot) | `email = NULL`, `phone = +66...` |
| B-2 | UNIQUE constraint | Placeholder ต้องไม่ซ้ำกัน | NULL ซ้ำกันได้หลายแถว (PostgreSQL) |
| B-3 | Email confirmation | Placeemail ไม่สามารถ verify ได้ | บัญชีที่มี email จริง verify ได้ตามปกติ |
| B-4 | Password recovery | ใช้ไม่ได้กับ placeholder | ใช้ได้เฉพาะบัญชีที่มี email จริง |
| B-5 | Social account linking | ใช้ placeholder เป็น email key | ต้องจัดการ email null ใน social login |
| B-6 | ค้นหาสมาชิก / API คาดหวัง email | อาจคืน placeholder ทำให้สับสน | คืน null ต้องจัดการใน frontend |
| B-7 | ความเสี่ยง placeholder | ผู้ใช้อาจเข้าใจผิดว่าเป็นอีเมลจริง | ไม่มี placeholder ให้เข้าใจผิด |

### PoC C — Refresh Token Rotation

| ID | Test Case | ผลลัพธ์ที่คาดหวัง |
|----|-----------|-------------------|
| C-1 | Refresh token ใช้ครั้งเดียว | หลัง refresh เรียบร้อย refresh token เก่าใช้ไม่ได้อีก |
| C-2 | Token เก่าหลัง refresh | Access token เก่าใช้ไม่ได้ (หมดอายุตาม TTL) |
| C-3 | Refresh พร้อมกันจากสองอุปกรณ์ | อุปกรณ์หนึ่งสำเร็จ อีกเครื่องได้ refresh token ใหม่แยกกัน (Supabase จัดการ rotation ต่อ refresh token แต่ละชุด) |
| C-4 | Refresh พร้อมกันจาก request ซ้ำ | Request หนึ่งสำเร็จ อีก request ได้ 401 (refresh token ถูกเพิกถอนแล้ว) |
| C-5 | Token reuse detection | ใช้ refresh token เดิมซ้ำ → 401 |
| C-6 | Network timeout หลัง server refresh สำเร็จ | Client ไม่ได้รับ response → client ยังมี token เก่า → เรียก API ได้จนกว่า access token จะหมดอายุ → ต้อง retry refresh ใหม่ |
| C-7 | ผลต่อ Customer / Seller / Admin | แต่ละ role refresh token แยกกันตาม session ของผู้ใช้คนนั้น |

### PoC D — Global Sign Out

| ID | Test Case | ผลลัพธ์ที่คาดหวัง |
|----|-----------|-------------------|
| D-1 | `signOut({ scope: 'global' })` | Refresh token ของทุก session ถูกเพิกถอน |
| D-2 | Access token เก่าหลัง signOut | Access token เก่ายังใช้ได้จนกว่าจะหมดอายุ (JWT stateless, ไม่สามารถเพิกถอนกลางคันได้) |
| D-3 | Access token เก่าเรียก API ได้ถึงเมื่อใด | จนกว่า access token จะหมดอายุ (~1 ชั่วโมง default) |
| D-4 | API ตรวจ `profiles.is_active` ปฏิเสธบัญชีที่ปิดใช้งาน | หลัง `is_active = false` + `admin.signOut(userId)` → verifyToken คืน 403 ทุก request แม้ access token ยังไม่หมดอายุ (เพราะ middleware ตรวจ is_active ทุก request) |
| D-5 | Admin ระงับบัญชีแล้ว session ทุกอุปกรณ์ | Refresh token ทั้งหมดถูกเพิกถอน → login ใหม่ไม่ได้ → access token เก่าใช้ได้จนหมดอายุ แต่ middleware ตรวจ is_active → 403 |

### PoC E — Account Linking และ Duplicate Prevention

| ID | Test Case | ผลลัพธ์ที่คาดหวัง |
|----|-----------|-------------------|
| E-1 | LINE user เดิม login ซ้ำ | ค้นหาโดย `line_id` → คืน session เดิม |
| E-2 | LINE user ไม่มี email | ใช้ placeholder → สร้างบัญชี → ให้ยืนยันอีเมล/เบอร์ภายหลัง |
| E-3 | LINE user มี email ตรงกับบัญชีเดิม | คืน 409 "อีเมลนี้สมัครไว้แล้ว" ต้อง login ด้วย email ก่อนแล้วค่อย link |
| E-4 | LINE user มี email ไม่ตรงกับบัญชีเดิม | สร้างบัญชีใหม่ (หรือเสนอ link หลังยืนยัน owner) |
| E-5 | เชื่อม LINE กับบัญชี Google/Facebook ที่มีอยู่ | หลังยืนยัน owner → `POST /auth/link-account` → เก็บ provider_id ใน metadata / `identities[]` |
| E-6 | เชื่อมบัญชีที่ไม่ได้เป็นเจ้าของ | ไม่มีการยืนยัน owner → ปฏิเสธ (403/409) |

---

## 3. ผลลัพธ์ PASS / FAIL / BLOCKED / NOT TESTED

เนื่องจากไม่มี staging credentials และไม่มี LINE credentials การทดสอบทั้งหมดจึงยังไม่สามารถรันจริงได้:

| PoC | ID | สถานะ | เหตุผล |
|-----|----|-------|--------|
| A | A-1 ถึง A-12 | **BLOCKED** | ไม่มี LINE_CHANNEL_ID / LINE_CHANNEL_SECRET และไม่ยืนยันว่า Supabase credentials เป็น staging |
| B | B-1 ถึง B-7 | **BLOCKED** | ต้องรันบน staging Supabase project |
| C | C-1 ถึง C-7 | **BLOCKED** | ต้องรันบน staging Supabase project |
| D | D-1 ถึง D-5 | **BLOCKED** | ต้องรันบน staging Supabase project |
| E | E-1 ถึง E-6 | **BLOCKED** | ต้องรันบน staging Supabase project |

**สรุป:** ไม่มี test case ใดทำได้ในรอบนี้ เนื่องจากขาด staging credentials และ LINE credentials

---

## 4. หลักฐานผลการทดสอบโดยปกปิดข้อมูลลับ

ไม่มีหลักฐานการทดสอบจริงในรอบนี้ (BLOCKED ทุก test case) หลักฐานที่มีอยู่เป็นเพียงการอ้างอิงเอกสาร:

- LINE verify endpoint: `https://api.line.me/oauth2/v2.1/verify` (สาธารณะ, dokumentasi LINE Login)
- LINE token endpoint: `https://api.line.me/oauth2/v2.1/token` (สาธารณะ)
- LINE profile endpoint: `https://api.line.me/v2/profile` (สาธารณะ)
- LINE issuer: `https://access.line.me` (จาก LINE Login docs)
- Supabase `createUser` รองรับ `password_hash` parameter (จาก Supabase Admin API docs)
- Supabase `signInWithPassword`, `refreshSession`, `signOut` (จาก supabase-js docs)

ไม่มีการแสดง `access_token`, `refresh_token`, `password`, `LINE user ID`, หรือ secrets ใด ๆ ในรายงานนี้

---

## 5. LINE → Supabase Session: ทำได้จริงหรือไม่ และมีข้อจำกัดอะไร

### 5.1 ทำได้จริง (ผ่าน custom server-side flow)

วิธีที่ออกแบบไว้ใน Phase 1C สามารถทำได้จริง โดยไม่ต้องพึ่งพา Supabase Custom OIDC Provider:

```
LINE code → backend exchange → verify ID token → create Supabase user (รหัสผ่านสุ่มฝั่งเซิร์ฟเวอร์)
→ signInWithPassword → Supabase session tokens → frontend
```

**ข้อจำกัดสำคัญ:**
1. **Supabase Custom OIDC Provider ใช้กับ LINE web login ไม่ได้** เนื่องจาก LINE web-login ใช้ **HS256** (channel secret) ในขณะที่ Supabase Custom OIDC อิง **JWKS/ES256** และ LINE discovery doc ประกาศรองรับแค่ ES256 เท่านั้น (ยืนยันจากเอกสาร LINE และ Supabase PR #2578 ที่ยังไม่ released)
2. **ไม่มี `identities[]` อัตโนมัติสำหรับ LINE** เนื่องจาก LINE ไม่ใช่ Supabase built-in provider ต้องจัดการ `line_id` เองใน `profiles.line_id` + `user_metadata.line_id`
3. **ต้องมี staging LINE Login Channel** พร้อม Callback URL whitelist ก่อนทดสอบจริง
4. **รหัสผ่านสุ่มที่สร้างฝั่งเซิร์ฟเวอร์** ต้องจัดการอย่างระมัดระวัง (ไม่ส่งให้ frontend, ไม่บันทึกลง log)

### 5.2 ข้อจำกัดที่ยังต้องทดลอง (PoC)

- `signInWithPassword` จาก backend ผ่าน anon key คืน session tokens จริงหรือไม่ (ต้องมี staging credentials)
- Placeholder email (`line-{id}@kindee.local`) ไม่ชนกับ UNIQUE constraint บน `profiles.email` เมื่อ LINE users หลายคนมา login (ต้องทดสอบจริง)

---

## 6. Placeholder Email เทียบกับ Nullable Email

| แง่เปรียบเทียบ | แนวทาง A: Placeholder (`line-{id}@kindee.local`) | แนวทาง B: `email` Nullable + CHECK |
|----------------|--------------------------------------------------|------------------------------------|
| ต้องเปลี่ยน migration | ไม่ | ต้อง (`ALTER TABLE ... DROP NOT NULL`, ADD CHECK) |
| Supabase Auth ยอมรับ | ใช่ (email เป็น NOT NULL slot) | ใช่ (email = NULL) |
| UNIQUE constraint | ใช้ได้ แต่ placeholder ต้องไม่ซ้ำ | NULL ซ้ำกันได้หลายแถว (PostgreSQL) |
| Email confirmation | ใช้ไม่ได้กับ placeholder | ใช้ได้กับบัญชีที่มี email จริง |
| Password recovery | ใช้ไม่ได้กับ phone-only | ใช้ได้กับบัญชีที่มี email จริง |
| Social login key | ใช้ placeholder เป็น email key | ต้องจัดการ email null |
| ความเสี่ยง placeholder | ผู้ใช้อาจเข้าใจผิดว่าเป็นอีเมลจริง | ไม่มี placeholder |
| ผลกระทบต่อระบบเดิม | น้อย (email ยัง NOT NULL) | มาก (กระทบทุกตำแหน่งที่อ้างอิง profiles.email) |

**ข้อเสนอแนะ:** ใช้ placeholder เป็นทางเลือกชั่วคราวเพื่อไม่บล็อกการพัฒนา แล้วค่อยย้ายเป็น `email NULLABLE + CHECK (email IS NOT NULL OR phone IS NOT NULL)` หลังทดสอบ staging แล้ว

---

## 7. Refresh Rotation และ Race Condition

### 7.1 พฤติกรรมที่คาดหวัง (จาก Supabase docs)

- `supabase.auth.refreshSession()` จะ rotate refresh token: refresh token เก่าจะถูกเพิกถอน และคืน refresh token ใหม่
- Access token ใหม่จะถูกออกพร้อมกัน

### 7.2 Race Condition ที่อาจเกิดขึ้น

| สถานการณ์ | ผลกระทบ | แนวทางจัดการ |
|-----------|---------|--------------|
| Refresh พร้อมกันจากสอง request เดียวกัน | Request หนึ่งสำเร็จ อีก request ได้ 401 (refresh token ถูกเพิกถอนแล้ว) | ใช้ lock ต่อ user (เช่นใน-memory mutex หรือ Redis lock) เพื่อให้ refresh ครั้งละหนึ่ง request |
| Refresh พร้อมกันจากสองอุปกรณ์ (refresh token ต่างชุดกัน) | แต่ละอุปกรณ์หมุน refresh token ของตัวเองได้อิสระ | ไม่ต้องจัดการพิเศษ (Supabase จัดการต่อ refresh token แต่ละชุด) |
| Network timeout หลัง server refresh สำเร็จแต่ client ไม่ได้รับ response | Client ยังมี token เก่า → เรียก API ได้จนกว่า access token จะหมดอายุ → ต้อง retry refresh ใหม่ | Client เก็บ refresh token ใหม่เมื่อได้รับ response ถ้า timeout ให้ retry refresh อีกครั้ง |
| Refresh token หมดอายุหรือถูกเพิกถอน | ต้อง login ใหม่ทั้งหมด | Client เคลียร์ localStorage redirect ไป `/login` |

---

## 8. Global Sign Out และอายุการใช้งาน access token เก่า

### 8.1 ความแตกต่างระหว่าง refresh token revocation และ access token expiration

| รายการ | Refresh Token | Access Token |
|--------|--------------|--------------|
| การเพิกถอน | `signOut()` / `signOut({scope:'global'})` / `admin.signOut(userId)` เพิกถอนได้ทันที | ไม่สามารถเพิกถอนกลางคันได้ (JWT stateless) |
| อายุการใช้งาน | ~30 วัน (default) | ~1 ชั่วโมง (default) |
| หลังเพิกถอน refresh token | ไสามารถ refresh ใหม่ได้ → ต้อง login ใหม่ | Access token เก่ายังใช้ได้จนกว่าจะหมดอายุ |
| การตรวจสิทธิ์ใน middleware | ไม่ตรวจ refresh token ทุก request (ตรวจเฉพาะตอน refresh) | ตรวจทุก request ผ่าน `verifyToken` → ยังเช็ค `profiles.is_active` ได้ |

### 8.2 ผลต่อบัญชีที่ถูกระงับ (deactivated)

เมื่อ admin ตั้ง `profiles.is_active = false` + `admin.signOut(userId)`:
- Refresh token ทั้งหมดถูกเพิกถอน → ไม่สามารถ refresh access token ใหม่ได้
- Access token เก่ายังใช้ได้จนกว่าจะหมดอายุ (~1 ชั่วโมง)
- แต่ middleware `verifyToken` ตรวจ `profiles.is_active` ทุก request → คืน 403 "Account is deactivated" แม้ access token ยังไม่หมดอายุ
- ผล: บัญชีที่ถูกระงับใช้งานจริงไม่ได้ทันทีผ่าน API ทุก endpoint ที่ผ่าน `verifyToken`

---

## 9. Account Linking และ Duplicate Prevention

### 9.1 แนวทางที่ออกแบบ

| สถานการณ์ | การจัดการ |
|-----------|-----------|
| LINE เดิม login ซ้ำ | ค้นหาโดย `profiles.line_id` → คืน session เดิม (idempotent) |
| LINE ไม่มี email | ใช้ placeholder → สร้างบัญชี → ให้ยืนยันอีเมล/เบอร์ภายหลัง |
| LINE email ซ้ำกับบัญชีเดิม | คืน 409 "อีเมลนี้สมัครไว้แล้ว" ต้อง login ด้วย email ก่อนแล้วค่อย link |
| เชื่อม LINE กับบัญชี Google/Facebook ที่มีอยู่ | หลังยืนยัน owner (รหัสผ่าน/OTP) → `POST /auth/link-account` → เก็บ provider_id |
| เชื่อมบัญชีที่ไม่ใช่เจ้าของ | ไม่มีการยืนยัน owner → ปฏิเสธ (403/409) |

### 9.2 ป้องกัน Account Takeover

- **ห้าม auto-link** โดยใช้อเมลเพียงอย่างเดียว
- ต้องยืนยันเจ้าของบัญชีเดิมก่อน (รหัสผ่าน / OTP ที่ส่งไปยัง email/เบอร์เดิม)
- ตรวจ `email_verified` ของ provider ก่อนยอมรับอีเมลจาก social login

### 9.3 ป้องกัน Duplicate Account

- Unique constraint บน `profiles.email` และ `profiles.phone`
- Unique partial index บน `profiles.line_id` (หลัง migration)
- ตรวจซ้ำก่อนสร้าง user ใหม่ (`SELECT ... WHERE line_id = ?` แล้วค่อย `INSERT`)

---

## 10. Security Risks ที่ยังเหลือ

| Risk | ระดับ | วิธีป้องกัน |
|------|-------|------------|
| Custom JWT + Supabase JWT coexist | สูง | เอา custom JWT ออกจาก middleware และ authService ให้หมด |
| Facebook signInWithIdToken ด้วย Access Token (เสียอยู่แล้ว) | สูง | แก้เป็น Graph API (`debug_token` + `/me`) เหมือน authController เก่า |
| LINE web login HS256 vs Supabase JWKS mismatch | สูง | ไม่ใช้ Supabase Custom OIDC สำหรับ LINE ใช้ custom server-side verify |
| Account Takeover จาก email ซ้ำ | สูง | ห้าม auto-link ใช้อเมลเพียงอย่างเดียว ต้องยืนยัน owner บัญชีเดิมก่อน |
| State parameter ค่าคงที่ (`"line_login"`) → CSRF | กลาง | เปลี่ยนเป็น state สุ่มต่อครั้ง เก็บใน localStorage validate เมื่อ callback |
| Open redirect จาก redirect_uri | กลาง | Hardcode redirect_uri หรือ validate กับ whitelist ใน LINE Developers Console |
| Placeholder email เข้าใจผิดว่าเป็นอีเมลจริง | ต่ำ | ซ่อน placeholder email จาก UI ให้ผู้ใช้ยืนยันอีเมลจริงภายหลัง |
| Password hash migration ล้มเหลว | กลาง | ทดสอบบน staging ก่อน เก็บ MongoDB backup 30 วัน |
| Role escalation (user เปลี่ยน role ตัวเอง) | ต่ำ | RLS บล็อกการอัปเดต role ตัวเอง middleware ตรวจ role |

---

## 11. ข้อเสนอ Architecture ที่ควรเลือกหลัง PoC

**แนะนำ:** **Supabase Auth เป็น Session หลักเพียงระบบเดียว** (รายละเอียดเต็มใน `PHASE_1C_AUTH_ARCHITECTure.md`)

1. ยกเลิก Custom JWT ทั้งหมด (`generateToken`, `generateRefreshToken`, `verifyRefreshToken`, `JWT_SECRET`, fallback ใน middleware)
2. ทุกช่องทาง login คืน Supabase session tokens (access_token + refresh_token)
3. LINE ใช้ custom server-side Authorization Code Flow แลก code → verify ID token ที่ `https://api.line.me/oauth2/v2.1/verify` → สร้าง/ค้นหา Supabase user → `signInWithPassword` ด้วยรหัสผ่านสุ่มฝั่งเซิร์ฟเวอร์ (ไม่ส่งให้ frontend) → คืน session tokens
4. อ่าน role จาก `profiles.role` เท่านั้น ไม่ใช่ Supabase JWT claim
5. แยก Customer / Admin session โดย `localStorage` namespace เดิม
6. รองรับผู้ไม่มี email ด้วย placeholder email ชั่วคราว แล้วค่อยย้ายเป็น `profiles.email NULLABLE + CHECK`
7. ป้องกัน Account Takeover โดยห้าม auto-link ใช้อเมลเพียงอย่างเดียว
8. ย้าย Legacy User ด้วย `password_hash` (bcrypt) ผ่าน `createUser` มี fallback login ระหว่าง transition

**ข้อจำกัด:**
- ต้องมี PoC ยืนยัน `signInWithPassword` จาก backend ด้วยรหัสผ่านสุ่มฝั่งเซิร์ฟเวอร์ คืน session tokens ได้จริง
- LINE ไม่ใช่ Supabase provider ในตัว → ต้องดูแล provider mapping (`line_id`) เอง ไม่มี `identities[]` อัตโนมัติ
- ต้องตั้งค่า email provider (SMTP) ใน Supabase Dashboard ก่อนเปิดใช้งาน `email_confirm: false` จริง
- ไม่สามารถรัน migration หรือเปลี่ยน `.env` ใน Phase 1D ได้ เป็นแผนสำหรับ Phase ต่อไปเท่านั้น

---

## 12. สิ่งที่ยังต้องพิสูจน์ก่อนเริ่ม implementation

| รายการ | สถานะ | เหตุผล |
|--------|-------|--------|
| Staging Supabase project แยกจาก production | ❌ BLOCKED | ต้องมีผู้ใช้ตั้งค่า staging credentials ด้วยตนเองผ่านช่องทางปลอดภัย |
| `signInWithPassword` ด้วยรหัสผ่านสุ่มฝั่งเซิร์ฟเวอร์ คืน session tokens จริง | ❌ BLOCKED | ต้องมี staging Supabase credentials |
| Placeholder email ไม่ชน UNIQUE constraint | ❌ BLOCKed | ต้องทดสอบจริงบน staging |
| Supabase refresh token rotation ทำงานจริง | ❌ BLOCKED | ต้องมี staging credentials |
| Supabase `signOut(global)` เพิกถอนทุก session จริง | ❌ BLOCKED | ต้องมี staging credentials |
| `admin.signOut(userId)` เพิกถอนทุก session ของ user | ❌ BLOCKED | ต้องมี staging credentials |
| LINE Login Channel staging + Callback URL whitelist | ❌ BLOCKED | ไม่มี `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` |
| End-to-end LINE login → Supabase session → frontend เก็บ token | ❌ BLOCKED | ต้องมี staging credentials + LINE credentials |
| Email provider (SMTP) สำหรับ verification/reset-password | ❌ BLOCKED | ต้องตั้งค่าใน Supabase Dashboard |

---

## 13. ไฟล์ PoC ตัวอย่าง (แยกต่างหาก ไม่อยู่ใน runtime graph)

สร้างไฟล์ `poc/line-supabase-poc.mjs` เป็นตัวอย่างวิธีการทดสอบ (อ่านจาก environment variables, ไม่ hardcode secrets, ไม่อยู่ใน import graph ของระบบจริง) รายละเอียดดังต่อไปนี้:

**หมายเหตุ:** ไฟล์นี้เป็นตัวอย่างโค้ดสำหรับรันเมื่อมี staging credentials เท่านั้น ไม่ได้รันในระหว่าง Phase 1D เนื่องจากขาด credentials

เนื้อหาตัวอย่างครอบคลุม:
- LINE code exchange (`https://api.line.me/oauth2/v2.1/token`)
- LINE ID token verify (`https://api.line.me/oauth2/v2.1/verify`)
- Supabase `admin.createUser` + `signInWithPassword`
- Supabase `refreshSession()`
- Supabase `signOut({ scope: 'global' })` และ `admin.signOut(userId)`
- การตรวจ `profiles.is_active` ใน middleware

ไฟล์นี้ควรถูกเก็บไว้ภายนอก `backend/` และ `frontend/` src directory (เช่น `poc/` หรือไดเรกทอรีชั่วคราว) และไม่ควรถูก import โดยโค้ดระบบจริง

---

## 14. สรุปผลสำหรับแชต

**Phase 1D ไม่สามารถดำเนินการทดสอบจริงได้ในรอบนี้** เนื่องจาก:

1. **ไม่มียืนยันว่า Supabase credentials ใน `backend/.env` เป็น staging หรือ production** (อ่านค่าไม่ได้เพื่อปกป้อง secrets) → ห้ามใช้ production credentials ตามข้อกำหนด
2. **ไม่มี `LINE_CHANNEL_ID` และ `LINE_CHANNEL_SECRET`** ใน `backend/.env` → ไม่สามารถทดสอบ LINE Login ได้
3. **ห้ามขอ secrets จากผู้ใช้ผ่านแชต**

**สิ่งที่ต้องการจากผู้ใช้ก่อนดำเนินการต่อ:**
- ยืนยันว่ามี **staging Supabase project** แยกจาก production และให้ตั้งค่า `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` สำหรับ staging ด้วยตนเองผ่านช่องทางปลอดภัย
- ตั้งค่า **LINE Login Channel สำหรับ staging** พร้อม `LINE_CHANNEL_ID` และ `LINE_CHANNEL_secret` และเพิ่ม Callback URL whitelist
- แจ้งเมื่อตั้งค่าเสร็จแล้ว (ไม่ต้องส่งค่าจริงผ่านแชต)

เมื่อมี staging credentials แล้ว สามารถรันทดสอบตาม test case ในรายงานนี้ (PoC A–E) และนำผลมาสรุปก่อนเริ่ม implementation จริง

**ไฟล์ที่สร้างใน Phase 1D:**
- `PHASE_1D_AUTH_POC_REPORT.md` (รายงานนี้)
- `poc/line-supabase-poc.mjs` (ตัวอย่าง PoC code, แยกต่างหาก, ไม่อยู่ใน runtime graph) — *จะสร้างเมื่อได้รับการอนุมัติจากผู้ใช้หากจำเป็น*

**ไม่มีการ commit, push หรือ deploy ใด ๆ เกิดขึ้นใน Phase 1D**
