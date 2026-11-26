// Shared helpers for the `settings` table.
//
// The Supabase `settings` table only has: key, value, description, is_public
// (see supabase/migrations/001_initial_schema.sql). There is no `category` or
// `updated_by` column, so categories are emulated from the OAuth key whitelist
// below and every query/upsert must stick to SETTING_COLUMNS.

import { AppError } from '../middleware/errorHandler.js';

export const OAUTH_SETTING_KEYS = [
  'google_client_id',
  'google_client_secret',
  'google_enabled',
  'facebook_app_id',
  'facebook_app_secret',
  'facebook_enabled',
  'line_channel_id',
  'line_channel_secret',
  'line_enabled'
];

export const EXCHANGE_RATE_SETTING_KEYS = [
  'exchange_rate_thb_mmk'
];

export const VAT_RATE_SETTING_KEYS = [
  'vat_rate'
];

export const WALLET_SETTING_KEYS = [
  'customer_wallet_enabled'
];

export const ALLOWED_SETTING_KEYS = new Set([...OAUTH_SETTING_KEYS, ...EXCHANGE_RATE_SETTING_KEYS, ...VAT_RATE_SETTING_KEYS, ...WALLET_SETTING_KEYS]);

export const SECRET_SETTING_KEYS = new Set([
  'google_client_secret',
  'facebook_app_secret',
  'line_channel_secret'
]);

// Only these columns exist in the table.
export const SETTING_COLUMNS = 'key, value, description, is_public';

// Category filtering is emulated because the table has no category column.
const CATEGORY_KEY_FILTERS = {
  oauth: OAUTH_SETTING_KEYS,
  exchange_rate: EXCHANGE_RATE_SETTING_KEYS,
  vat: VAT_RATE_SETTING_KEYS,
  wallet: WALLET_SETTING_KEYS
};

export const toSnakeKey = (key) => String(key || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[\s-]+/g, '_')
  .toLowerCase();

export const isPrivilegedUser = (user) => Boolean(
  user && ['admin', 'owner'].includes(user.role)
);

export const redactSetting = (setting) => {
  if (!setting) return setting;
  const key = String(setting.key || '').toLowerCase();
  if (SECRET_SETTING_KEYS.has(key)) {
    return { ...setting, value: '', hasValue: Boolean(setting.value) };
  }
  return setting;
};

// Whitelist of keys for a category, or null when no category was requested.
// Unknown categories return an empty list: no row in the table belongs to them.
export const keysForCategory = (category) => {
  const normalized = String(category || '').trim().toLowerCase();
  if (!normalized) return null;
  return CATEGORY_KEY_FILTERS[normalized] || [];
};

// Builds the rows accepted by Supabase for the bulk endpoints.
// Never emits `category` / `updated_by` (columns that do not exist).
export const normalizeSettingsPayload = (incoming) => {
  const rows = [];

  for (const item of incoming || []) {
    if (!item || typeof item !== 'object') {
      throw new AppError('Invalid setting payload', 400);
    }

    const key = toSnakeKey(item.key);
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw new AppError(`Setting key not allowed: ${item.key}`, 400);
    }

    const value = item.value;
    if (value === undefined || value === null) {
      throw new AppError(`Value required for ${key}`, 400);
    }

    // Write-only behaviour: an empty secret keeps the stored value.
    if (SECRET_SETTING_KEYS.has(key) && String(value) === '') {
      continue;
    }

    const row = {
      key,
      value: String(value),
      is_public: typeof item.isPublic === 'boolean'
        ? item.isPublic
        : (typeof item.is_public === 'boolean' ? item.is_public : false)
    };

    // Omitting `description` keeps the stored value on conflict instead of
    // overwriting it with null.
    if (typeof item.description === 'string') {
      row.description = item.description;
    }

    rows.push(row);
  }

  return rows;
};