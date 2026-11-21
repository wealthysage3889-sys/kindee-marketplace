# PHASE 2 SUPABASE STAGING ENVIRONMENT VERIFICATION REPORT

**Project:** kindee-marketplace  
**Remote:** `wealthysage3889-sys/kindee-marketplace`  
**Branch:** `main`  
**HEAD:** `b5dbfb6 update: fix chat and voice call features`  
**Date:** 2026-11-18  
**Expected staging ref:** `bzkjtvsqqxnbbnkgcrko`  
**Forbidden ref:** `henhkouetfjelkqsfzgu`  
**Resume point:** Session `ses_e11e2dbe8ffejLM3I85Rlh70S4` (interrupted by upstream 503). This report completes the unfinished sections and does not repeat checks that already had evidence.

---

## 0. Scope and constraints honored

- No migration 010/011 executed.
- No schema or data modification.
- No Auth users or Storage objects created/deleted.
- No Environment Variables changed.
- No Production access; no Render/Vercel deployment touched.
- No commit / push / deploy.
- Phase C not started.
- All checks were read-only (`GET`, `SELECT`-equivalent, channel subscribe).
- No credentials, API keys, passwords, or secrets are printed in this report.
- No repository files were modified. Temporary check scripts were written outside the repo under `%TEMP%\kilo` and were not committed.

---

## 1. Pre-flight (git) — PASS

| Check | Result |
|---|---|
| Project root | `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace` |
| Git remote | `https://github.com/wealthysage3889-sys/kindee-marketplace.git` |
| Branch | `main` |
| HEAD | `b5dbfb6 update: fix chat and voice call features` |
| Working tree | Uncommitted changes preserved (5 modified files) |
| Untracked files | Preserved (including `010_store_memberships.sql`, `011_conversation_customer_id.sql`) |
| Changes made by this task | None (report file only) |

`git status` and `git diff --stat` were captured before and after verification; they are unchanged. Nothing was committed, stashed, reset, or deleted.

---

## 2. Project Identity Verification — PARTIAL

| Item | Status | Evidence |
|---|---|---|
| Project Ref | **PASS** | `backend/.env` → `SUPABASE_URL` host = `bzkjtvsqqxnbbnkgcrko.supabase.co` |
| Forbidden ref not used by app | **PASS** | `henhkouetfjelkqsfzgu` does not appear in `backend/.env`, `frontend/.env`, or application source |
| Project URL | **PASS** | `https://bzkjtvsqqxnbbnkgcrko.supabase.co` |
| Project Name | **UNVERIFIED** | Requires Supabase Management API PAT or Dashboard |
| Organization | **UNVERIFIED** | Requires Management API PAT or Dashboard |
| Project Status | **PASS (active)** | `GET /rest/v1/` → HTTP 200; `GET /auth/v1/health` → HTTP 200 |
| Region | **UNVERIFIED** | Direct DB hostname `db.bzkjtvsqqxnbbnkgcrko.supabase.co` has no DNS A record; no Management API token |
| Compute / Plan Tier | **UNVERIFIED** | Not exposed by project API keys |
| Billing / Usage | **UNVERIFIED** | Not exposed by project API keys |

**Notes**

- `supabase/.temp/linked-project.json` and `supabase/.temp/project-ref` reference `henhkouetfjelkqsfzgu` (the **forbidden** project). This is a CLI link artifact, not app configuration. See Section 4 and Section 10.
- The `.temp` version files (`gotrue-version`, `rest-version`, `storage-version`, `postgres-version`, `pooler-url`) belong to the CLI-linked project (`henhkouetfjelkqsfzgu`), **not** to `bzkjtvsqqxnbbnkgcrko`. They were not used as evidence for the staging project.

---

## 3. Project Tier and Billing Verification — UNVERIFIED

No Supabase Personal Access Token (Management API) is present in the environment:

- `SUPABASE_ACCESS_TOKEN` is not set.
- No global Supabase config at `%USERPROFILE%\.config\supabase`.
- Project `anon`/`service` keys cannot read organization, plan, region, or billing.

