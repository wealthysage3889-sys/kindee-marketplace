import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Admin credentials MUST come from environment variables, never hardcoded.
// Set ADMIN_EMAIL and ADMIN_PASSWORD in .env (or the deploy secret store).
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_ROLE = process.env.ADMIN_ROLE || 'admin';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env (or the secret store).');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function createAdmin() {
  try {
    console.log('Checking if admin user already exists...');

    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, role')
      .eq('email', ADMIN_EMAIL)
      .single();

    if (existingProfile) {
      console.log(`Admin user already exists: ${existingProfile.email} (role: ${existingProfile.role})`);
      if (existingProfile.role !== ADMIN_ROLE) {
        const { data: updated, error: updErr } = await supabaseAdmin
          .from('profiles')
          .update({ role: ADMIN_ROLE, is_active: true })
          .eq('id', existingProfile.id)
          .select()
          .single();
        if (updErr) {
          console.error(`Failed to update role: ${updErr.message}`);
          process.exit(1);
        }
        console.log(`Updated role to '${ADMIN_ROLE}' for user ${updated.email}`);
      }
      console.log('Admin account is ready.');
      return;
    }

    console.log(`Creating Supabase auth user: ${ADMIN_EMAIL}...`);

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Admin', role: ADMIN_ROLE }
    });

    if (authError) {
      if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
        console.log('Auth user already exists, proceeding to ensure profile...');
      } else {
        console.error(`Auth creation failed: ${authError.message}`);
        process.exit(1);
      }
    }

    const authUserId = authData?.user?.id;

    let fallbackUserId = null;
    if (!authUserId) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers();
      const found = users.users.find(u => u.email === ADMIN_EMAIL);
      if (!found) {
        console.error('Could not determine auth user ID after creation.');
        process.exit(1);
      }
      fallbackUserId = found.id;
      console.log(`Found existing auth user ID: ${fallbackUserId}`);
    }

    const finalUserId = authUserId || fallbackUserId;

    console.log(`Creating profile in public.profiles with role='${ADMIN_ROLE}'...`);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: finalUserId,
        email: ADMIN_EMAIL,
        name: 'Admin',
        role: ADMIN_ROLE,
        is_active: true
      })
      .select()
      .single();

    if (profileError) {
      console.error(`Profile creation failed: ${profileError.message}`);
      if (authData?.user?.id) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        console.log('Cleaned up auth user due to profile creation failure.');
      }
      process.exit(1);
    }

    console.log('Admin account created successfully!');
    console.log(`Email: ${profile.email}`);
    console.log(`Role: ${profile.role}`);
    console.log(`Is active: ${profile.is_active}`);
    console.log(`Profile ID: ${profile.id}`);
    console.log('');
    console.log('You can now log in at http://localhost:3000/selladmin/login');
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log('Password: (read from ADMIN_PASSWORD env; not printed for security)');
    console.log('IMPORTANT: rotate this admin password if it was ever committed or shared.');
  } catch (err) {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  }
}

createAdmin();
