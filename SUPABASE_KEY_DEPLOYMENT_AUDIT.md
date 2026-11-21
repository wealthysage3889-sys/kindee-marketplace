# SUPABASE_KEY_DEPLOYMENT_AUDIT

**Project Root:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`  
**Audit Time:** 2026-11-18T11:39:18Z (environment timestamp)  
**Scope:** Read-only inspection. No environment, source code, database, or deployment changes. No secrets/keys disclosed.

---

## 1) Where `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` are read/used

### Evidence (code/config locations)

| Key | Read/defined | Primary usage | Notes |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/config/supabase.js` (`process.env.SUPABASE_SERVICE_ROLE_KEY`) | Creates `supabaseAdmin` (service-role client, `autoRefreshToken:false`, `persistSession:false`); `isSupabaseConfigured = Boolean(SUPABASE_URL) && Boolean(SUPABASE_SERVICE_ROLE_KEY)`; required for admin operations via `getAdminClient()`; also used as fallback for `supabaseAuth` when anon client unavailable | Server-side privileged access (bypasses RLS as designed by Supabase service role). |
| `SUPABASE_ANON_KEY` | `backend/config/supabase.js` (`process.env.SUPABASE_ANON_KEY`) | Creates user-facing anon `supabase` client (when URL+anon present); used by `createUserClient(accessToken)` (anon key + forwarded bearer token); optional for startup but enables user-facing auth flows that depend on anon client | Backend-only read in source; not required for base server start but warned if missing. |
| Both keys (env presence) | `backend/server.js` | Imports `isSupabaseConfigured`; **fails fast** with fatal log and `process.exit(1)` if not configured (requires URL + service role key) | Enforces service-role availability for API runtime. |
| Both keys (env presence) | Backend env templates/files: `backend/.env.example`, `backend/.env`, `backend/.env.test` define variables (values not inspected/reported) | Configuration placeholders/values for runtime/tests | `backend/.env.test` shows test-oriented Supabase URL host; key values redacted. |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend scripts: `backend/scripts/createAdminSupabase.js`, `backend/scripts/migrateLegacyUsers.js` | Script-time admin/client operations (read from env) | Operational scripts, not frontend. |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | Backend tests: multiple files under `backend/__tests__/*.mjs` set/check `process.env.*` in test setup | Test environment configuration | Test-only usage. |
| `SUPABASE_ANON_KEY` | `backend/services/authService.js` | Read/used for auth-related flows (service-level usage observed via static search) | Backend service layer. |
| Historical/documentary refs | Multiple `*.md` reports/plans in repo (e.g. rotation/checklist/pre-deployment/audit docs) | Mention variable names/procedures | Documentation, not runtime code paths beyond guidance. |

**Search scope notes:** repo-wide static search excluding `node_modules` and `.git` (and binary assets) for `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`. Frontend tree searched specifically for service-role/admin indicators (see section 3).

### Result: **PASS** (usage locations identified from accessible source/config)

---

## 2) Backend deployed on Render — required Environment Variables

### Evidence
- `backend/server.js`: startup requires Supabase to be configured (`isSupabaseConfigured` = `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`); process exits if missing.
- `backend/config/supabase.js`: reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; warns if anon key missing (some auth endpoints may be unavailable) but core admin/server config requires URL + service role.
- `vercel.json` (root) rewrites `/api/*`, `/uploads/*`, `/socket.io/*` to `https://kindee-marketplace-api.onrender.com/...`, indicating the production API backend is hosted on Render.
- `backend/.env.example` documents Supabase-related vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) plus `JWT_SECRET`, `PORT`, `NODE_ENV` as baseline backend env expectations.
- `backend/.env` (local) also includes `DATABASE_URL`, `JWT_EXPIRE`, `CLIENT_URL` (values not disclosed) — indicates these may be relevant to backend behavior depending on code paths; exact Render-required set cannot be fully proven without Render service config.