**Status: UNVERIFIED.**  
**Cannot be inferred from project name or API responses.**

**User action required (Dashboard):**

1. Open the Supabase Dashboard and select the project whose ref is `bzkjtvsqqxnbbnkgcrko`.
2. Project Settings → General → confirm **Plan**, **Region**, **Organization**, and **Project ID**.
3. Billing → confirm the project is on the intended plan and review usage.
4. Record the observed values (do not paste API keys) and attach them to this report.

---

## 4. Production Separation Verification — BLOCKED

| Check | Status | Evidence |
|---|---|---|
| Backend environment points to allowed ref | **PASS** | `backend/.env` → `SUPABASE_URL` = `bzkjtvsqqxnbbnkgcrko` |
| Frontend embeds a Supabase project | **PASS (none)** | `frontend/.env` contains only `VITE_GOOGLE_CLIENT_ID` and `VITE_API_BASE`; no Supabase URL |
| Production backend project identity | **UNVERIFIED** | Production frontend proxies `/api` to `https://kindee-marketplace-api.onrender.com` (`vercel.json`); the Render service's `SUPABASE_URL` is not in the repo and was not inspected (production must not be touched) |
| Production DB / Auth / Storage separated from staging | **UNVERIFIED** | Cannot compare production project without access |
| No production credentials reused for staging | **UNVERIFIED** | Cannot inspect Render environment |
| Supabase CLI targets allowed staging | **FAIL (risk)** | `supabase/.temp/project-ref` = `henhkouetfjelkqsfzgu` (forbidden) |

**Why this is blocked**

- The application config (`backend/.env`) points to the allowed ref, which is necessary but **not sufficient** to prove the project is staging rather than production.
- The deployed backend is on Render (`kindee-marketplace-api.onrender.com`). If Render's `SUPABASE_URL` is also `bzkjtvsqqxnbbnkgcrko`, then `bzkjtvsqqxnbbnkgcrko` may be production, not staging. This must be confirmed by a human.
- The Supabase CLI is currently linked to the forbidden project. Running `supabase db push`, `supabase migration up`, or `supabase link` without changing the link would target `henhkouetfjelkqsfzgu`. **Do not run any CLI migration command until this is corrected.**

**Circumstantial signal (not proof):** the staging ref contains a small dataset (4 stores, 14 profiles, 12 conversations, 194 messages, 89 call records), which is consistent with test/staging data. This is not accepted as proof of separation.

**User action required:**

1. Inspect the Render service `kindee-marketplace-api` → Environment → `SUPABASE_URL`.
2. Confirm the production project ref is **different** from `bzkjtvsqqxnbbnkgcrko`, or explicitly confirm that `bzkjtvsqqxnbbnkgcrko` is intended as staging and is not the production database.
3. Confirm the production project is not `henhkouetfjelkqsfzgu` if that project is meant to be retired/forbidden.
4. Record the production project ref (ref only, no keys) in the Dashboard evidence.
5. Fix the CLI link before any migration work (see Section 10).

---

## 5. Environment Configuration Verification — PARTIAL

| File | Content (non-secret) | Status |
|---|---|---|
| `backend/.env` | `SUPABASE_URL` = `bzkjtvsqqxnbbnkgcrko.supabase.co`; `DATABASE_URL` = `db.bzkjtvsqqxnbbnkgcrko.supabase.co` | **PASS** (points to allowed ref) |
| `backend/.env.test` | `SUPABASE_URL` = `test.supabase.co` (placeholder) | INFO (tests do not hit a real project) |
| `backend/.env.example` | `SUPABASE_URL` = `your-project-ref.supabase.co` (placeholder) | INFO |
| `frontend/.env` | `VITE_GOOGLE_CLIENT_ID`, `VITE_API_BASE` | **PASS** (no Supabase project embedded) |
| `.env.local` | `VERCEL_OIDC_TOKEN` only | INFO |
| `supabase/.temp/project-ref` | `henhkouetfjelkqsfzgu` | **FAIL (risk)** — CLI linked to forbidden project |
| Environment Variables changed by this task | None | **PASS** |

