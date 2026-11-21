# SUPABASE_ENVIRONMENT_CLASSIFICATION_REPORT

**Project Root:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`  
**Branch:** `main` (local ahead of `origin/main` by 1 commit)  
**Audit Time:** 2026-11-18T11:13:11Z (environment timestamp)  
**Scope:** Read-only inspection. No migrations/db push/link/unlink, no data changes, no env edits on Vercel/Render, no commits/push/deploy. Secrets not disclosed.

---

## 1) Git working tree status (before report creation)

### Evidence
- Command: `git status --porcelain=v1 -b`
  - `## main...origin/main [ahead 1]`
  - Modified: `.gitignore`, `backend/controllers/messageController.js`, `backend/services/callService.js`, `backend/services/chatService.js`, `backend/services/socketService.js`, `frontend/src/api/auth.js`
  - Index deletions recorded for: `supabase/.temp/cli-latest`, `supabase/.temp/gotrue-version`, `supabase/.temp/linked-project.json`, `supabase/.temp/pooler-url`, `supabase/.temp/postgres-version`, `supabase/.temp/project-ref`, `supabase/.temp/rest-version`, `supabase/.temp/storage-migration`, `supabase/.temp/storage-version` (porcelain `D  ...`)
  - Untracked (`??`): multiple `*_REPORT*.md`/audit/plan docs, `backend/__tests__/callIncomingSocket.test.mjs`, `backend/__tests__/phase2_remediation.test.mjs`, `backend/scripts/phase2_backup_restore_sim.mjs`, `regression_output.txt`, `regression_test_output.txt`, `supabase/migrations/010_store_memberships.sql`, `supabase/migrations/011_conversation_customer_id.sql`, etc.
- Command: `git diff --stat HEAD` (summary): 15 files changed, 206 insertions(+), 72 deletions(-); includes deletions of the 9 `supabase/.temp/*` entries and modifications in backend/frontend/.gitignore.
- Command: `git ls-files --others --exclude-standard`: confirms untracked files including `supabase/migrations/010_store_memberships.sql`, `supabase/migrations/011_conversation_customer_id.sql`.
- Observation: `supabase/.temp/` directory currently exists on disk with metadata files present (including `project-ref`, `linked-project.json`) despite index showing deletions — working tree/index state is inconsistent for `.temp` artifacts.

### Status: **VERIFIED**
Git status, diff summary, and untracked files were inspected from local repository state.

---

## 2) Supabase configuration in code/config (secrets not disclosed)

### Evidence
- **Backend client/config**: `backend/config/supabase.js`
  - Reads env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
  - Creates anon client (`supabase`), service-role admin client (`supabaseAdmin`), auth client fallback (`supabaseAuth`), and `createUserClient(accessToken)`.
  - `isSupabaseConfigured = Boolean(SUPABASE_URL) && Boolean(SUPABASE_SERVICE_ROLE_KEY)`.
- **Backend env template**: `backend/.env.example` defines `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (placeholders only).
- **Env files present (names only)**: root `.env.local`; `backend/.env`, `backend/.env.example`, `backend/.env.test`; `frontend/.env`.
  - `backend/.env`: contains keys `PORT`, `NODE_ENV`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `JWT_EXPIRE`, `CLIENT_URL` (values redacted). `SUPABASE_URL` and `DATABASE_URL` hosts include **Project Ref `bzkjtvsqqxnbbnkgcrko`**.
  - `backend/.env.test`: contains `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `JWT_SECRET`, `PORT`, `NODE_ENV`, `CLIENT_URL`; `SUPABASE_URL` host is `test.supabase.co` (no 20-char project ref detected).
  - `frontend/.env`: contains `VITE_GOOGLE_CLIENT_ID`, `VITE_API_BASE` (values redacted). No `VITE_SUPABASE_*` / Supabase client vars observed.
  - `.env.local` (root): contains `VERCEL_OIDC_TOKEN` only (redacted); no Supabase URL/ref variables observed.
