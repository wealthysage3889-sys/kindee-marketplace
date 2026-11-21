# Kindee Marketplace — Pre-Deploy Audit Report

**วันที่:** 2026-11-19  
**โหมด:** READ-ONLY เท่านั้น (ห้ามแก้ไขไฟล์, ห้าม Deploy, ห้าม Commit, ห้ามเชื่อมต่อ Cloud/Production)  
**สาขา Git:** main  
**หลักฐานที่ใช้:** KINDEE_LOCAL_LOCATION_VERIFICATION_REPORT.md, KINDEE_PLAYWRIGHT_LOCAL_E2E_REPORT.md, ไฟล์โปรเจกต์จริง (อ่านอย่างเดียว)

---

## Executive Summary

รายงานนี้ตรวจสอบความพร้อมก่อน Deploy ของ Kindee Marketplace โดยอาศัยหลักฐานจากการทดสอบในสภาพแวดล้อม Local เท่านั้น ไม่มีการเชื่อมต่อหรือแก้ไข Supabase Cloud, Render, Vercel หรือ Production แต่อย่างใด

ผลสรุปโดยรวม: **ยังไม่พร้อม Deploy (NOT READY)** เนื่องจากมีการเปลี่ยนแปลงไฟล์จำนวนมากที่ยังไม่ได้ Commit (uncommitted changes) ซึ่งหมายความว่าโค้ดที่จะถูก Deploy ไม่ใช่เวอร์ชันที่ผ่านการทดสอบ รวมถึงพบความเสี่ยงด้าน CORS wildcard origin ที่อาจเปิดช่องโหดใน Production หากไม่ได้กำหนด CLIENT_URL

| หมวด | สถานะ |
|------|--------|
| Git & Project Integrity | FAIL |
| Frontend Readiness | READY WITH CONDITIONS |
| Backend Readiness | READY WITH CONDITIONS |
| Supabase & Database Readiness | NOT VERIFIED |
| Security & Deployment Configuration | HIGH RISK |
| Regression Evidence | PASS |

---

## A. Git & Project Integrity

### A.1 Git Status — FAIL

ไฟล์ที่มีการเปลี่ยนแปลงแต่ยังไม่ได้ Commit (uncommitted changes):

- **Modified (33 ไฟล์):** `.gitignore`, `backend/__tests__/helpers/fakeSupabase.mjs`, `backend/controllers/messageController.js`, `backend/package-lock.json`, `backend/package.json`, `backend/routes/chatRoutes.js`, `backend/routes/orderRoutes.js`, `backend/routes/storeRoutes.js`, `backend/server.js`, `backend/services/callService.js`, `backend/services/chatService.js`, `backend/services/orderService.js`, `backend/services/socketService.js`, `frontend/index.html`, `frontend/package-lock.json`, `frontend/package.json`, `frontend/src/App.jsx`, `frontend/src/api/auth.js`, `frontend/src/api/index.js`, `frontend/src/api/product.js`, `frontend/src/components/ChatRoom.css`, `frontend/src/components/ChatRoom.jsx`, `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/context/AuthContext.jsx`, `frontend/src/index.css`, `frontend/src/pages/Account.jsx`, `frontend/src/pages/AdminAccount.jsx`, `frontend/src/pages/AdminLogin.jsx`, `frontend/src/pages/Login.jsx`, `frontend/src/pages/Messages.jsx`, `frontend/src/pages/SellAdminMessages.jsx`, `frontend/src/pages/SellerDashboard.jsx`, `frontend/src/pages/StoreProfile.jsx`
- **Deleted (2 ไฟล์):** `supabase/.temp/cli-latest`, `supabase/.temp/gotrue-version`, และอื่น ๆ ใน `supabase/.temp/`
- **Untracked (จำนวนมาก):** รายงานต่าง ๆ, `frontend/playwright.config.js`, `frontend/tests/`, `supabase/migrations/010-016.sql`, `backend/__tests__/*.test.mjs` ใหม่ ๆ

