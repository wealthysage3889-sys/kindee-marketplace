const toCamelCase = (key) => key.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());

const addAliases = (value, seen) => {
  if (Array.isArray(value)) {
    value.forEach((item) => addAliases(item, seen));
    return;
  }

  if (!value || typeof value !== 'object') return;

  if (seen.has(value)) return;
  seen.add(value);

  Object.keys(value).forEach((key) => {
    const camelKey = toCamelCase(key);
    if (camelKey !== key && value[camelKey] === undefined) {
      value[camelKey] = value[key];
    }
    addAliases(value[key], seen);
  });

  if (value.id !== undefined && value._id === undefined) {
    value._id = value.id;
  }

  if (value.logo_url !== undefined && value.logo === undefined) {
    value.logo = value.logo_url;
  }
  if (value.cover_image !== undefined && value.cover === undefined) {
    value.cover = value.cover_image;
  }
  if (value.cover_image_url !== undefined && value.coverImage === undefined) {
    value.coverImage = value.cover_image_url;
  }
};

const normalizeBody = (body) => {
  if (!body || typeof body !== 'object') return;

  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    const listKey = Object.keys(body.data).find((key) => Array.isArray(body.data[key]));
    if (listKey && body.data.data === undefined) {
      body.data.data = body.data[listKey];
    }
  }

  addAliases(body, new WeakSet());
};

// Keeps the legacy API contract ({ data: [...] } / _id / camelCase) while the
// services return raw Supabase rows, so existing frontend pages keep working.
export const responseFormatter = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    try {
      normalizeBody(body);
    } catch (error) {
      console.error('Response formatting error:', error.message);
    }
    return originalJson(body);
  };

  next();
};

export default responseFormatter;