- **Frontend source**: `frontend/src/api/auth.js` uses backend API (`VITE_API_BASE`/`/api`) via fetch; no Supabase JS client usage found in `frontend/src` search for `supabase`/`SUPABASE` (only incidental string matches in unrelated files noted).
- **Supabase project config**: no `supabase/config.toml` found.
- **Migrations**: `supabase/migrations/001_initial_schema.sql` … `009_call_status_lifecycle.sql` tracked; `010_store_memberships.sql`, `011_conversation_customer_id.sql` present but **untracked**.

### Status: **VERIFIED** (configuration structure and variable names/refs presence in repo-local files; secret values not inspected/disclosed)

---

## 3) Supabase URL / Project Ref in available environments (Project Ref only)

| Location (repo-local) | Variable(s) | Project Ref / Host evidence | Status |
|---|---|---|---|
| `backend/.env` | `SUPABASE_URL`, `DATABASE_URL` | **`bzkjtvsqqxnbbnkgcrko`** (`*.supabase.co` / DB host) | VERIFIED (file contains ref) |
| `backend/.env.test` | `SUPABASE_URL` | `test.supabase.co` (no project ref extracted) | VERIFIED (file inspected) |
| `backend/.env.example` | `SUPABASE_URL` | placeholder `your-project-ref.supabase.co` | VERIFIED |
| `frontend/.env`, `.env.local` | — | No Supabase project ref/URL found | VERIFIED (absence) |
| `supabase/.temp/project-ref` | CLI link metadata | **`henhkouetfjelkqsfzgu`** | VERIFIED (on-disk file) |
| `supabase/.temp/linked-project.json` | CLI link metadata | **`henhkouetfjelkqsfzgu`** | VERIFIED (on-disk file) |

**Note:** Project refs above are identifiers observed in local files/metadata; no API keys, service keys, JWT secrets, DB passwords, or tokens are reported.

### Status: **VERIFIED** for repo-local files/CLI temp metadata; **UNVERIFIED** for any environment variables not stored in this workspace.

---

## 4) Vercel / Render configuration accessible (no env modification)

### Evidence
- **Vercel (repo-local)**:
  - `vercel.json` (root): builds frontend (`npm --prefix frontend install/build`, output `frontend/dist`) and rewrites `/api/*`, `/uploads/*`, `/socket.io/*` to `https://kindee-marketplace-api.onrender.com/...`; SPA fallback to `/index.html`.
  - `backend/vercel.json`: Vercel Node build config for `server.js` (routes to `server.js`).
  - `.vercel/project.json` exists (local linkage; `projectId`/`orgId` redacted in inspection) with `projectName":"kindee-marketplace"`; `.vercel/README.txt` present. `.vercel` directory is present locally.
  - No Vercel environment variable values are accessible from repository files.
- **Render (repo-local)**: no `render.yaml`, `Dockerfile` deployment manifest for Render, or Render-specific config files found in repo (search limited to accessible files; node_modules false positives excluded). API target implied by Vercel rewrite: `kindee-marketplace-api.onrender.com`.
- **Git remote**: `origin https://github.com/wealthysage3889-sys/kindee-marketplace.git`.

### Status
- Repo-local Vercel/Render routing/config files: **VERIFIED**.
- Actual Vercel project Environment Variables: **BLOCKED** (no dashboard/API access; not stored in repo).
- Actual Render service Environment Variables: **BLOCKED** (no dashboard/API access; not stored in repo).

---

## 5) Classification: Project `bzkjtvsqqxnbbnkgcrko` (production use?) and Staging separation

### Evidence
- `backend/.env` (local backend environment file) contains `SUPABASE_URL` and `DATABASE_URL` referencing **Project Ref `bzkjtvsqqxnbbnkgcrko`** (values/credentials redacted).
- `backend/config/supabase.js` consumes `SUPABASE_URL`/service key for server-side operations; this indicates the backend is wired to use whatever Supabase project is supplied via env.
- Frontend is configured to call backend API (`VITE_API_BASE` / rewrites to Render API), not a Supabase project directly.
- Deployed runtime envs (Vercel/Render) cannot be read from this workspace.

