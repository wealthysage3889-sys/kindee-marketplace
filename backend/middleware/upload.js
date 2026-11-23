import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for memory storage (for Supabase upload)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Allowed mime types
  const allowedTypes = {
    'avatars': ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    'store-logos': ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    'store-kbzpay-qr': ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    'store-covers': ['image/jpeg', 'image/png', 'image/webp'],
    'product-images': ['image/jpeg', 'image/png', 'image/webp'],
    'chat-attachments': ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    'voice-recordings': ['audio/webm', 'audio/ogg', 'audio/mpeg'],
    'payment-slips': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  };
  
  // Get bucket from request or default
  const bucket = req.body.bucket || 'chat-attachments';
  const allowed = allowedTypes[bucket] || allowedTypes['chat-attachments'];
  
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed for ${bucket}`), false);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 20 * 1024 * 1024, // 20MB default
    files: 10 // Max 10 files per request
  }
});

// Single file upload
export const uploadSingle = (fieldName, bucket = 'chat-attachments') => {
  return (req, res, next) => {
    req.body.bucket = bucket;
    upload.single(fieldName)(req, res, next);
  };
};

// Multiple files upload
export const uploadMultiple = (fieldName, maxCount = 5, bucket = 'chat-attachments') => {
  return (req, res, next) => {
    req.body.bucket = bucket;
    upload.array(fieldName, maxCount)(req, res, next);
  };
};

// Generate unique filename
export const generateFileName = (originalName, prefix = '') => {
  const ext = path.extname(originalName).toLowerCase();
  const uniqueId = uuidv4();
  const timestamp = Date.now();
  return `${prefix}${timestamp}-${uniqueId}${ext}`;
};

// Normalize a storage object path so it never carries the bucket name as the
// first path segment. Supabase SDK prepends the bucket id itself, so
// createSignedUrl()/getPublicUrl()/remove() must receive the key within the bucket.
//
// - trim whitespace
// - ตัด slash ด้านหน้าออก
// - หากขึ้นต้นด้วย `${bucket}/` ให้ตัด prefix ออกทุกครั้งที่ซ้ำ (idempotent) จึงรองรับ
//   path ที่มี bucket prefix ซ้ำหลายชั้นจากไฟล์เก่า
// - ห้ามตัดชื่อโฟลเดอร์อื่น / เปลี่ยนชื่อไฟล์
export const normalizeStoragePath = (bucket, objectPath) => {
  if (!objectPath) return objectPath;
  let normalized = String(objectPath).trim();
  while (normalized.startsWith('/')) normalized = normalized.slice(1);
  const prefix = `${bucket}/`;
  // Strip the bucket prefix repeatedly so the result is idempotent even when the
  // stored key carries the bucket name more than once (e.g. a legacy double
  // `chat-attachments/chat-attachments/...` produced before the prefix fix).
  while (normalized.startsWith(prefix)) normalized = normalized.slice(prefix.length);
  return normalized;
};

// Backwards-compatible alias
export const normalizeObjectPath = (bucket, objectPath) => normalizeStoragePath(bucket, objectPath);

// Generate storage path
export const generateStoragePath = (bucket, ownerId, fileName) => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${ownerId}/${year}/${month}/${fileName}`;
};

// Upload to Supabase Storage
export const uploadToSupabase = async (supabaseAdmin, bucket, filePath, fileBuffer, contentType) => {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(filePath, fileBuffer, {
      contentType,
      upsert: false
    });
  
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
  
  // Normalize path: Supabase data.path may include bucket prefix
  const normalizedPath = normalizeStoragePath(bucket, data.path);
  
  // Get public URL using normalized path
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(normalizedPath);
  
  return {
    path: normalizedPath,
    publicUrl,
    fullPath: data.fullPath
  };
};

// Delete from Supabase Storage
export const deleteFromSupabase = async (supabaseAdmin, bucket, filePath) => {
  const normalizedPath = normalizeStoragePath(bucket, filePath);
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .remove([normalizedPath]);
  
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
  
  return true;
};

// Check whether an object actually exists in the bucket before signing it.
// Supabase .exists() returns { data: false } (no throw) only for NoSuchKey /
// HTTP 404; every other failure (NoSuchBucket, invalid JWT, network) throws.
export const storageObjectExists = async (supabaseAdmin, bucket, objectPath) => {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .exists(objectPath);
  if (error) return false;
  return data === true;
};

// Get signed URL for private files
//
// Object keys can be in either of two shapes:
//   - new:    <conversationId>/2026/11/<filename>        (path within bucket, no bucket prefix)
//   - legacy: chat-attachments/<conversationId>/2026/11/<filename>  (bucket name as first segment,
//                                                                      from uploads before the prefix fix)
//
// The SDK prepends the bucket id itself, so .createSignedUrl() must receive the
// key within the bucket. We try both candidates and sign whichever actually
// exists in storage; we never fabricate a URL for a missing object.
export const getSignedUrl = async (supabaseAdmin, bucket, filePath, expiresIn = 3600) => {
  // Never include the bucket name as the first path segment.
  const normalizedPath = normalizeStoragePath(bucket, filePath);

  const candidates = [normalizedPath];
  const legacyKey = `${bucket}/${normalizedPath}`;
  if (!normalizedPath.startsWith(`${bucket}/`)) {
    candidates.push(legacyKey);
  }

  let resolvedPath = null;
  for (const candidate of candidates) {
    if (await storageObjectExists(supabaseAdmin, bucket, candidate)) {
      resolvedPath = candidate;
      break;
    }
  }

  if (!resolvedPath) {
    throw new Error(
      `File not found in storage: ${bucket}/${normalizedPath} (object does not exist in bucket '${bucket}')`
    );
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(resolvedPath, expiresIn);
  
  if (error) {
    throw new Error(`Signed URL generation failed: ${error.message}`);
  }
  
  return data.signedUrl;
};
