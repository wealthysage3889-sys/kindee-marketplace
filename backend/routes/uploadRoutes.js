import express from 'express';
import { body, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { uploadSingle, uploadMultiple, uploadToSupabase, generateFileName, generateStoragePath, getSignedUrl } from '../middleware/upload.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Upload avatar
router.post('/avatar', verifyToken, uploadSingle('avatar', 'avatars'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }
  
  const fileName = generateFileName(req.file.originalname, 'avatar-');
  const filePath = generateStoragePath('avatars', req.user.id, fileName);
  
  const result = await uploadToSupabase(supabaseAdmin, 'avatars', filePath, req.file.buffer, req.file.mimetype);
  
  // Update user profile
  await supabaseAdmin
    .from('profiles')
    .update({ avatar_url: result.publicUrl })
    .eq('id', req.user.id);
  
  res.json({
    success: true,
    message: 'Avatar uploaded',
    data: { url: result.publicUrl, path: result.path }
  });
}));

// Upload chat attachment
router.post('/chat/:conversationId', validateId('conversationId'), verifyToken, uploadMultiple('attachments', 5, 'chat-attachments'), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }
  
  // Verify conversation membership
  const { data: member } = await supabaseAdmin
    .from('conversation_members')
    .select('id')
    .eq('conversation_id', req.params.conversationId)
    .eq('profile_id', req.user.id)
    .is('left_at', null)
    .single();
  
  if (!member) {
    throw new AppError('Not a member of this conversation', 403);
  }
  
  const uploadedFiles = [];
  
  for (const file of req.files) {
    const fileName = generateFileName(file.originalname, 'chat-');
    const filePath = generateStoragePath('chat-attachments', req.params.conversationId, fileName);
    
    const result = await uploadToSupabase(supabaseAdmin, 'chat-attachments', filePath, file.buffer, file.mimetype);
    
    // chat-attachments bucket เป็นไพรเวต (public = false) ต้องใช้ signed URL เพื่อให้ frontend เปิดรูปได้
    const signedUrl = await getSignedUrl(supabaseAdmin, 'chat-attachments', result.path, 3600);
    
    uploadedFiles.push({
      url: signedUrl,
      file_url: signedUrl,
      path: result.path,
      fileName: file.originalname,
      file_name: file.originalname,
      fileSize: file.size,
      file_size: file.size,
      mimeType: file.mimetype,
      mime_type: file.mimetype
    });
  }
  
  res.json({
    success: true,
    message: 'Files uploaded',
    data: uploadedFiles
  });
}));

// Get signed URL for private file
router.get('/signed-url', verifyToken, [
  body('bucket').isIn(['avatars', 'store-logos', 'store-covers', 'product-images', 'chat-attachments', 'voice-recordings']).withMessage('Invalid bucket'),
  body('path').notEmpty().withMessage('File path required'),
  body('expiresIn').optional().isInt({ min: 60, max: 86400 }).withMessage('Invalid expiry')
], validate, asyncHandler(async (req, res) => {
  const { bucket, path, expiresIn = 3600 } = req.body;
  
  // Verify access based on bucket
  let hasAccess = false;
  
  if (bucket === 'avatars') {
    hasAccess = path.startsWith(`${req.user.id}/`);
  } else if (bucket === 'chat-attachments') {
    const { data: member } = await supabaseAdmin
      .from('conversation_members')
      .select('id')
      .eq('conversation_id', path.split('/')[1])
      .eq('profile_id', req.user.id)
      .is('left_at', null)
      .single();
    hasAccess = !!member;
  } else if (['store-logos', 'store-covers', 'product-images'].includes(bucket)) {
    // Check store ownership
    const resourceId = path.split('/')[1];
    if (bucket === 'product-images') {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('store_id')
        .eq('id', resourceId)
        .single();
      if (product) {
        const { data: store } = await supabaseAdmin
          .from('stores')
          .select('owner_id')
          .eq('id', product.store_id)
          .single();
        hasAccess = store?.owner_id === req.user.id || ['admin', 'owner'].includes(req.user.role);
      }
    } else {
      const { data: store } = await supabaseAdmin
        .from('stores')
        .select('owner_id')
        .eq('id', resourceId)
        .single();
      hasAccess = store?.owner_id === req.user.id || ['admin', 'owner'].includes(req.user.role);
    }
  }
  
  if (!hasAccess && !['admin', 'owner'].includes(req.user.role)) {
    throw new AppError('Not authorized to access this file', 403);
  }
  
  const signedUrl = await getSignedUrl(supabaseAdmin, bucket, path, expiresIn);
  
  res.json({
    success: true,
    data: { signedUrl, expiresIn }
  });
}));

// Delete file
router.delete('/:bucket/:path(*)', verifyToken, asyncHandler(async (req, res) => {
  const { bucket, path } = req.params;
  
  // Verify access (similar to signed URL)
  let hasAccess = false;
  
  if (bucket === 'avatars') {
    hasAccess = path.startsWith(`${req.user.id}/`);
  } else if (['store-logos', 'store-covers', 'product-images'].includes(bucket)) {
    const resourceId = path.split('/')[1];
    if (bucket === 'product-images') {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('store_id')
        .eq('id', resourceId)
        .single();
      if (product) {
        const { data: store } = await supabaseAdmin
          .from('stores')
          .select('owner_id')
          .eq('id', product.store_id)
          .single();
        hasAccess = store?.owner_id === req.user.id;
      }
    } else {
      const { data: store } = await supabaseAdmin
        .from('stores')
        .select('owner_id')
        .eq('id', resourceId)
        .single();
      hasAccess = store?.owner_id === req.user.id;
    }
  }
  
  if (!hasAccess && !['admin', 'owner'].includes(req.user.role)) {
    throw new AppError('Not authorized to delete this file', 403);
  }
  
  await supabaseAdmin.storage
    .from(bucket)
    .remove([path]);
  
  res.json({
    success: true,
    message: 'File deleted'
  });
}));

export default router;