**ผลกระทบ:** โค้ดที่ผ่านการทดสอบ (Playwright 16/16, Backend 224/224) อาจไม่ตรงกับโค้ดใน working directory เนื่องจากมีการแก้ไขไฟล์หลังจากทดสอบแล้ว แต่ยังไม่ได้ Commit

**ข้อเสนอแนะ:** ต้อง Commit หรือ Stash การเปลี่ยนแปลงทั้งหมดก่อน Deploy เพื่อให้มั่นใจว่าเวอร์ชันที่ Deploy ตรงกับเวอร์ชันที่ผ่านการทดสอบ

### A.2 Dependency & Lockfile Consistency

- **Frontend `package.json`:** `playwright` ^1.65.1 และ `@playwright/test` ^1.65.1 อยู่ใน `devDependencies` เท่านั้น **ไม่ใช่ production dependency** — ถูกต้อง
- **Frontend dependencies:** react ^18.2.0, vite ^5.0.0, socket.io-client ^4.8.4, leaflet ^1.9.4, react-leaflet ^4.2.1
- **Backend dependencies:** express ^4.18.2, cors ^2.8.5, helmet ^7.0.0, socket.io ^4.8.4, @supabase/supabase-js ^2.39.0, multer ^1.4.5-lts.1, jsonwebtoken ^9.0.2, bcryptjs ^2.4.3, dotenv ^16.3.1
- **ไม่มี express-rate-limit** ใน dependencies — ยังไม่มีระบบ rate limiting

### A.3 Scripts & Build Configuration

- **Root `package.json`:** scripts `build` → `npm --prefix frontend run build`, `dev` → concurrently backend + frontend
- **Frontend `package.json`:** `dev` = vite, `build` = vite build, `preview` = vite preview, `lint` = eslint (แต่ไม่มี ESLint config)
- **Backend `package.json`:** `start` = node server.js, `dev` = nodemon server.js, `test` = node --test

### A.4 Playwright as devDependency

ยืนยันว่า `playwright` และ `@playwright/test` อยู่ใน `frontend/package.json` `devDependencies` เท่านั้น **ไม่ติดไปกับ production build** — ถูกต้อง

---

## B. Frontend Readiness

### B.1 Production Build — PASS

จาก `local_verification_frontend_build.txt`:
- `npm --prefix frontend run build` → `vite build` สำเร็จ
- Vite v5.4.21, 169 modules transformed
- Output: `dist/index.html`, `dist/assets/index-BXVubKh6.css` (189.18 kB), `dist/assets/index-koeeOuRv.js` (744.60 kB)
- **Warning:** บาง chunks เกิน 500 kB หลัง minification (build warning, ไม่ใช่ความล้มเหลว)
- `frontend/dist/` มีอยู่จริงใน working directory (ยืนยันแล้วว่ามี `dist/index.html`)

### B.2 Vite Environment Configuration

`frontend/vite.config.js`:
- Port: 3000
- Proxy `/api` → `http://localhost:5000` (development only)
- Proxy `/uploads` → `http://localhost:5000`
- Proxy `/socket.io` → `http://localhost:5000` (ws: true)

**หมายเหตุ:** Proxy ตั้งค่าไว้สำหรับ development เท่านั้น ใน production จะใช้ vercel.json rewrites แทน

### B.3 API Base URL & Routing

`frontend/src/api/index.js:1`:
```js
const RAW_API_BASE = import.meta.env.VITE_API_BASE || "/api";
```
- ใช้ `VITE_API_BASE` environment variable ถ้ามี, ถ้าไม่มีใช้ `/api` (relative path)
- ใน Vercel production จะต้องตั้ง `VITE_API_BASE` ให้ชี้ไปยัง backend URL (เช่น Render)

### B.4 SPA Fallback & Protected Routes

- **vercel.json:** rewrite `/(.*)` → `/index.html` (SPA fallback ถูกต้อง)
- **App.jsx:** ใช้ `createBrowserRouter` มี protected routes ครบถ้วน:
  - `/messages`, `/messages/:conversationId` → ProtectedRoute (customer mode)
  - `/selladmin/*` → ProtectedRoute mode="admin" (ต้องมี role admin/owner)
  - `/seller/*` → ProtectedRoute allowedRoles={["seller", "admin", "owner"]}
  - `/courier` → ProtectedRoute allowedRoles={["courier"]}

