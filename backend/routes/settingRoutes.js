import express from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { verifyToken, authorize, verifyAdmin, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';
import {
  SETTING_COLUMNS,
  isPrivilegedUser,
  keysForCategory,
  normalizeSettingsPayload,
  redactSetting
} from '../utils/settings.js';

const router = express.Router();

// Get settings
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const isPrivileged = isPrivilegedUser(req.user);

  // The table has no category column: filter on the OAuth key whitelist.
  const categoryKeys = keysForCategory(category);
  if (categoryKeys && categoryKeys.length === 0) {
    return res.json({ success: true, data: isPrivileged ? [] : {} });
  }

  let query = supabaseAdmin.from('settings').select(SETTING_COLUMNS);
  if (categoryKeys) query = query.in('key', categoryKeys);
  if (!isPrivileged) query = query.eq('is_public', true);

  const { data: settings, error } = await query.order('key');
  if (error) {
    throw new AppError(`Failed to fetch settings: ${error.message}`, 500);
  }

  if (!isPrivileged) {
    const settingsObj = (settings || []).reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {});
    return res.json({ success: true, data: settingsObj });
  }

  res.json({ success: true, data: (settings || []).map(redactSetting) });
}));

// Public social login configuration (used by the login/register pages).
// Credentials come from server environment variables; no secret is exposed.
router.get('/public/social-config', optionalAuth, asyncHandler(async (req, res) => {
  const { data: rows } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', [
      'google_client_id',
      'facebook_app_id',
      'line_channel_id',
      'google_enabled',
      'facebook_enabled',
      'line_enabled'
    ]);

  const values = {};
  (rows || []).forEach((row) => {
    values[row.key] = row.value;
  });

  const readFlag = (key) => {
    const value = values[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true';
    return undefined;
  };

  const readText = (key, envValue) => {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value;
    return envValue || '';
  };

  const googleClientId = readText('google_client_id', process.env.GOOGLE_CLIENT_ID);
  const facebookAppId = readText('facebook_app_id', process.env.FACEBOOK_APP_ID);
  const lineChannelId = readText('line_channel_id', process.env.LINE_CHANNEL_ID);

  res.json({
    success: true,
    data: {
      google: {
        enabled: readFlag('google_enabled') ?? Boolean(googleClientId),
        clientId: googleClientId
      },
      facebook: {
        enabled: readFlag('facebook_enabled') ?? Boolean(facebookAppId),
        appId: facebookAppId
      },
      line: {
        enabled: readFlag('line_enabled') ?? Boolean(lineChannelId),
        channelId: lineChannelId
      }
    }
  });
}));

// Get setting by key
router.get('/:key', optionalAuth, asyncHandler(async (req, res) => {
  const key = String(req.params.key || '').toLowerCase();
  const { data: setting, error } = await supabaseAdmin
    .from('settings')
    .select(SETTING_COLUMNS)
    .eq('key', key)
    .maybeSingle();

  if (error) {
    throw new AppError(`Failed to fetch setting: ${error.message}`, 500);
  }

  if (!setting) {
    throw new NotFoundError('Setting');
  }

  const isPrivileged = isPrivilegedUser(req.user);
  if (!setting.is_public && !isPrivileged) {
    throw new NotFoundError('Setting');
  }

  res.json({
    success: true,
    data: isPrivileged ? redactSetting(setting) : setting
  });
}));

// Bulk update settings (admin/owner)
router.post('/bulk', verifyToken, verifyAdmin, [
  body('settings').isArray({ min: 1 }).withMessage('settings must be a non-empty array'),
  body('settings.*.key').isString().notEmpty().withMessage('Setting key is required')
], validate, asyncHandler(async (req, res) => {
  // Only key/value/description/is_public are written: the table has no
  // category or updated_by column.
  const normalized = normalizeSettingsPayload(req.body.settings);

  if (normalized.length === 0) {
    return res.json({ success: true, message: 'No settings updated', data: [] });
  }

  const { data, error } = await supabaseAdmin
    .from('settings')
    .upsert(normalized, { onConflict: 'key' })
    .select(SETTING_COLUMNS);

  if (error) {
    throw new AppError(`Bulk setting update failed: ${error.message}`, 500);
  }

  res.json({
    success: true,
    message: 'Settings updated',
    data: (data || []).map(redactSetting)
  });
}));

export default router;