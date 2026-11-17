import { supabaseAdmin } from '../config/supabase.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { normalizeThaiPhone } from '../utils/phone.js';

const ADDRESS_COLUMNS =
  'id,profile_id,label,recipient_name,phone,street,district,province,postal_code,lat,lng,is_default,created_at,updated_at';

const MAX_ADDRESSES_PER_PROFILE = 20;
const MAX_LABEL_LENGTH = 50;
const MAX_RECIPIENT_LENGTH = 120;
const MAX_STREET_LENGTH = 500;

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseBoolean = (value, field) => {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new ValidationError(`${field} must be a boolean`);
};

const normalizeCoordinates = (input, partial) => {
  const coordinates =
    input.coordinates && typeof input.coordinates === 'object' ? input.coordinates : {};
  const hasCoordinatesInput =
    input.coordinates !== undefined || input.lat !== undefined || input.lng !== undefined;

  if (!hasCoordinatesInput) {
    return partial ? {} : { lat: null, lng: null };
  }

  const latValue = coordinates.lat !== undefined ? coordinates.lat : input.lat;
  const lngValue = coordinates.lng !== undefined ? coordinates.lng : input.lng;
  const hasLat = latValue !== undefined && latValue !== null && String(latValue).trim() !== '';
  const hasLng = lngValue !== undefined && lngValue !== null && String(lngValue).trim() !== '';

  if (!hasLat && !hasLng) return { lat: null, lng: null };
  if (!hasLat || !hasLng) {
    throw new ValidationError('Both latitude and longitude are required');
  }

  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new ValidationError('Latitude must be between -90 and 90');
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ValidationError('Longitude must be between -180 and 180');
  }

  return { lat, lng };
};

const normalizeAddressPayload = (input = {}, { partial = false } = {}) => {
  const payload = {};
  const get = (snake, camel) =>
    input[snake] !== undefined ? input[snake] : camel ? input[camel] : undefined;

  const label = toTrimmedString(get('label'));
  if (label || !partial) {
    if (label.length > MAX_LABEL_LENGTH) {
      throw new ValidationError(`Label must be at most ${MAX_LABEL_LENGTH} characters`);
    }
    payload.label = label || null;
  }

  const recipientName = toTrimmedString(get('recipient_name', 'recipientName'));
  if (recipientName || !partial) {
    if (!recipientName) throw new ValidationError('Recipient name is required');
    if (recipientName.length > MAX_RECIPIENT_LENGTH) {
      throw new ValidationError(`Recipient name must be at most ${MAX_RECIPIENT_LENGTH} characters`);
    }
    payload.recipient_name = recipientName;
  }

  const rawPhone = toTrimmedString(get('phone'));
  if (rawPhone || !partial) {
    const phone = normalizeThaiPhone(rawPhone);
    if (!phone) throw new ValidationError('A valid Thai phone number is required');
    payload.phone = phone;
  }

  const street = toTrimmedString(get('street'));
  if (street || !partial) {
    if (!street) throw new ValidationError('Street address is required');
    if (street.length > MAX_STREET_LENGTH) {
      throw new ValidationError(`Street address must be at most ${MAX_STREET_LENGTH} characters`);
    }
    payload.street = street;
  }

  const district = toTrimmedString(get('district'));
  if (district || !partial) {
    if (!district) throw new ValidationError('District is required');
    payload.district = district;
  }

  const province = toTrimmedString(get('province'));
  if (province || !partial) {
    if (!province) throw new ValidationError('Province is required');
    payload.province = province;
  }

  const postalCode = toTrimmedString(get('postal_code', 'postalCode'));
  if (postalCode || !partial) {
    if (!postalCode) throw new ValidationError('Postal code is required');
    if (!/^[0-9]{5}$/.test(postalCode)) {
      throw new ValidationError('Postal code must contain exactly 5 digits');
    }
    payload.postal_code = postalCode;
  }

  const isDefault = parseBoolean(get('is_default', 'isDefault'), 'is_default');
  if (isDefault !== undefined) payload.is_default = isDefault;

  return { ...payload, ...normalizeCoordinates(input, partial) };
};