### B.5 Bundle Warnings & Console Errors

- **Bundle warning:** `index-koeeOuRv.js` 744.60 kB (gzip 213.45 kB) เกิน 500 kB threshold — อาจส่งผลต่อเวลาโหลดหน้าแรกบนมือถือ
- **Console errors:** Playwright E2E ทดสอบแล้วว่าไม่มี console errors ในหน้า chat route (ทดสอบแล้ว 16/16 PASS)

---

## C. Backend Readiness

### C.1 API Routes, CORS, Security Headers, Error Handling

`backend/server.js`:
- **Helmet:** ใช้แล้ว แต่ปิด `crossOriginResourcePolicy` เฉพาะที่ต้องการ (cross-origin)
- **CORS:** `cors({ origin: process.env.CLIENT_URL || "*", credentials: true })` — **หากไม่ได้ตั้ง CLIENT_URL ใน Production จะอนุญาตทุก origin (*)** ความเสี่ยงสูง
- **Express JSON limit:** 10mb
- **Error handler:** `errorHandler` และ `notFound` middleware มีอยู่
- **Supabase fail-fast:** ถ้า `isSupabaseConfigured` เป็น false จะหยุดการทำงานทันที (server.js:17-23)

### C.2 Authentication, Authorization, Rate Limiting

- **Authentication:** ใช้ Supabase auth + legacy custom JWT fallback (มี `JWT_SECRET`)
- **Authorization:** ProtectedRoute ตรวจสอบ role (`admin`, `owner`, `seller`, `courier`)
- **Rate Limiting:** **ไม่มี** express-rate-limit หรือ middleware อื่นสำหรับจำกัดจำนวนคำขอ — **ความเสี่ยงสูงใน Production**

### C.3 File Upload & Storage Configuration

- **Multer:** ^1.4.5-lts.1 สำหรับอัพโหลดไฟล์
- **Uploads directory:** `backend/uploads/` (gitignored, ไม่ถูก Commit)
- **Static serve:** `app.use("/uploads", express.static(uploadsDir))`

### C.4 Socket.IO & Chat/Voice (ไม่ได้แก้ไข)

- Socket.IO เริ่มต้นใน `server.js:108` (`initSocket(server)`)
- Backend tests 224/224 PASS ครอบคลุม call lifecycle, socket.io realtime, chat messaging
- Playwright E2E ทดสอบ Route Panel และ location flow แล้ว 16/16 PASS

---

## D. Supabase & Database Readiness

### D.1 Migration Files

มีไฟล์ migration 16 ไฟล์ใน `supabase/migrations/`:
- `001_initial_schema.sql` ถึง `016_consolidated_chat_schema_drift.sql`
- `002_rls_policies.sql`: เปิดใช้งาน RLS บนทุกตาราง (profiles, stores, conversations, messages, call_history, ฯลฯ) พร้อม helper functions (`get_current_user_id`, `is_admin_or_owner`, `is_seller`, `is_courier`)
- `010_store_memberships.sql`, `011_conversation_customer_id.sql`, `014_chat_voice_enhancements.sql` ฯลฯ

### D.2 Migration Execution Records

**ไม่พบบันทึกการรัน migration** (เช่น migration tracking table หรือ supabase_meta) ในรายงาน local — ไม่สามารถยืนยันว่า migration ทั้ง 16 ไฟล์ถูกรันบนฐานข้อมูลเป้าหมายแล้วหรือไม่

**สถานะ: NOT VERIFIED** — ต้องตรวจสอบบน Cloud/Vercel/Render ภายหลังว่ามีการรัน migration ครบถ้วนหรือไม่

### D.3 Schema, RLS, Policies, Indexes, Functions

จากหลักฐาน Local เท่านั้น:
- RLS เปิดใช้งานบนตารางหลักทั้งหมด (ยืนยันจาก `002_rls_policies.sql`)
- Helper functions สำหรับตรวจสอบ role และ user id มีอยู่
- **ไม่สามารถยืนยันสถานะจริงบน Production Database** ได้ เนื่องจากห้ามเชื่อมต่อ Cloud

