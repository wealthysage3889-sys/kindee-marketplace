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

// Generate storage path
export const generateStoragePath = (bucket, ownerId, fileName) => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${bucket}/${ownerId}/${year}/${month}/${fileName}`;
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
  
  // Get public URL
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(data.path);
  
  return {
    path: data.path,
    publicUrl,
    fullPath: data.fullPath
  };
};

// Delete from Supabase Storage
export const deleteFromSupabase = async (supabaseAdmin, bucket, filePath) => {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .remove([filePath]);
  
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
  
  return true;
};

// Get signed URL for private files
export const getSignedUrl = async (supabaseAdmin, bucket, filePath, expiresIn = 3600) => {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresIn);
  
  if (error) {
    throw new Error(`Signed URL generation failed: ${error.message}`);
  }
  
  return data.signedUrl;
};