### Assessment (minimum required by observed startup/config)
**Must have (per code):**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Should have / commonly required (per code/config hints):**
- `SUPABASE_ANON_KEY` (for user-facing auth flows using anon client; warned if absent)
- `JWT_SECRET` (present in env example and local backend env; auth middleware/token flows may depend on it)
- `PORT`, `NODE_ENV`, `CLIENT_URL` (present in example/local env; deployment/runtime behavior)
- `DATABASE_URL` present in local `backend/.env` (usage not fully enumerated here; if used by deployed backend it must be set consistently)

### Result: **PASS (partial, evidence-based)** for identifying **code-enforced minimum** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and likely additional vars; **BLOCKED** for confirming the exact, complete Render service environment variable set because Render dashboard/config is not accessible from this workspace.

---

## 3) Frontend references to Service Role Key (risk check)

### Evidence
- Static search in `frontend/` (excluding `node_modules`) for `SERVICE_ROLE`, `service_role`, `supabaseAdmin`, `SUPABASE_SERVICE`: **no matches**.
- Repo-wide `SUPABASE_SERVICE_ROLE_KEY` matches are confined to backend code/config/scripts/tests and documentation files; **no frontend source/config reference found**.
- `frontend/src/api/auth.js` and related frontend logic call backend API endpoints (`/api/...`) using `VITE_API_BASE`; no direct Supabase service-role usage observed in frontend source.
- `frontend/.env` contains `VITE_GOOGLE_CLIENT_ID`, `VITE_API_BASE` only (names observed; values redacted). No `VITE_SUPABASE_SERVICE_ROLE_KEY` or equivalent observed.

### Risk assessment
- **Finding:** No evidence of `SUPABASE_SERVICE_ROLE_KEY` exposure or usage in frontend code/config within the inspected repository.
- **Risk status:** No immediate exposure found in repo. (Residual risk remains if secrets are injected via external hosting envs not visible here — not evidenced.)

### Result: **PASS**

---

## 4) Do Vercel Environment Variables affect the Backend on Render?

### Evidence
- `vercel.json` routes frontend/API proxy paths to `https://kindee-marketplace-api.onrender.com` (external Render service). Vercel hosts/serves the frontend build and rewrites per this config; it does not host the Render backend runtime.
- Vercel environment variables typically apply to Vercel build/runtime contexts (e.g. `VITE_*` for frontend build). Backend on Render reads its own environment (e.g. `process.env` in Node on Render) as shown in `backend/server.js` and `backend/config/supabase.js`.
- No shared deployment manifest or Render integration config in repo indicates Vercel envs are propagated to Render.

### Assessment
- **Direct effect:** Vercel Environment Variables **do not directly configure** the Render backend process.
- **Indirect considerations:** Vercel vars can affect frontend behavior (e.g. API base/build-time config) which changes what the frontend calls, but they do not supply secrets/env to the Render backend runtime.

### Result: **PASS** (based on architecture evidence in repo; Render-side env source not directly inspectable here but separation is clear)

---

## 5) Compliance and access limitations

- Key/secret **values were not displayed** in terminal output or this report (masked/redacted where encountered).
- **No modifications** made to environment files, source code, database, or deployment settings.
- **No commit/push/deploy** performed.
- **BLOCKED areas:** Actual Vercel and Render project/service environment variable inventories and values (platform-managed, not stored in repo).

---

## Overall summary

| Check | Result | Rationale |
|---|---|---|
| 1. Key read/usage locations identified | **PASS** | `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` read in `backend/config/supabase.js`; service role enforced at startup in `backend/server.js`; additional backend scripts/services/tests/docs refs identified. |
| 2. Render backend required env vars | **PASS (code-minimum) / BLOCKED (complete set)** | Minimum enforced: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; others likely needed but full Render env cannot be verified without platform access. |
| 3. Frontend service role key exposure | **PASS** | No frontend/service-role references found in inspected code/config. |
| 4. Vercel env impact on Render backend | **PASS** | Separate deployments; Vercel envs do not directly supply Render backend runtime env (evidence: rewrite to external Render API). |

**Final overall:** **PASS with BLOCKED items** (core repository audit checks pass; deployed-platform env verification blocked).

*End of report.*
