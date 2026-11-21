# PHASE 2 — Credential Rotation Plan

**Project:** `kindee-marketplace`  
**Root:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`  
**Git remote:** `https://github.com/wealthysage3889-sys/kindee-marketplace.git`  
**Branch:** `main`  
**Date:** 2026-11-18  
**Status:** PREPARED (no rotation/revoke performed)

## 1. Purpose and constraints

This plan documents credentials that require rotation or verification after credential-exposure remediation and identifies safe execution prerequisites. It does **not** rotate, revoke, or replace credentials, and it does **not** change environment variables on Render, Vercel, Supabase, or production systems.

**Constraints honored**
- No migration 010/011 executed.
- No production database or production environment variables modified.
- No commit, push, or deploy performed.
- No credentials, keys, passwords, or secret values are included in this document.
- Rotation/revoke actions are listed for user/operator execution only, after readiness checks.

## 2. Exposure-driven rotation requirements

| Credential / asset | Exposure evidence (non-secret) | Rotation required | Status | Notes |
|---|---|---|---|---|
| Supabase **Service Role Key** (project `bzkjtvsqqxnbbnkgcrko`, per `backend/.env` `SUPABASE_URL`) | Hardcoded in untracked local scripts `backend/__check_pg.cjs`, `backend/__check_rest.cjs`, `backend/__check_rls.cjs`, `backend/__check_rls2.cjs` (quarantined outside repo during remediation; not tracked). Git history scan for the secret-key marker found **no matches**. Local `backend/.env` contains a service-role key value (gitignored, not tracked) — treat as sensitive and rotate if it may have been shared/copied. | **REQUIRED** (treat as exposed) | **BLOCKED (pending user/operator execution and coordinated rollout)** | Service role bypasses RLS; highest priority. Do not continue using exposed value. |
| Supabase **Database Password** / `DATABASE_URL` credentials (project `bzkjtvsqqxnbbnkgcrko`) | Hardcoded in untracked local script `backend/__check_pg.cjs` (quarantined outside repo). Git history scan for the DB-password marker found **matches** in commit `6686f7c9...` (historical exposure in repository history). Local `backend/.env` contains `DATABASE_URL` credentials (gitignored, not tracked). | **REQUIRED** (treat as exposed, including history exposure) | **BLOCKED (pending user/operator execution and coordinated rollout)** | History exposure means old clones/forks/logs may retain the value; rotate regardless of current working-tree cleanup. |
| Supabase **Anon Key** (project `bzkjtvsqqxnbbnkgcrko`) | Present in local `backend/.env` (gitignored, not tracked); no hardcoded anon-key exposure found in the quarantined `__check_*.cjs` scripts. | **RECOMMENDED (verify)** | **NOT STARTED** | Public by design but project-bound; rotate if believed exposed or during coordinated key rotation. |
| `JWT_SECRET` (backend auth/custom tokens) | Present in local `backend/.env` (gitignored, not tracked); no direct evidence of exposure in scanned tracked source. | **RECOMMENDED (verify)** | **NOT STARTED** | Rotating invalidates existing app JWT sessions/tokens; coordinate carefully. |
| Vercel OIDC token (`.env.local`, `VERCEL_OIDC_TOKEN`) | Present in local `.env.local` (gitignored, not tracked). Token-like value detected by local inspection; not printed here. | **RECOMMENDED (verify/reissue)** | **NOT STARTED** | Local CLI/session token; reissue/re-authenticate via Vercel CLI if exposed or stale. Not an app runtime secret. |
| Other API secrets (Google/LINE/Facebook/social secrets, Render/Vercel env secrets) | No hardcoded values found in remediated `__check_*.cjs` files. Admin UI stores provider secrets server-side; operational env values on Render/Vercel were not accessible. | **VERIFY** | **UNVERIFIED** | Confirm in provider dashboards and deployment env stores during rotation window. |

## 3. Pre-rotation readiness checks (must be satisfied before rotate/revoke)

1. **Identify all consumers of each credential** (do not guess):
   - Render service `kindee-marketplace-api` environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `JWT_SECRET`, etc.) — **user must inspect**.
   - Vercel project `kindee-marketplace` environment variables (frontend/backend as applicable) — **user must inspect**.
   - Local developer environments (`backend/.env`, other local secrets stores) — operator responsibility.
   - CI/CD, scripts, cron jobs, Supabase CLI linked sessions, and any external integrations using the same project credentials.