### Assessment
- **`bzkjtvsqqxnbbnkgcrko` as the database the app is configured to use in this workspace's backend env:** **VERIFIED** (based on `backend/.env`).
- **`bzkjtvsqqxnbbnkgcrko` as the actual production database used by deployed/live app:** **UNVERIFIED / BLOCKED** — cannot confirm Render/Vercel production env values without platform access; repo routing suggests Render-hosted API but its Supabase env is unknown from local evidence alone.
- **Separate Staging environment/project exists:** **UNVERIFIED** — no distinct staging Supabase project ref found in accessible config files. `backend/.env.test` points to `test.supabase.co` (test placeholder host, not a confirmed staging project ref). No `backend/.env.staging`, staging deploy config, or alternate project ref evidence discovered. Historical report filenames exist in repo but are not treated as proof of a currently provisioned staging project without corroborating config.

---

## 6) Supabase CLI linkage (read-only; no link/unlink)

### Evidence
- Command: `supabase --version` → `2.122.0` (CLI available in PATH).
- File: `supabase/.temp/project-ref` → `henhkouetfjelkqsfzgu`.
- File: `supabase/.temp/linked-project.json` → `{"ref":"henhkouetfjelkqsfzgu","name":"jaotai1992-collab's Project","organization_id":"<id>","organization_slug":"<slug>"}` (identifiers present in file; not required for this classification beyond ref).
- `git status` shows `supabase/.temp/*` as deleted in index (`D  ...`) while files exist on disk now (inconsistent index/worktree state for temp metadata).
- No `supabase/config.toml` present.

### Status: **VERIFIED** (local CLI metadata indicates linkage to **Project Ref `henhkouetfjelkqsfzgu`**). **Not verified** against remote Supabase auth/session state beyond local metadata; no `supabase projects list`/remote calls executed.

---

## 7) Constraints compliance

- No database created.
- No migration or `db push` executed.
- No production/staging data modified.
- No Vercel/Render environment variables modified.
- No `supabase link` / `supabase unlink` executed.
- No commit, push, or deploy performed.
- Secret values (keys, passwords, tokens) not disclosed in this report.

**Status: VERIFIED** (by actions taken during this audit).

---

## Summary classification

| Item | Status | Notes |
|---|---|---|
| Git status/diff/untracked inspected | VERIFIED | Ahead 1; modified + untracked + `.temp` index/worktree inconsistency observed |
| Supabase settings in code/config inspected (no secrets) | VERIFIED | `backend/config/supabase.js`, env templates/files present |
| Supabase URL/Project Ref in available env files (ref-only) | VERIFIED (local) / UNVERIFIED (external) | `bzkjtvsqqxnbbnkgcrko` in `backend/.env`; `henhkouetfjelkqsfzgu` in CLI `.temp` |
| Vercel/Render config accessible in repo | VERIFIED (files/routing) | `.vercel` linkage present locally; rewrite target Render API |
| Vercel/Render actual env vars | BLOCKED | No platform access from workspace |
| `bzkjtvsqqxnbbnkgcrko` configured in workspace backend | VERIFIED | Evidence: `backend/.env` |
| `bzkjtvsqqxnbbnkgcrko` confirmed production/live | UNVERIFIED / BLOCKED | Deployed envs unknown |
| Separate Staging exists | UNVERIFIED | No confirmed separate staging project ref/config found |
| Supabase CLI linked project | VERIFIED (local metadata) | **`henhkouetfjelkqsfzgu`**; CLI `2.122.0` |

---

## Key risks / gaps observed (evidence-based)
- **CLI linkage vs backend env ref mismatch:** CLI temp metadata points to `henhkouetfjelkqsfzgu` while `backend/.env` points to `bzkjtvsqqxnbbnkgcrko` (**VERIFIED** from local files). Operational risk if CLI commands are run against the linked project assuming it matches app runtime DB.
- **`supabase/.temp` state inconsistency:** index records deletions but files exist on disk (**VERIFIED**).
- **Untracked migrations present:** `010_store_memberships.sql`, `011_conversation_customer_id.sql` not tracked in git (**VERIFIED**).
- **Deployment env opacity:** cannot prove production/staging env parity from repo alone (**BLOCKED**).

*End of report.*
