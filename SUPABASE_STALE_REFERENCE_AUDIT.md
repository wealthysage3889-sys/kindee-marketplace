# SUPABASE_STALE_REFERENCE_AUDIT.md

## Scope
Read-only audit for stale Supabase project references in Kindee Marketplace.
No files edited, no Supabase CLI link/unlink, no migrations, no commit/push/deploy.

## Git status (before)
- Modified: `.gitignore`, backend controllers/services, `frontend/src/api/auth.js`
- Deleted (index): `supabase/.temp/*` (still present on disk)
- Untracked: many audit/report files and migrations

## Search target
- Stale/forbidden project ref: `henhkouetfjelkqsfzgu`
- Intended ref: `bzkjtvsqqxnbbnkgcrko`

## Results

### Active Runtime References
- `backend/config/supabase.js:3` reads `process.env.SUPABASE_URL`; `:46` creates service-role client from env. No hardcoded project ref.
- `backend/server.js:18` requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- `backend/scripts/migrateLegacyUsers.js:60`, `backend/scripts/createAdminSupabase.js:6` read env vars only.
- `backend/.env` (local, gitignored): `SUPABASE_URL` and `DATABASE_URL` reference `bzkjtvsqqxnbbnkgcrko` (values redacted).
- `backend/.env.test`: `SUPABASE_URL` = `test.supabase.co` (no project ref).
- `backend/.env.example`: placeholder `your-project-ref.supabase.co`.
- `frontend`: no Supabase references found (only `VITE_GOOGLE_CLIENT_ID`, `VITE_API_BASE`).

### Legacy/Unused References
- None in application source code. Stale ref appears only in Supabase CLI temp metadata and documentation.

### Test/Documentation References
- Tests use dummy `https://dummy.supabase.co` (`backend/__tests__/*.test.mjs`).
- Documentation/report files reference `henhkouetfjelkqsfzgu` (CLI metadata context) and `bzkjtvsqqxnbbnkgcrko`.

### Local CLI Metadata (STALE)
- `supabase/.temp/project-ref`: `henhkouetfjelkqsfzgu`
- `supabase/.temp/linked-project.json`: ref `henhkouetfjelkqsfzgu` (org `uspdgppqximppuzcegsa`)
- Other `.temp/*` version files belong to the CLI-linked forbidden project.

## Environment Loading
- Backend: `process.env` via `backend/config/supabase.js` and scripts; env files `backend/.env`, `backend/.env.test`, `backend/.env.example`.
- Frontend: no Supabase client initialization; API proxied via `vercel.json` to Render.

## Secret Handling
No secrets, tokens, passwords, or keys were read or displayed. Only project refs and file paths.

## Conclusion
- Application runtime references: VERIFIED — no stale `henhkouetfjelkqsfzgu` in source/config; runtime reads env.
- Local CLI metadata: UNVERIFIED/BLOCKED risk — still linked to `henhkouetfjelkqsfzgu`; not modified per read-only constraints.
- Render production env: BLOCKED (dashboard not accessible).
Status: VERIFIED (local source/config), UNVERIFIED (CLI metadata stale), BLOCKED (Render).