2. **Confirm target project identity** before generating new credentials:
   - Intended staging project ref: `bzkjtvsqqxnbbnkgcrko` (per task objective and prior verification evidence).
   - Forbidden project ref must not be used: `henhkouetfjelkqsfzgu`.
   - Confirm in Supabase Dashboard that the project receiving rotation is the correct staging project and not production.
3. **Confirm production/staging separation** (see remediation report): if `bzkjtvsqqxnbbnkgcrko` is actually used by production, rotation is a production-impacting change and requires production change control.
4. **Prepare rollback/continuity plan**:
   - Schedule a maintenance/change window if required.
   - Have access to Supabase Dashboard, Render, and Vercel ready.
   - Prepare updated values in a secure secret manager (never in git, chat, or terminal history).
5. **Do not revoke old credentials** until all dependent systems are updated and validated with the new credentials.

## 4. Supabase Service Role Key rotation steps (operator-executed)

> Execute only after Section 3 readiness checks pass.

1. In Supabase Dashboard, open project `bzkjtvsqqxnbbnkgcrko` (verify ref in URL/settings).
2. Navigate to **Project Settings → API** (or the current Supabase key management location).
3. Generate/rotate the **service_role** key according to Supabase's supported flow (prefer a flow that allows staged rollout if available).
4. Update consumers in a controlled order:
   - Secure secret store / password manager (source of truth).
   - Render `kindee-marketplace-api` → Environment → `SUPABASE_SERVICE_ROLE_KEY` (**user action; not performed by this task**).
   - Vercel project env vars if any server/runtime component uses it (**user action; not performed by this task**).
   - Local `backend/.env` and any local tooling that requires it.
5. Restart/redeploy affected services as required by the platform so new env values take effect.
6. Validate:
   - Backend health/startup without Supabase auth/config errors.
   - Authenticated admin/server operations that require service-role access (in staging only).
   - No RLS-bypass regressions introduced by misconfiguration.
7. Revoke/disable the old service-role key only after validation confirms no consumer still depends on it.
8. Re-scan local machines/repos for accidental copies of the old key; ensure quarantined files remain outside source control and are securely deleted when no longer needed.

**Impact considerations:** service-role rotation breaks any server process, script, edge function, or integration still using the old key. Expect immediate auth failures for admin operations until all consumers are updated.

## 5. Database password / `DATABASE_URL` rotation steps (operator-executed)

> Execute only after Section 3 readiness checks pass. Git history exposure means rotation is mandatory even if current files are clean.

1. In Supabase Dashboard, open project `bzkjtvsqqxnbbnkgcrko` → **Project Settings → Database**.
2. Reset/rotate the database password using Supabase's supported mechanism.
3. Obtain the new connection string(s) from Dashboard (direct/pooler as appropriate for each consumer). Do not reuse old leaked values.
4. Update consumers:
   - Render `kindee-marketplace-api` → `DATABASE_URL` (**user action; not performed by this task**).
   - Vercel env vars if applicable (**user action; not performed by this task**).
   - Local `backend/.env` and migration/maintenance tooling.
   - Supabase CLI connection configuration **only if** explicitly needed and after CLI is safely linked to `bzkjtvsqqxnbbnkgcrko` (see Section 7).
5. Restart/redeploy affected services.
6. Validate connectivity and application behavior in staging:
   - API startup and DB-dependent endpoints.
   - Existing regression tests (local/safe) as appropriate.
   - No migration commands run as part of rotation unless separately approved.
