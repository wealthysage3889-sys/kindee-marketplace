import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasUrl = Boolean(supabaseUrl);
const hasAnonKey = Boolean(supabaseAnonKey);
const hasServiceKey = Boolean(supabaseServiceKey);

// The API needs the service role key for server-side reads/writes (bypasses RLS).
// The anon key is optional: it is only used for user-facing auth calls.
export const isSupabaseConfigured = hasUrl && hasServiceKey;

if (!hasUrl) {
  console.error('Supabase is not configured. Set SUPABASE_URL before starting the API.');
} else if (!hasServiceKey) {
  console.error(
    'Supabase service role key is missing. Set SUPABASE_SERVICE_ROLE_KEY ' +
    'so the API can read and write data.'
  );
}

if (hasUrl && !hasAnonKey) {
  console.warn(
    'SUPABASE_ANON_KEY is not set. Password/OAuth sign-in endpoints that use the ' +
    'anon client will be unavailable.'
  );
}

const authOptions = {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false
  }
};

// Client for user-facing auth operations (with RLS)
export const supabase = hasUrl && hasAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, authOptions)
  : null;

// Admin client for server-side operations (bypasses RLS)
export const supabaseAdmin = hasUrl && hasServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Auth client usable for token verification even when the anon key is absent
export const supabaseAuth = supabase || supabaseAdmin;

// Helper to create client with user's access token
export const createUserClient = (accessToken) => {
  if (!supabase) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

// Get admin client (throws if not available)
export const getAdminClient = () => {
  if (!supabaseAdmin) {
    throw new Error(
      'Supabase service role key not configured. Cannot perform admin operations.'
    );
  }
  return supabaseAdmin;
};