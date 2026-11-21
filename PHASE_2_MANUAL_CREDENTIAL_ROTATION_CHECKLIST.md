# Phase 2 — Manual Credential Rotation Checklist

**Date:** 2026-11-18
**Repository:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`
**Remote:** `https://github.com/wealthysage3889-sys/kindee-marketplace.git`
**Branch:** `main`

**Audience:** Repository owner / operator with Supabase, Render, and Vercel dashboard access.

**Purpose:** Rotate credentials that may have been exposed (Supabase Service Role Key, Database Password) and verify each environment (Local / Render / Vercel) uses the new values. This document contains **no secret values** — only procedures.

---

## 0. Ground Rules (read first)

- This checklist is executed **manually by the operator** in the respective dashboards. Do not paste real secret values into any file tracked by Git.
- Target project ref (intended): `bzkjtvsqqxnbbnkgcrko`.
- Forbidden project ref (must never be targeted by the CLI): `henhkouetfjelkqsfzgu`.
- **Order matters:** provision the new value everywhere (Render → Vercel → Local) **before** revoking the old value. Never revoke first.
- Confirm with the repository owner before any production-impacting change.
- Keep old and new values side by side until all environments are verified, then revoke.

**Prerequisites checklist (operator):**
- [ ] I can log in to the Supabase Dashboard and see project `bzkjtvsqqxnbbnkgcrko`.
- [ ] I can log in to the Render Dashboard and open service `kindee-marketplace-api`.
- [ ] I can log in to the Vercel Dashboard and open project `kindee-marketplace`.
- [ ] I have a safe place to record the new values (password manager / secret manager), not a tracked file.

---

## 1. Supabase Service Role Key Rotation

Project: `bzkjtvsqqxnbbnkgcrko`

1. Open Supabase Dashboard → project `bzkjtvsqqxnbbnkgcrko` → **Project Settings → API**.
2. Under **Project API keys**, find `service_role` (secret).
3. Click **Generate new key / Roll** (create a new service role key). Store the **new** key in your secret manager. Do **not** write it into any file.
4. Do not revoke the old key yet (continue to Section 3 & 4 to distribute the new key).
5. Verification: the new key authenticates to `https://bzkjtvsqqxnbbnkgcrko.supabase.co` (returns valid responses, not 401).

> Note: The service role key bypasses Row Level Security. Treat it as the highest-sensitivity value.

---

## 2. Database Password Rotation

Project: `bzkjtvsqqxnbbnkgcrko`

1. Open Supabase Dashboard → project `bzkjtvsqqxnbbnkgcrko` → **Project Settings → Database → Database password**.
2. Generate a new strong password (or **Reset database password**). Record the **new** password and the resulting connection string(s):
   - Direct connection: `db.bzkjtvsqqxnbbnkgcrko.supabase.co`
   - Pooled (Supavisor/pgBouncer) connection: as shown in **Connect** dialog (Transaction / Session pooler).
3. Do **not** revoke/rotate again until all environments are updated (Sections 3 & 4).
4. Verification: connect with the new password via the pooler URL and run `SELECT 1;`.

> History exposure: the database password appeared in historical repository content during earlier work. Rotate **regardless** of current working-tree cleanup.

---

## 3. Render Environment Variable Update (`kindee-marketplace-api`)

1. Open Render Dashboard → service `kindee-marketplace-api` → **Environment**.
2. Update these variables with the **new** values (from Sections 1–2):
   - `SUPABASE_SERVICE_ROLE_KEY` → new service role key
   - `SUPABASE_URL` → confirm it is `https://bzkjtvsqqxnbbnkgcrko.supabase.co`
   - `DATABASE_URL` → new pooled/direct connection string (with new password)
3. Confirm `SUPABASE_URL` / `DATABASE_URL` reference the **intended** project ref `bzkjtvsqqxnbbnkgcrko` (not `henhkouetfjelkqsfzgu`).
4. Save → Render triggers a redeploy. Wait for the deploy to report **live**.
5. Verification:
   - [ ] Render deploy logs show a healthy start (no `Supabase service role key is missing` / auth errors).
   - [ ] `GET https://<your-api-host>/api/health` (or equivalent) returns 200.
   - [ ] A read query through the API succeeds.