7. Confirm old password no longer works for direct/pooler connections where applicable.
8. Treat all historical copies (old clones, backups, terminal logs, CI logs, chat transcripts outside this report's control) as potentially compromised; communicate rotation to collaborators as needed.

**Impact considerations:** DB password rotation breaks all direct Postgres connections, pooler connections, and tools using `DATABASE_URL` until updated. Coordinate to avoid partial outages.

## 6. Render / Vercel / local impact checklist

| Environment | Expected impact | Required user/operator action | Performed in this task |
|---|---|---|---|
| **Render** (`kindee-marketplace-api`) | API may fail to access Supabase until env vars updated and redeployed/restarted | Inspect env vars, update rotated values, redeploy/restart, validate | **No** (forbidden to change) |
| **Vercel** (`kindee-marketplace`) | Frontend usually unaffected by service-role/DB password unless server-side envs exist; OIDC/local CLI token is separate | Inspect project env vars, update if any Supabase server secrets exist, revalidate build/runtime | **No** (forbidden to change) |
| **Local** (`backend/.env`, `.env.local`, developer machines) | Local dev/scripts break until updated | Replace values from secure source, clear shell history if secrets were pasted, re-auth Vercel/Supabase CLI as needed | **No** (local secret values not modified) |
| **Supabase CLI** | Link/auth may be affected if tokens/passwords change; wrong link is a separate risk | Follow Section 7; do not run migration commands | **No** (assessment only) |

## 7. Supabase CLI safety assessment

**Observed state (read-only):**
- Supabase CLI installed: `2.122.0` (`supabase --version`).
- Tracked CLI metadata currently points to **forbidden** project ref:
  - `supabase/.temp/project-ref` = `henhkouetfjelkqsfzgu`
  - `supabase/.temp/linked-project.json` references `henhkouetfjelkqsfzgu` (name/org metadata present in file)
- These files are tracked by git (historically added); `.gitignore` has been updated in this remediation to ignore `supabase/.temp/` going forward, but existing tracked files remain tracked until explicitly handled in a separate approved change (not performed here).

**Safety assessment:** **UNSAFE for migration/db commands until corrected.** Any command that targets the linked remote project (e.g. `supabase db push`, `supabase migration up`, `supabase db reset --linked`, link-dependent operations) risks affecting the forbidden project. **Do not run such commands.**

**Safe handling procedure (to be executed by user/operator when ready):**
1. **Do not run** `supabase db push`, `supabase migration up`, `supabase db reset`, or any command that mutates a remote database.
2. Verify login/context: `supabase projects list` or `supabase --version` are informational but may require auth; if credentials/login are required, stop and authenticate securely outside this automated task.
3. Check current link: `supabase status` / inspect `supabase/.temp/project-ref` (read-only).
4. Unlink local link state if needed: `supabase unlink` (local CLI state). This is safer than linking to an unknown target, but confirm CLI behavior/version first.
5. Link to the correct staging project **only** with explicit user confirmation and required credentials:
   - Preferred safe target: `bzkjtvsqqxnbbnkgcrko`.
   - `supabase link --project-ref bzkjtvsqqxnbbnkgcrko` may require Supabase access token / database password / interactive login depending on CLI/auth state. **If credentials or interactive confirmation are required, stop and obtain them from the user before proceeding.**
6. After linking, verify `supabase/.temp/project-ref` contains `bzkjtvsqqxnbbnkgcrko` and **never** `henhkouetfjelkqsfzgu`.
7. Keep `supabase/.temp/` untracked/ignored (policy added); avoid committing project-specific link metadata.
8. Even when correctly linked, **migrations 010/011 remain forbidden** in this phase.

## 8. Rotation execution status

| Item | Status |
|---|---|
| Supabase Service Role Key rotation | **REQUIRED / NOT COMPLETED** (blocked pending user/operator execution) |
| Database password / `DATABASE_URL` rotation | **REQUIRED / NOT COMPLETED** (blocked pending user/operator execution) |
| Anon key rotation | **RECOMMENDED / NOT COMPLETED** |
| `JWT_SECRET` rotation | **RECOMMENDED / NOT COMPLETED** |
| Vercel OIDC token reissue/verification | **RECOMMENDED / NOT COMPLETED** |
| Render/Vercel env var updates | **NOT PERFORMED** (forbidden in this task) |
| Credential revoke after validation | **NOT PERFORMED** |

**This report must not be interpreted as evidence that rotation succeeded.**

## 9. User/operator actions required

1. Confirm whether `bzkjtvsqqxnbbnkgcrko` is staging-only and not used by production (Render/Vercel evidence required).
2. Rotate the exposed Supabase Service Role Key for `bzkjtvsqqxnbbnkgcrko` in Supabase Dashboard.
3. Rotate the exposed database password for `bzkjtvsqqxnbbnkgcrko` in Supabase Dashboard (mandatory due to history exposure).
4. Update Render `kindee-marketplace-api` and Vercel/local env stores with new credentials in a coordinated rollout.
5. Validate staging services, then revoke old credentials.
6. Securely delete quarantined local check scripts from temp storage after confirming they are no longer needed.
7. Fix Supabase CLI link to `bzkjtvsqqxnbbnkgcrko` (or unlink) using approved credentials/confirmation; never target `henhkouetfjelkqsfzgu`.
8. Review git history exposure implications (old clones/forks/logs may contain leaked DB password marker context) and take organizational incident-response steps as appropriate.