---

## E. Security & Deployment Configuration

### E.1 Environment Variables (แสดงเฉพาะชื่อ ไม่แสดงค่า)

| ตัวแปร | ตำแหน่งที่ใช้ | หมายเหตุ |
|--------|--------------|----------|
| `SUPABASE_URL` | backend/.env, server.js | Gitignored, ไม่ได้ติดใน repo |
| `SUPABASE_SERVICE_ROLE_KEY` | backend/.env, server.js | Gitignored, bypasses RLS — ต้องหมุนถ้าอาจถูกเปิดเผย |
| `SUPABASE_ANON_KEY` | backend/.env | Gitignored |
| `DATABASE_URL` | backend/.env | Gitignored |
| `JWT_SECRET` | backend/.env, middleware/auth.js | Legacy custom JWT fallback |
| `CLIENT_URL` | backend/server.js (CORS origin) | **สำคัญ: หากไม่ตั้งจะกลายเป็น `*`** |
| `VITE_API_BASE` | frontend/.env, frontend/src/api/index.js:1 | frontend environment variable |
| `VITE_GOOGLE_CLIENT_ID` | frontend/.env | Google OAuth |

### E.2 Secret Leakage in Git Tracked Files

- `.env` และ `.env.local` อยู่ใน `.gitignore` — **ไม่ได้ติดใน repo**
- รายงานระบุว่า Git history scan ไม่พบการเปิดเผย secrets ใน tracked files (ยกเว้นประวัติเก่าที่อาจมี admin password และ SUPABASE_SERVICE_ROLE_KEY assignment ใน commit เก่า — ระบุใน PHASE_2F_PRE_DEPLOYMENT_REPORT.md)

### E.3 CORS, JWT, Session, Storage, API Exposure

- **CORS:** `origin: process.env.CLIENT_URL || "*"` — หากไม่ตั้ง CLIENT_URL ใน Production จะอนุญาตทุก origin **ความเสี่ยงสูง**
- **JWT:** ใช้ทั้ง Supabase session tokens และ legacy custom JWT fallback (มี `JWT_SECRET`)
- **Session:** เก็บใน `localStorage` (`kindee:customer:token`, `kindee:admin:token`, ฯลฯ)
- **API exposure:** ทุก route อยู่ภายใต้ `/api` prefix

### E.4 Vercel & Render Configuration (จากไฟล์ Local เท่านั้น)

`vercel.json`:
- `installCommand`: `npm --prefix frontend install`
- `buildCommand`: `npm --prefix frontend run build`
- `outputDirectory`: `frontend/dist`
- **Rewrites:**
  - `/api/:path*` → `https://kindee-marketplace-api.onrender.com/api/:path*` (hardcoded production URL)
  - `/uploads/:path*` → `https://kindee-marketplace-api.onrender.com/uploads/:path*`
  - `/socket.io/:path*` → `https://kindee-marketplace-api.onrender.com/socket.io/:path*`
  - `/(.*)` → `/index.html` (SPA fallback)

**หมายเหตุ:** Vercel redirect API ไปยัง Render backend ที่ hardcoded ไว้ — ต้องตรวจสอบว่า Render service `kindee-marketplace-api` มีการตั้งค่า environment variables ครบถ้วนหรือไม่ (ไม่สามารถตรวจสอบได้เนื่องจากห้ามเชื่อมต่อ Production)

---

## F. Regression Evidence

### F.1 Playwright E2E — 16/16 PASS

| Test | Desktop | Mobile |
|------|---------|--------|
| should open and close ChatRoutePanel on desktop | PASS | PASS |
| should show GPS route with distance on desktop | PASS | PASS |
| should run on mobile viewport (390px) | PASS | PASS |
| should display customer-shared GPS location in route panel | PASS | PASS |
| should allow re-selecting GPS after IP selection | PASS | PASS |
| should show IP disabled state when feature is off | PASS | PASS |
| IP selection should not create route, distance, or navigation link | PASS | PASS |
| should have no console errors or failed requests on chat route pages | PASS | PASS |