---

## 4. Local Environment Update

Files (all **gitignored**, never committed): `backend/.env`

1. Edit `backend/.env` and set:
   - `SUPABASE_URL=https://bzkjtvsqqxnbbnkgcrko.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=<new service role key>`
   - `DATABASE_URL=<new connection string with new password>`
   - Confirm `SUPABASE_ANON_KEY` is updated if you choose to rotate it (Section 6).
2. Do **not** commit `backend/.env` (verify with `git status` — it must not appear).
3. Restart the backend and verify:
   - [ ] Server starts without missing-key errors.
   - [ ] `npm --prefix backend test` → 206/206 pass.
   - [ ] A live API call to Supabase succeeds.

---

## 5. Vercel Environment Verification (`kindee-marketplace`)

1. Open Vercel Dashboard → project `kindee-marketplace` → **Settings → Environment Variables**.
2. The frontend does **not** call Supabase directly (no `VITE_SUPABASE_*` expected). Confirm:
   - [ ] No `VITE_SUPABASE_*` / service-role values exist in Vercel env (if they do, remove them — the frontend must never hold a service role key).
   - [ ] `VITE_API_BASE` points to the Render backend URL (no `localhost` in production).
3. If any Supabase secret is present in Vercel, replace with the new value **or** delete (preferred) and redeploy.
4. Verification: production frontend loads and reaches the backend without auth errors.

---

## 6. Credential Revocation (only after Sections 3–5 verified)

1. Supabase Dashboard → `bzkjtvsqqxnbbnkgcrko` → **Project Settings → API**:
   - Revoke/roll the **old** service role key (the one previously in use). Keep the new key active.
2. Confirm the old database password no longer works (old connection string fails; new one succeeds).
3. (Optional) Rotate `anon` key if there is any reason to believe it was exposed.
4. Post-revocation sanity:
   - [ ] Render still live and serving traffic.
   - [ ] Local backend still connects.
   - [ ] No 401s in Render logs.

> If anything fails after revocation, roll back by restoring the previous value in Render/Vercel/Local **immediately**, then re-plan.

---

## 7. Post-Rotation Connectivity Verification

Run through each environment once more with the new credentials:

- [ ] **Supabase** — new service role key + new DB password authenticate to `bzkjtvsqqxnbbnkgcrko`.
- [ ] **Render** `kindee-marketplace-api` — live, healthy, no auth errors in logs.
- [ ] **Vercel** `kindee-marketplace` — production frontend reaches backend successfully.
- [ ] **Local** — `npm --prefix backend test` = 206/206 pass; server boots cleanly.
- [ ] **Old credentials rejected** — old key/password fail; new succeed.
- [ ] **No secrets in Git** — `git status` shows no `.env` staged; run a local secret scan (see Section 8).

---

## 8. Secret Scanning / Ignore Rules (already applied locally)

- `.gitignore` ignores: `.env`, `.env.local`, `.env.*.local`, `.env*`, `backend/__check_*.cjs`, `**/__check_*.cjs`, and `supabase/.temp/`.
- `supabase/.temp/` CLI metadata was **untracked** (`git rm --cached`, files kept on disk) so the CLI link (currently the forbidden ref) is no longer version-controlled.
- Recommended CI/local scan (do not commit real values):
  - `git grep -nE "eyJ[A-Za-z0-9_-]{20,}|sb_secret_|sk_live_|sk_test_|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH|PRIVATE)-----" -- . ":(exclude)*.md"`
  - Optionally add a secret scanner (e.g. `gitleaks`) to CI on pull requests.

---

## 9. Rollback Summary

| Symptom | Action |
|---------|--------|
| Render fails after new env vars | Revert env to previous values in Render, redeploy |
| Local cannot connect | Restore previous `backend/.env` values |
| Old key still works after "revocation" | Re-roll key; confirm old key removed in dashboard |
| Frontend auth errors | Verify `VITE_API_BASE`; ensure no service role key in Vercel |

**Checkpoint:** This checklist is BLOCKED on operator/dashboard access. Local and repo-side work (gitignore, untracking CLI temp, env verification of local ref, test suite) is complete. Resume at Section 1 once the operator has dashboard access and approved credentials.