**Note:** `DATABASE_URL` points to the direct DB hostname, which currently has no DNS A record. Direct Postgres verification was therefore not possible in this environment (see Section 6).

---

## 6. Database / Auth / Storage / Realtime Readiness

### 6.1 Read-only probes against `bzkjtvsqqxnbbnkgcrko`

| Endpoint | Result | Interpretation |
|---|---|---|
| `GET /auth/v1/health` | **200** `{"name":"GoTrue","version":"v2.198.0"}` | Auth available |
| `GET /rest/v1/` | **200** (PostgREST OpenAPI) | Database REST available; tables visible |
| `GET /storage/v1/status` | **200** | Storage available |
| Realtime channel subscribe | **SUBSCRIBED** | Realtime available |

### 6.2 Data counts (service role, read-only)

| Table | Count |
|---|---|
| `stores` | 4 |
| `profiles` | 14 |
| `conversations` | 12 |
| `conversation_members` | 12 |
| `messages` | 194 |
| `call_history` | 89 |
| `auth.users` | 14 |

### 6.3 Auth

- `auth.admin.listUsers` succeeded (14 users listed, no pagination remainder).
- Auth availability: **PASS**.

### 6.4 Storage

Buckets discovered:

| Bucket | Public |
|---|---|
| `avatars` | yes |
| `store-logos` | yes |
| `store-covers` | yes |
| `product-images` | yes |
| `chat-attachments` | no |
| `voice-recordings` | no |

- Storage availability: **PASS**.
- Bucket separation from production: **UNVERIFIED** (cannot compare).

### 6.5 Realtime

- A channel subscribed successfully (`SUBSCRIBED`) using the anon key.
- Realtime availability: **PASS**.
- A raw `GET /realtime/v1/websocket` returned HTTP 500 (HTML error page); this is not a valid Realtime handshake and is not treated as a failure. The successful channel subscription is the authoritative check.

### 6.6 RLS Configuration — PARTIAL

| Check | Result |
|---|---|
| Anon `SELECT` on `stores` | 1 row visible |
| Service-role `SELECT` on `stores` | 4 rows visible (all `is_active = true`) |
| Interpretation | RLS is actively filtering results for the anon role; consistent with RLS enabled and policies in effect |
| Full policy coverage (`pg_tables.rowsecurity`, `pg_policies`) | **UNVERIFIED** |

**Why full RLS verification is unverified:**

- PostgREST does not expose `pg_tables` or `pg_policies`.
- `exec_sql`-style RPC is not available.
- Direct Postgres access was not possible: `pg` and `psql` are not installed, and `db.bzkjtvsqqxnbbnkgcrko.supabase.co` has no DNS A record.

**Status: PARTIAL PASS (RLS active on `stores`) / UNVERIFIED (full policy matrix).**

### 6.7 Synthetic test account capability

- The service-role key can reach the Admin API (`listUsers` succeeded), so creating synthetic users is technically possible.
- **Not exercised**, per the prohibition on creating Auth users.
- Status: **CAPABILITY PRESENT, NOT EXERCISED**.

### 6.8 Resource / quota / usage limits

- **UNVERIFIED** — requires Management API or Dashboard.

### 6.9 Direct database connectivity

- **UNVERIFIED** — no `pg`/`psql` client; direct DB hostname does not resolve; pooler host for this ref unknown.
- REST/PostgREST connectivity is confirmed and sufficient for the Phase C RLS tests if they are written against PostgREST with authenticated JWTs.

---

## 7. Migration status — 010 / 011 NOT applied (as required)

| Check | Result | Evidence |
|---|---|---|
| `store_memberships` table exists | **NO** | `PGRST205: Could not find the table 'public.store_memberships' in the schema cache` |
| `conversations.customer_id` column exists | **NO** | `42703: column conversations.customer_id does not exist` |

**Status: PASS** — migrations 010 and 011 have **not** been run against this project, which matches the task constraint. No migration was attempted.

---

## 8. Evidence index

Commands / checks performed (read-only):