**หลักฐาน:** `frontend/tests/location-route-panel.spec.js`, `KINDEE_PLAYWRIGHT_LOCAL_E2E_REPORT.md`

### F.2 Backend Chat/Voice Regression — 224/224 PASS

ครอบคลุม: Authentication, Address management, Call lifecycle, Socket.io realtime, Chat messages, Phone E.164, Order/discount/payment, Conversation membership, Store membership, IP geolocation, Pagination

**หลักฐาน:** `backend/__tests__/*.test.mjs`, `KINDEE_LOCAL_LOCATION_VERIFICATION_REPORT.md`, `KINDEE_PLAYWRIGHT_LOCAL_E2E_REPORT.md`

### F.3 ข้อจำกัดของหลักฐาน

ผลทดสอบทั้งหมดเป็นผลจาก **Local environment เท่านั้น** ไม่สามารถกล่าวอ้างว่า Cloud/Production ผ่านการทดสอบแล้ว ต้องตรวจสอบซ้ำบน Production ก่อน Deploy จริง

---

## Risk Assessment

### Critical

| ID | Risk | Location | Evidence | Mitigation |
|----|------|----------|----------|------------|
| C1 | **Uncommitted changes in git** | Root working directory | `git status` แสดง 33 ไฟล์ modified, 2 deleted, untracked จำนวนมาก | Commit หรือ stash การเปลี่ยนแปลงทั้งหมดก่อน Deploy |
| C2 | **No rate limiting middleware** | `backend/server.js`, `backend/package.json` | ไม่มี `express-rate-limit` ใน dependencies, ไม่มี rate limiter middleware ใน server.js | ติดตั้งและตั้งค่า rate limiting ก่อน Deploy |

### High

| ID | Risk | Location | Evidence | Mitigation |
|----|------|----------|----------|------------|
| H1 | **CORS wildcard origin** | `backend/server.js:64-67` | `origin: process.env.CLIENT_URL || "*"` — ถ้าไม่ตั้ง CLIENT_URL จะอนุญาตทุก origin | ตั้งค่า `CLIENT_URL` ใน Production environment ให้ชี้เฉพาะ domain ของ frontend |
| H2 | **Supabase service role key exposure risk** | `backend/.env`, `PHASE_2F_PRE_DEPLOYMENT_REPORT.md` | Service role key bypasses RLS; อาจปรากฏใน Git history เก่า | หมุน `SUPABASE_SERVICE_ROLE_KEY` หากเคยถูกเปิดเผย, ไม่เก็บใน repo |
| H3 | **Production Supabase project identity unverified** | `KINDEE_ENVIRONMENT_MAPPING_REPORT.md`, `PHASE_2_SUPABASE_STAGING_VERIFICATION_REPORT.md` | ไม่สามารถยืนยันว่า production ใช้ project ref `bzkjtvsqqxnbbnkgcrko` หรือ staging | ตรวจสอบผ่าน Vercel dashboard หรือ Render dashboard โดยผู้ดูแลระบบ |

### Medium

| ID | Risk | Location | Evidence | Mitigation |
|----|------|----------|----------|------------|
| M1 | **Bundle size > 500 kB** | `frontend/dist/assets/index-koeeOuRv.js` (744.60 kB) | `local_verification_frontend_build.txt` | Code splitting, lazy loading หรือ tree shaking |
| M2 | **Legacy custom JWT fallback** | `backend/middleware/auth.js`, `PHASE_1C_AUTH_ARCHITECTURE.md` | `generateToken`, `generateRefreshToken`, `verifyRefreshToken`, `JWT_SECRET` ยังคงใช้เป็น fallback | เลิกใช้ custom JWT, ใช้ Supabase session เท่านั้น |
| M3 | **Frontend lint configuration missing** | `frontend/package.json:10`, `local_verification_frontend_lint.txt` | ไม่มี `.eslintrc*` หรือ `eslint.config.*` ใน `frontend/` | เพิ่ม ESLint configuration (ไม่บล็อก Deploy แต่เป็นหนี้เทคนิค) |