const isDuplicateDefaultError = (error) =>
  error?.code === '23505' &&
  (error?.constraint === 'uniq_profile_addresses_single_default' ||
    /single default|profile_addresses_single_default/i.test(error?.message || ''));

const raiseAddressDatabaseError = (action, error) => {
  if (isDuplicateDefaultError(error)) {
    throw new ConflictError('Another address is already being set as the default. Please retry.');
  }
  throw new AppError(`${action} failed: ${error.message}`, 500);
};

export const getAddresses = async (profileId) => {
  const { data, error } = await supabaseAdmin
    .from('profile_addresses')
    .select(ADDRESS_COLUMNS)
    .eq('profile_id', profileId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    raiseAddressDatabaseError('Address lookup', error);
  }

  return data || [];
};

export const createAddress = async (profileId, input) => {
  const values = normalizeAddressPayload(input);

  const { data: existing, error: countError } = await supabaseAdmin
    .from('profile_addresses')
    .select('id')
    .eq('profile_id', profileId);

  if (countError) {
    raiseAddressDatabaseError('Address count', countError);
  }
  if ((existing || []).length >= MAX_ADDRESSES_PER_PROFILE) {
    throw new ValidationError(
      `A profile can save at most ${MAX_ADDRESSES_PER_PROFILE} addresses`
    );
  }

  const isDefault = (existing || []).length === 0 ? true : values.is_default === true;

  const { data, error } = await supabaseAdmin
    .from('profile_addresses')
    .insert({
      ...values,
      profile_id: profileId,
      is_default: isDefault,
    })
    .select(ADDRESS_COLUMNS)
    .single();

  if (error) {
    raiseAddressDatabaseError('Address creation', error);
  }

  return data;
};

export const updateAddress = async (profileId, addressId, input) => {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('profile_addresses')
    .select(ADDRESS_COLUMNS)
    .eq('id', addressId)
    .eq('profile_id', profileId)
    .single();

  if (lookupError || !existing) {
    throw new NotFoundError('Address');
  }

  const updates = normalizeAddressPayload(input, { partial: true });
  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const { data, error } = await supabaseAdmin
    .from('profile_addresses')
    .update(updates)
    .eq('id', addressId)
    .eq('profile_id', profileId)
    .select(ADDRESS_COLUMNS)
    .single();

  if (error) {
    raiseAddressDatabaseError('Address update', error);
  }

  return data;
};

export const deleteAddress = async (profileId, addressId) => {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('profile_addresses')
    .select(ADDRESS_COLUMNS)
    .eq('id', addressId)
    .eq('profile_id', profileId)
    .single();

  if (lookupError || !existing) {
    throw new NotFoundError('Address');
  }

  const { error } = await supabaseAdmin
    .from('profile_addresses')
    .delete()
    .eq('id', addressId)
    .eq('profile_id', profileId);

  if (error) {
    raiseAddressDatabaseError('Address deletion', error);
  }

  if (existing.is_default) {
    const { data: remaining, error: remainingError } = await supabaseAdmin
      .from('profile_addresses')
      .select(ADDRESS_COLUMNS)
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true })
      .limit(1);

    if (remainingError) {
      raiseAddressDatabaseError('Default address promotion', remainingError);
    }

    if (remaining && remaining.length > 0) {
      const { error: promoteError } = await supabaseAdmin
        .from('profile_addresses')
        .update({ is_default: true })
        .eq('id', remaining[0].id)
        .eq('profile_id', profileId);

      if (promoteError) {
        raiseAddressDatabaseError('Default address promotion', promoteError);
      }
    }
  }

  return { id: addressId };
};

export const setDefaultAddress = async (profileId, addressId) => {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('profile_addresses')
    .select(ADDRESS_COLUMNS)
    .eq('id', addressId)
    .eq('profile_id', profileId)
    .single();

  if (lookupError || !existing) {
    throw new NotFoundError('Address');
  }

  const { data, error } = await supabaseAdmin
    .from('profile_addresses')
    .update({ is_default: true })
    .eq('id', addressId)
    .eq('profile_id', profileId)
    .select(ADDRESS_COLUMNS)
    .single();

  if (error) {
    raiseAddressDatabaseError('Default address update', error);
  }

  return data;
};