1. `git status`, `git diff --stat`, `git rev-parse --abbrev-ref HEAD`, `git remote -v`, `git log -1 --oneline`.
2. Read `backend/.env`, `backend/.env.test`, `backend/.env.example`, `frontend/.env`, `.env.local`, `supabase/.temp/*`, `vercel.json`, `backend/vercel.json` (hosts and non-secret keys only; no secret values printed).
3. `GET https://bzkjtvsqqxnbbnkgcrko.supabase.co/auth/v1/health` → 200.
4. `GET https://bzkjtvsqqxnbbnkgcrko.supabase.co/rest/v1/` → 200.
5. `GET https://bzkjtvsqqxnbbnkgcrko.supabase.co/storage/v1/status` → 200.
6. Realtime channel subscribe via Supabase JS → `SUBSCRIBED`.
7. Supabase JS service-role `count` queries on `stores`, `profiles`, `conversations`, `conversation_members`, `messages`, `call_history`.
8. Supabase JS `auth.admin.listUsers` and `storage.listBuckets`.
9. Anon vs service-role `SELECT` on `stores` (RLS indirect check).
10. PostgREST existence checks for `store_memberships` and `conversations.customer_id`.

Temporary scripts were created only under `C:\Users\LEGION\AppData\Local\Temp\kilo\` and are not part of the repository.

---

## 9. Items that could not be verified

| Item | Reason | How the user can verify |
|---|---|---|
| Project Name | No Management API token | Dashboard → Project Settings → General |
| Organization | No Management API token | Dashboard → Project Settings → General |
| Region | No Management API token; direct DB host has no A record | Dashboard → Project Settings → General |
| Compute / Plan Tier | Not exposed by anon/service keys | Dashboard → Project Settings → General / Billing |
| Billing / Usage | Not exposed by anon/service keys | Dashboard → Billing |
| Production separation | Production env not accessible; production must not be touched | Inspect Render `kindee-marketplace-api` → Environment → `SUPABASE_URL`; compare ref |
| Full RLS policy matrix | `pg_tables`/`pg_policies` not exposed; no direct DB client | Dashboard → SQL Editor → `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';` |
| Direct Postgres connectivity | No `pg`/`psql`; direct DB host unresolved | Use Supabase pooler URL or install a Postgres client |
| Resource / quota limits | No Management API | Dashboard → Project Settings → Usage / Billing |

---

## 10. Security and configuration findings — FAIL

### 10.1 Untracked check scripts contain hardcoded secrets

The following untracked files contain a hardcoded service-role key and/or database password in plaintext:

- `backend/__check_pg.cjs`
- `backend/__check_rest.cjs`
- `backend/__check_rls.cjs`
- `backend/__check_rls2.cjs`

**Risk:** if committed or shared, these files leak privileged credentials.

**Required action:**

1. Do not commit these files.
2. Delete them, or move them outside the repository and load credentials from environment variables.
3. Rotate the exposed service-role key and database password in the Supabase Dashboard.
4. Confirm `.env` and `.env.*` remain git-ignored.

(No secret values are reproduced in this report.)

### 10.2 Supabase CLI linked to the forbidden project

`supabase/.temp/project-ref` = `henhkouetfjelkqsfzgu`.

**Risk:** any `supabase db push`, `supabase migration up`, `supabase db reset`, or `supabase link` will target the forbidden project unless the link is changed.

**Required action:**

- Do not run any CLI migration command.
- Before Phase C, explicitly link to `bzkjtvsqqxnbbnkgcrko` using an approved method, or pass `--db-url` with the staging connection string only after human approval.
- Verify `supabase/.temp/project-ref` shows the staging ref before running anything.

---

## 11. PASS / FAIL / UNVERIFIED / BLOCKED summary

