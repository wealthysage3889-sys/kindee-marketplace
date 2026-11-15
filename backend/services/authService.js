import { supabase, supabaseAdmin, createUserClient } from '../config/supabase.js';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../middleware/auth.js';
import { AppError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import bcrypt from 'bcryptjs';

// Register new user
export const registerUser = async (userData) => {
  const { email, phone, password, name, role = 'customer' } = userData;
  
  // Validate role
  if (!['customer', 'seller'].includes(role)) {
    throw new AppError('Invalid role. Must be customer or seller', 400);
  }
  
  // Check if user exists
  const { data: existingUser } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .or(`email.eq.${email},phone.eq.${phone}`)
    .single();
  
  if (existingUser) {
    throw new ConflictError('Email or phone already registered');
  }
  
  // Create auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    phone,
    password,
    email_confirm: true,
    user_metadata: { name, role }
  });
  
  if (authError) {
    throw new AppError(`Auth creation failed: ${authError.message}`, 500);
  }
  
  // Create profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      email,
      phone,
      name,
      role,
      is_active: true
    })
    .select()
    .single();
  
  if (profileError) {
    // Cleanup auth user on profile creation failure
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    throw new AppError(`Profile creation failed: ${profileError.message}`, 500);
  }
  
  // Generate tokens
  const accessToken = generateToken(profile);
  const refreshToken = generateRefreshToken(profile);
  
  return {
    user: profile,
    accessToken,
    refreshToken
  };
};

// Login user
export const loginUser = async (emailOrPhone, password) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  // Find user by email or phone
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .or(`email.eq.${emailOrPhone},phone.eq.${emailOrPhone}`)
    .single();
  
  if (error || !profile) {
    throw new AppError('Invalid credentials', 401);
  }
  
  if (!profile.is_active) {
    throw new AppError('Account is deactivated', 403);
  }
  
  // Verify password with Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
  
  if (authError || !authData.user) {
    throw new AppError('Authentication error', 500);
  }
  
  // Sign in with password to verify
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password
  });

  if (signInError) {
    throw new AppError('Invalid credentials', 401);
  }

  const accessToken = generateToken(profile);
  const refreshToken = generateRefreshToken(profile);

  return {
    user: profile,
    accessToken,
    refreshToken
  };
};

// Social login (Google, Facebook, LINE)
export const socialLogin = async (provider, credential) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  let authData;
  
  switch (provider) {
    case 'google':
      const { data: googleData, error: googleError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: credential
      });
      if (googleError) throw new AppError(`Google login failed: ${googleError.message}`, 401);
      authData = googleData;
      break;
      
    case 'facebook':
      const { data: fbData, error: fbError } = await supabase.auth.signInWithIdToken({
        provider: 'facebook',
        token: credential
      });
      if (fbError) throw new AppError(`Facebook login failed: ${fbError.message}`, 401);
      authData = fbData;
      break;
      
    case 'line':
      // LINE requires custom implementation
      throw new AppError('LINE login not implemented yet', 501);
      
    default:
      throw new AppError('Invalid provider', 400);
  }
  
  if (!authData.user) {
    throw new AppError('Social login failed', 401);
  }
  
  // Check if profile exists
  let { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .single();
  
  if (!profile) {
    // Create profile from social data
    const userMeta = authData.user.user_metadata || {};
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authData.user.id,
        email: authData.user.email,
        name: userMeta.full_name || userMeta.name || 'User',
        avatar_url: userMeta.avatar_url || userMeta.picture,
        role: 'customer',
        is_active: true
      })
      .select()
      .single();
    
    if (profileError) {
      throw new AppError(`Profile creation failed: ${profileError.message}`, 500);
    }
    profile = newProfile;
  }
  
  if (!profile.is_active) {
    throw new AppError('Account is deactivated', 403);
  }
  
  const accessToken = generateToken(profile);
  const refreshToken = generateRefreshToken(profile);

  return {
    user: profile,
    accessToken,
    refreshToken
  };
};

// Get user profile
export const getProfile = async (userId) => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error || !profile) {
    throw new NotFoundError('User');
  }
  
  return profile;
};

// Update user profile
export const updateProfile = async (userId, updates) => {
  const allowedFields = ['name', 'phone', 'address', 'avatar_url'];
  const filteredUpdates = {};
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }
  
  if (Object.keys(filteredUpdates).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }
  
  // Check for unique constraints
  if (filteredUpdates.phone) {
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('phone', filteredUpdates.phone)
      .neq('id', userId)
      .single();
    
    if (existing) {
      throw new ConflictError('Phone number already in use');
    }
  }
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update(filteredUpdates)
    .eq('id', userId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Profile update failed: ${error.message}`, 500);
  }
  
  return profile;
};

// Change password
export const changePassword = async (userId, currentPassword, newPassword) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  // Verify current password
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: (await getProfile(userId)).email,
    password: currentPassword
  });
  
  if (verifyError) {
    throw new AppError('Current password is incorrect', 401);
  }
  
  // Update password
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword
  });
  
  if (updateError) {
    throw new AppError(`Password update failed: ${updateError.message}`, 500);
  }
  
  return { success: true };
};

// Refresh access token
export const refreshAccessToken = async (refreshToken) => {
  const decoded = verifyRefreshToken(refreshToken);

  if (decoded.type !== 'refresh') {
    throw new AppError('Invalid refresh token', 401);
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, name, role, avatar_url, phone, is_active')
    .eq('id', decoded.id)
    .single();

  if (error || !profile || !profile.is_active) {
    throw new AppError('Invalid refresh token', 401);
  }

  const accessToken = generateToken(profile);
  const newRefreshToken = generateRefreshToken(profile);

  return {
    accessToken,
    refreshToken: newRefreshToken
  };
};

// Logout (revoke refresh token)
export const logoutUser = async (refreshToken) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  // In Supabase, we can't directly revoke a specific refresh token
  // But we can sign out the user which invalidates all sessions
  await supabase.auth.signOut();
  
  return { success: true };
};

// Deactivate account
export const deactivateAccount = async (userId) => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: false })
    .eq('id', userId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Deactivation failed: ${error.message}`, 500);
  }
  
  // Sign out all sessions
  await supabaseAdmin.auth.admin.signOut(userId);
  
  return profile;
};

// Admin: Get all users
export const getAllUsers = async (filters = {}, pagination = {}) => {
  const { role, is_active, search } = filters;
  const { page = 1, limit = 20 } = pagination;
  
  let query = supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact' });
  
  if (role) query = query.eq('role', role);
  if (is_active !== undefined) query = query.eq('is_active', is_active);
  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch users: ${error.message}`, 500);
  }
  
  return {
    users: data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit)
    }
  };
};

// Admin: Update user role
export const updateUserRole = async (userId, newRole, adminId) => {
  if (!['customer', 'seller', 'admin', 'owner', 'courier'].includes(newRole)) {
    throw new AppError('Invalid role', 400);
  }
  
  // Prevent admin from changing owner role
  const { data: targetUser } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (targetUser?.role === 'owner' && newRole !== 'owner') {
    throw new AppError('Cannot change owner role', 403);
  }
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Role update failed: ${error.message}`, 500);
  }
  
  return profile;
};