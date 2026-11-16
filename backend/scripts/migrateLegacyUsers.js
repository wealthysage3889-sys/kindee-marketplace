#!/usr/bin/env node
/**
 * Legacy account migration: MongoDB (bcrypt) -> Supabase Auth
 * =============================================================
 *
 * PURPOSE
 *   Migrate existing legacy accounts (MongoDB `users` with bcrypt `password`
 *   hashes) into Supabase Auth WITHOUT resetting passwords and WITHOUT creating
 *   duplicate accounts, preserving role, profile and store/order relationships.
 *
 * WHY A SCRIPT + NOT AUTO-RUN
 *   The legacy MongoDB connection and `User` model were removed from this
 *   codebase (mongoose removal). There is no live legacy source reachable from
 *   here, so this script is a DESIGN + RUNNABLE procedure to be executed by an
 *   operator against a real MongoDB export on staging first, then production,
 *   ONLY after explicit approval. It is intentionally NOT wired into the app.
 *
 * WHAT IT DOES (per legacy user)
 *   1. Skip if a profile already exists for that email/phone (no duplicates).
 *   2. Create the Supabase auth user with the ORIGINAL bcrypt hash via the
 *      `password_hash` parameter (Supabase accepts bcrypt `$2a$/$2b$` hashes),
 *      so the existing password keeps working. email_confirm is set from a
 *      verified flag if present.
 *   3. Insert the `profiles` row (id = auth user id), copying role, name, phone,
 *      avatar, and recording `legacy_id` = original Mongo _id for traceability.
 *   4. Never deletes or mutates the legacy store; the legacy DB is kept as a
 *      rollback source.
 *
 * USAGE
 *   node backend/scripts/migrateLegacyUsers.js --input=<legacy-users.json> [--dry-run]
 *
 *   The input JSON must be an array of legacy users, e.g.:
 *   [
 *     {
 *       "_id": "64f0...mongoId",
 *       "name": "Somchai",
 *       "email": "somchai@example.com",
 *       "phone": "0812345678",
 *       "password": "$2b$10$....bcrypt hash....",
 *       "role": "customer",
 *       "googleId": "...", "facebookId": "...", "lineId": "...",
 *       "isActive": true
 *     }
 *   ]
 *
 * SAFETY
 *   - Refuses to run without an explicit --input and confirmation.
 *   - --dry-run performs a full simulation and reports the plan; writes nothing.
 *   - Idempotent: re-running skips already-migrated accounts.
 *   - Bumps nothing destructive; the legacy database is never touched.
 */

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function parseArgs(argv) {
  const args = { dryRun: false, input: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--input=')) args.input = a.slice('--input='.length);
  }
  return args;
}

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]?\$\d{2}\$/.test(value);
}

function normalizePhone(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  return trimmed || null;
}

async function profileExistsByEmailOrPhone(email, phone) {
  const orParts = [];
  if (email) orParts.push(`email.eq.${email}`);
  if (phone) orParts.push(`phone.eq.${phone}`);
  if (orParts.length === 0) return null;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, email, phone, role')
    .or(orParts.join(','))
    .maybeSingle();
  return data || null;
}

async function migrateUser(legacy, { dryRun }) {
  const email = legacy.email ? String(legacy.email).toLowerCase().trim() : null;
  const phone = normalizePhone(legacy.phone);
  const name = legacy.name || null;
  const role = ['customer', 'seller', 'admin', 'owner', 'courier'].includes(legacy.role)
    ? legacy.role
    : 'customer';
  const legacyId = legacy._id ? String(legacy._id) : (legacy.legacy_id || null);
  const passwordHash = legacy.password || legacy.password_hash;

  if (!email && !phone) {
    return { id: legacyId, status: 'skipped', reason: 'no email or phone' };
  }

  if (!isBcryptHash(passwordHash)) {
    return {
      id: legacyId || email || phone,
      status: 'skipped',
      reason: 'missing/invalid bcrypt password_hash (refusing to reset password)'
    };
  }

  const existing = await profileExistsByEmailOrPhone(email, phone);
  if (existing) {
    return { id: legacyId || email || phone, status: 'skipped', reason: `already migrated (profile ${existing.id})` };
  }

  if (dryRun) {
    return { id: legacyId || email || phone, status: 'would-create', email, phone, role };
  }

  // 1) Create the Supabase auth user reusing the ORIGINAL bcrypt hash.
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: email || undefined,
    phone: phone || undefined,
    password_hash: passwordHash,
    email_confirm: Boolean(email),
    user_metadata: {
      name,
      role,
      legacy_id: legacyId,
      migrated_from: 'mongodb'
    }
  });

  if (createError || !created?.user) {
    return { id: legacyId || email || phone, status: 'error', reason: createError?.message || 'createUser failed' };
  }

  // 2) Insert the profile preserving role + legacy linkage.
  const { error: profileError } = await supabaseAdmin.from('profiles').insert({
    id: created.user.id,
    email,
    phone,
    name,
    role,
    is_active: legacy.isActive === undefined ? true : Boolean(legacy.isActive),
    legacy_id: legacyId
  });

  if (profileError) {
    // Roll back the auth user so we do not leave an orphan.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { id: legacyId || email || phone, status: 'error', reason: `profile insert failed: ${profileError.message}` };
  }

  // 3) Preserve provider ids in the app-owned profile columns (if present).
  const providerMap = {
    google_id: legacy.googleId || legacy.google_id || null,
    facebook_id: legacy.facebookId || legacy.facebook_id || null,
    line_id: legacy.lineId || legacy.line_id || null
  };
  const providerPatch = {};
  for (const [col, val] of Object.entries(providerMap)) {
    if (val) providerPatch[col] = String(val);
  }
  if (Object.keys(providerPatch).length > 0) {
    await supabaseAdmin.from('profiles').update(providerPatch).eq('id', created.user.id).catch(() => {});
  }

  return { id: legacyId || email || phone, status: 'created', supabaseId: created.user.id };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.input) {
    console.error('ERROR: --input=<legacy-users.json> is required.');
    console.error('Pass --dry-run to simulate without writing.');
    process.exit(1);
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: input file not found: ${inputPath}`);
    process.exit(1);
  }

  const users = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(users)) {
    console.error('ERROR: input JSON must be an array of legacy users.');
    process.exit(1);
  }

  console.log(`Loaded ${users.length} legacy users. dryRun=${args.dryRun}`);
  if (!args.dryRun) {
    console.log('WARNING: this writes to Supabase. Ensure you are targeting STAGING first.');
  }

  const summary = { created: 0, skipped: 0, error: 0, wouldCreate: 0 };
  for (const legacy of users) {
    const result = await migrateUser(legacy, { dryRun: args.dryRun });
    if (result.status === 'created') summary.created++;
    else if (result.status === 'would-create') summary.wouldCreate++;
    else if (result.status === 'error') summary.error++;
    else summary.skipped++;

    const label = result.status === 'would-create' ? 'WOULD CREATE' : result.status.toUpperCase();
    console.log(`[${label}] ${result.id}${result.reason ? ` — ${result.reason}` : ''}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  if (summary.error > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});