| Section | Status |
|---|---|
| Pre-flight (git, remote, branch) | **PASS** |
| Project Ref = allowed staging ref | **PASS** |
| Forbidden ref not used by app config | **PASS** |
| Project URL | **PASS** |
| Project Status (active) | **PASS** |
| Project Name / Organization / Region | **UNVERIFIED** |
| Compute / Plan Tier | **UNVERIFIED** |
| Billing / Usage | **UNVERIFIED** |
| Production Separation | **BLOCKED** |
| Backend environment points to allowed ref | **PASS** |
| Frontend has no embedded Supabase project | **PASS** |
| CLI linked to allowed staging | **FAIL (risk)** |
| Auth availability | **PASS** |
| Storage availability | **PASS** |
| Realtime availability | **PASS** |
| Database (PostgREST) availability | **PASS** |
| Direct Postgres connectivity | **UNVERIFIED** |
| RLS active (indirect, `stores`) | **PASS (partial)** |
| Full RLS policy matrix | **UNVERIFIED** |
| Synthetic test account capability | **PRESENT, NOT EXERCISED** |
| Resource / quota limits | **UNVERIFIED** |
| Migration 010 not applied | **PASS** |
| Migration 011 not applied | **PASS** |
| Hardcoded secrets in untracked scripts | **FAIL (security)** |

---

## 12. Final verdict — NOT READY for Phase C

**Phase B (Staging Identity) is only partially verified.** The project ref matches the allowed staging ref and the project is reachable, but the following remain unproven:

1. The project is **staging**, not production (Production Separation = BLOCKED).
2. The plan tier and billing are as expected (UNVERIFIED).
3. The Supabase CLI is safely pointed at the staging project (currently FAIL — linked to the forbidden project).
4. The exposed credentials in untracked scripts have been rotated (FAIL — security).

Because the task's completion condition requires Project Identity, Staging Separation, and Tier to be confirmed, and those are not all confirmed, the result is:

> **NOT READY FOR PHASE C.**

Phase C (Real-DB RLS Integration Tests) remains **BLOCKED** and must not start.

The positive findings are recorded so they do not need to be repeated:

- Staging ref is reachable and active.
- Auth, Storage, Realtime, and PostgREST are available.
- RLS is actively filtering at least on `stores`.
- Migrations 010/011 are **not** applied, so Phase C can start from a clean pre-migration state once identity/tier/separation are confirmed.

---

## 13. Stop point and remaining work

**Stopped at:** Section 12 (final verdict), because the remaining items require human/Dashboard access that is not available to the agent.

**Remaining work (in order):**

1. User confirms in the Supabase Dashboard:
   - Project `bzkjtvsqqxnbbnkgcrko` name, organization, region, plan tier, billing.
   - Production project ref from the Render service environment.
2. User confirms `bzkjtvsqqxnbbnkgcrko` is staging and is not the production database.
3. User rotates the service-role key and DB password exposed in `backend/__check_*.cjs`, then deletes those files.
4. Fix the Supabase CLI link so it targets `bzkjtvsqqxnbbnkgcrko` (or use an explicit approved `--db-url`).
5. Re-run only the unverified items (Tier, Production Separation, full RLS matrix) and attach Dashboard evidence.
6. Update this report's status table to READY only after items 1–5 are complete.

**Do not, until then:**

- Run migration 010 or 011.
- Run any Supabase CLI migration command.
- Touch the production project.
- Start Phase C.
- Commit, push, or deploy.

---

## Appendix A — Raw probe results (non-secret)

```text
auth_health: 200 {"name":"GoTrue","version":"v2.198.0"}
rest_root: 200 (PostgREST OpenAPI)
storage_status: 200
realtime: SUBSCRIBED

service stores: 4 rows (all is_active=true)
anon stores: 1 row

profiles: 14
conversations: 12
conversation_members: 12
messages: 194
call_history: 89
auth.users: 14

store_memberships: PGRST205 (table not found)
conversations.customer_id: 42703 (column does not exist)

storage buckets: avatars(public), store-logos(public), store-covers(public),
                 product-images(public), chat-attachments(private), voice-recordings(private)
```

## Appendix B — Non-secret project hosts observed

```text
backend/.env  SUPABASE_URL -> bzkjtvsqqxnbbnkgcrko.supabase.co
backend/.env  DATABASE_URL -> db.bzkjtvsqqxnbbnkgcrko.supabase.co
frontend/.env (no Supabase URL)
supabase/.temp/project-ref -> henhkouetfjelkqsfzgu (forbidden; CLI link)
```

No API keys, access tokens, passwords, or other secrets are included in this report.