### Low

| ID | Risk | Location | Evidence | Mitigation |
|----|------|----------|----------|------------|
| L1 | **External map tile dependency** | `frontend/src/components/ChatRoutePanel.jsx:7` | `OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"` | พิจารณาใช้ map tile provider ที่เชื่อถือได้หรือ self-host |
| L2 | **Vercel.json hardcoded production URL** | `vercel.json:9-18` | API rewrite ชี้ไป `https://kindee-marketplace-api.onrender.com` hardcoded | ใช้ environment variable แทน hardcoded URL |

---

## Items to Fix Before Deploy (ไม่แก้ในรายงานนี้ รายงานเพื่อแจ้งเท่านั้น)

1. **Commit การเปลี่ยนแปลงทั้งหมด** (33 ไฟล์ modified) ให้ตรงกับเวอร์ชันที่ทดสอบแล้ว
2. **ติดตั้ง rate limiting** (เช่น `express-rate-limit`) ใน backend
3. **ตั้งค่า `CLIENT_URL`** ใน Production environment variables (Vercel/Render) ห้ามปล่อยเป็น `*`
4. **ยืนยันตัวตน Supabase project ของ Production** ว่าใช้ project ref ที่ถูกต้อง (ไม่ใช่ staging)
5. **พิจารณาหมุน `SUPABASE_SERVICE_ROLE_KEY`** หากเคยถูกเปิดเผยใน Git history
6. **ตั้งค่า `VITE_API_BASE`** ใน frontend production environment ให้ชี้ไปยัง backend production URL (ไม่ใช่ localhost)
7. **ยืนยัน migration ทั้ง 16 ไฟล์** ถูกรันบน Production database แล้ว

## Items to Check on Cloud After Deploy

1. Vercel dashboard: ตรวจสอบ environment variables (`CLIENT_URL`, `VITE_API_BASE`, ฯลฯ) ตั้งค่าครบถ้วนหรือไม่
2. Render dashboard: ตรวจสอบ backend service `kindee-marketplace-api` environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL`)
3. Supabase dashboard: ตรวจสอบว่า migration ทั้งหมดถูกรันแล้ว, RLS policies ทำงานถูกต้อง
4. ทดสอบ smoke test บน Production URL จริง (frontend load, login, chat, route panel)
5. ตรวจสอบ CORS behavior บน production domain จริง

---

## Final Recommendation

**NOT READY** (ยังไม่พร้อม Deploy)

**เหตุผล:**
1. มี uncommitted changes จำนวนมากใน working directory — โค้ดที่จะ Deploy ไม่ใช่เวอร์ชันที่ผ่านการทดสอบ (Critical)
2. ไม่มี rate limiting middleware ใน backend (Critical)
3. CORS อนุญาต wildcard origin (`*`) หากไม่ตั้งค่า `CLIENT_URL` ใน Production (High)
4. ไม่สามารถยืนยันสถานะ Supabase migration และ project identity บน Production (High)

**เงื่อนไขก่อน Deploy:**
- Commit ทุกการเปลี่ยนแปลงใน git ให้เรียบร้อย
- ติดตั้ง rate limiting และตั้งค่า `CLIENT_URL` ใน production environment
- ยืนยัน Supabase migration และ project identity ผ่าน dashboard ของ cloud provider
- ตั้งค่า `VITE_API_BASE` ให้ถูกต้องสำหรับ production frontend

เมื่อเงื่อนไขทั้งหมดได้รับการแก้ไขแล้ว สามารถพิจารณาเปลี่ยนสถานะเป็น **READY WITH CONDITIONS** ได้

---

**หมายเหตุ:** รายงานนี้จัดทำในโหมด READ-ONLY เท่านั้น ไม่มีการแก้ไขไฟล์ใด ๆ ในโปรเจกต์ ไม่มีการ Deploy, Push, Commit หรือเชื่อมต่อ Cloud/Production Production readiness ต้องได้รับการยืนยันจากผู้ดูแลระบบผ่าน cloud dashboard ก่อน Deploy จริง
