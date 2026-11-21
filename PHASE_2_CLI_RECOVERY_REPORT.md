# Phase 2 — Supabase CLI Recovery Report

**Date:** 2026-11-18
**Repository:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`
**Remote:** `https://github.com/wealthysage3889-sys/kindee-marketplace.git`
**Branch:** `main`

**Scope:** Verify the Supabase CLI link state, determine whether it can be safely relinked, and prepare (but **not execute**) relink commands. **No** `supabase link`, `unlink`, `db push`, `db reset`, `migration up`, or schema command was run.

---

## 1. Status Summary

| Item | Status |
|------|--------|
| Supabase CLI installed | **PASS** — version `2.122.0` |
| Currently linked project | **FAIL (risk)** — linked to forbidden ref `henhkouetfjelkqsfzgu` |
| Link metadata location | `supabase/.temp/project-ref`, `supabase/.temp/linked-project.json` |
| Local `supabase/config.toml` wrong ref | **PASS** — no `config.toml` with a wrong `project_id` found |
| CLI link metadata tracked in Git | **FIXED** — `supabase/.temp/` untracked (files kept on disk); `.gitignore` ignores it |
| Target ref `bzkjtvsqqxnbbnkgcrko` reachable | **BLOCKED** — not in logged-in account's project list; no access token |
| Relink executed | **NOT DONE** (per constraints — requires credentials + confirmation) |
| Migration / db push / db reset | **NOT RUN** (per constraints) |

---

## 2. Evidence

### 2.1 CLI version
```
supabase --version  →  2.122.0
```

### 2.2 Link state (metadata)
- `supabase/.temp/project-ref` = `henhkouetfjelkqsfzgu`  ← **forbidden ref**
- `supabase/.temp/linked-project.json`:
  - `ref`: `henhkouetfjelkqsfzgu`
  - `name`: "jaotai1992-collab's Project"
  - `organization_id`: `uspdgppqximppuzcegsa`
  - `organization_slug`: `uspdgppqximppuzcegsa`
- `supabase/.temp/pooler-url` host = `aws-0-ap-southeast-2.pooler.supabase.com:5432` (no inline password).

### 2.3 `supabase projects list`
```
     LINKED | ORG ID               | REFERENCE ID         | NAME                        | REGION           | CREATED AT (UTC)
        ●   | uspdgppqximppuzcegsa | henhkouetfjelkqsfzgu | jaotai1992-collab's Project | Oceania (Sydney) | 2026-09-13 16:04:34
```
→ The logged-in account can see **only** the forbidden project `henhkouetfjelkqsfzgu`. The intended target `bzkjtvsqqxnbbnkgcrko` is **not** accessible with current credentials.

### 2.4 Credentials / auth availability
- `SUPABASE_ACCESS_TOKEN` env: **NOT SET**
- `~/.supabase/access-token` file: **NOT FOUND**

### 2.5 Local project config
- No `supabase/config.toml` present with a wrong `project_id`/`ref`. (Only the `.temp/` link metadata carries the ref, and it is now untracked.)

---

## 3. Assessment

The Supabase CLI is currently **linked to the forbidden ref `henhkouetfjelkqsfzgu`**. Any `supabase db push` / `migration up` / `db reset` executed in this state would target that project — this must not happen.

Relinking to the intended target `bzkjtvsqqxnbbnkgcrko` is currently **not possible** because:
1. The logged-in Supabase account has no access to `bzkjtvsqqxnbbnkgcrko` (not in `projects list`).
2. No `SUPABASE_ACCESS_TOKEN` and no access-token file are available.

Therefore relink is **BLOCKED** pending (a) an account/token that can access `bzkjtvsqqxnbbnkgcrko`, and (b) explicit operator confirmation that `bzkjtvsqqxnbbnkgcrko` is the correct target and not production.

---

## 4. Prepared Relink Commands (do NOT run until Section 5 satisfied)

Run from repo root `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`.

### Option A — Relink to intended target (preferred, after approval)
```powershell
# 1. Provide an access token for an account that can see bzkjtvsqqxnbbnkgcrko
$env:SUPABASE_ACCESS_TOKEN = "<approved-token>"

# 2. Confirm the target is visible
supabase projects list        # must list bzkjtvsqqxnbbnkgcrko

# 3. Relink (will prompt for DB password; have the target DB password ready)
supabase link --project-ref bzkjtvsqqxnbbnkgcrko

# 4. Verify the link changed and NEVER shows the forbidden ref
Get-Content supabase/.temp/project-ref      # expect: bzkjtvsqqxnbbnkgcrko
Get-Content supabase/.temp/linked-project.json
```

### Option B — Unlink (if you prefer to fully detach the CLI until ready)
```powershell
supabase unlink
# Verify removal
Test-Path supabase/.temp/project-ref        # expect: False
```

### Post-link safety verification (read-only, after Option A)
```powershell
supabase migration list --linked            # confirm history against intended project only
# DO NOT run: supabase db push / db reset / migration up until explicitly authorized
```

---

## 5. Preconditions Before Executing Section 4

- [ ] Owner confirms `bzkjtvsqqxnbbnkgcrko` is the correct target and is **not** the production DB (or, if it is production, change control is approved).
- [ ] An approved Supabase access token / login with access to `bzkjtvsqqxnbbnkgcrko` is available.
- [ ] Target database password is available (needed by `supabase link`).
- [ ] Explicit approval to run `supabase link` (this is a state-changing command).

Until all are checked, the CLI must remain unlinked or untouched. **No migration/schema command may run.**

---

## 6. Actions Taken This Session

- Verified CLI version and link state (forbidden ref confirmed).
- Confirmed no wrong-ref `config.toml`.
- Untracked `supabase/.temp/` from Git (files kept on disk) so the CLI link (forbidden ref) is no longer version-controlled; `.gitignore` ignores it.
- Prepared relink/unlink commands and preconditions (Section 4–5).
- **Did not** run `link`, `unlink`, `db push`, `db reset`, `migration up`, or any schema command.
- **Did not** modify Render/Vercel/production anything.

---

## 7. Checkpoint

- **CLI link fix: BLOCKED** on approved credentials + operator confirmation.
- Local/repo-side CLI hygiene (untracking temp metadata, gitignore) is **COMPLETE**.
- Resume at Section 4 Option A once Section 5 preconditions are met.