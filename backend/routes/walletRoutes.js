import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize } from '../middleware/auth.js';
import * as walletService from '../services/walletService.js';
import { asyncHandler, AppError, ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();

// ================ Mee Card Wallet Registration (Admin) ================
// Admin middleware for admin routes
const adminRouter = express.Router();
adminRouter.use(verifyToken, authorize('admin', 'owner'));

// Get pending Mee card registrations (admin)
adminRouter.get('/mee-card-registrations', [
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit'),
  query('status').optional().isIn(['pending', 'approved', 'rejected', 'expired']).withMessage('Invalid status')
], validate, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status = 'pending' } = req.query;
  const result = await walletService.getPendingMeeCardRegistrations({ page: parseInt(page), limit: parseInt(limit), status });
  res.json({ success: true, data: result });
}));

// Get Mee card registration counts (admin)
adminRouter.get('/mee-card-registrations/counts', asyncHandler(async (req, res) => {
  const counts = await walletService.getMeeCardRegistrationCounts();
  res.json({ success: true, data: counts });
}));

// Approve or reject Mee card registration (admin)
adminRouter.patch('/mee-card-registrations/:id/review', validateId('id'), [
  body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject'),
  body('rejection_reason').optional().isString()
], validate, asyncHandler(async (req, res) => {
  const { action, rejection_reason } = req.body;
  const result = await walletService.reviewMeeCardWalletRegistration(req.user.id, req.params.id, action, rejection_reason);
  res.json({ success: true, message: action === 'approve' ? 'Registration approved successfully' : 'Registration rejected', data: result });
}));

// Mount admin routes BEFORE the global customer auth so /admin/* is handled by
// adminRouter (verifyToken + authorize('admin', 'owner')) and never reaches the
// global authorize('customer'), which would wrongly reject admins/owners with
// "Insufficient permissions".
router.use('/admin', adminRouter);

// All wallet routes require customer authentication
router.use(verifyToken, authorize('customer'));

// Get wallet summary
router.get('/summary', asyncHandler(async (req, res) => {
  const summary = await walletService.getWalletSummary(req.user.id);
  res.json({ success: true, data: summary });
}));

// Get wallet transactions
router.get('/transactions', [
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit')
], validate, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await walletService.getWalletTransactions(req.user.id, { page: parseInt(page), limit: parseInt(limit) });
  res.json({ success: true, data: result });
}));

// Get finance history
router.get('/history', [
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit')
], validate, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await walletService.getFinanceHistory(req.user.id, { page: parseInt(page), limit: parseInt(limit) });
  res.json({ success: true, data: result });
}));

// Get vouchers
router.get('/vouchers', [
  query('includeExpired').optional().isBoolean().withMessage('includeExpired must be boolean')
], validate, asyncHandler(async (req, res) => {
  const { includeExpired = false } = req.query;
  const vouchers = await walletService.getVouchers(req.user.id, { includeExpired: includeExpired === 'true' });
  res.json({ success: true, data: vouchers });
}));

// Get saved cards
router.get('/cards', asyncHandler(async (req, res) => {
  const cards = await walletService.getCards(req.user.id);
  res.json({ success: true, data: cards });
}));

// Add a new card
router.post('/cards', [
  body('card_token').notEmpty().withMessage('Card token is required'),
  body('card_last4').isLength({ min: 4, max: 4 }).withMessage('Last 4 digits required'),
  body('card_brand').notEmpty().withMessage('Card brand required'),
  body('card_exp_month').isInt({ min: 1, max: 12 }).withMessage('Invalid expiry month'),
  body('card_exp_year').isInt({ min: new Date().getFullYear() }).withMessage('Invalid expiry year'),
  body('cardholder_name').optional().trim(),
  body('gateway').optional().isString(),
  body('is_default').optional().isBoolean(),
  body('metadata').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  const card = await walletService.addCard(req.user.id, req.body);
  res.status(201).json({ success: true, message: 'Card added successfully', data: card });
}));

// Update card
router.patch('/cards/:id', validateId('id'), [
  body('is_default').optional().isBoolean(),
  body('cardholder_name').optional().trim(),
  body('metadata').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  const card = await walletService.updateCard(req.user.id, req.params.id, req.body);
  res.json({ success: true, message: 'Card updated successfully', data: card });
}));

// Delete card
router.delete('/cards/:id', validateId('id'), asyncHandler(async (req, res) => {
  await walletService.deleteCard(req.user.id, req.params.id);
  res.json({ success: true, message: 'Card deleted successfully' });
}));

// Get bank accounts
router.get('/bank-accounts', asyncHandler(async (req, res) => {
  const accounts = await walletService.getBankAccounts(req.user.id);
  res.json({ success: true, data: accounts });
}));

// Add a new bank account
router.post('/bank-accounts', [
  body('bank_name').notEmpty().withMessage('Bank name is required'),
  body('bank_code').optional().isString(),
  body('account_name').notEmpty().withMessage('Account name is required'),
  body('account_number').notEmpty().withMessage('Account number is required'),
  body('account_type').optional().isIn(['savings', 'current', 'fixed']).withMessage('Invalid account type'),
  body('is_default').optional().isBoolean(),
  body('promptpay_id').optional().isString(),
  body('metadata').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  const account = await walletService.addBankAccount(req.user.id, req.body);
  res.status(201).json({ success: true, message: 'Bank account added successfully', data: account });
}));

// Update bank account
router.patch('/bank-accounts/:id', validateId('id'), [
  body('is_default').optional().isBoolean(),
  body('account_name').optional().trim(),
  body('account_type').optional().isIn(['savings', 'current', 'fixed']),
  body('promptpay_id').optional().isString(),
  body('metadata').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  const account = await walletService.updateBankAccount(req.user.id, req.params.id, req.body);
  res.json({ success: true, message: 'Bank account updated successfully', data: account });
}));

// Delete bank account
router.delete('/bank-accounts/:id', validateId('id'), asyncHandler(async (req, res) => {
  await walletService.deleteBankAccount(req.user.id, req.params.id);
  res.json({ success: true, message: 'Bank account deleted successfully' });
}));

// Verify bank account
router.post('/bank-accounts/:id/verify', validateId('id'), asyncHandler(async (req, res) => {
  const account = await walletService.verifyBankAccount(req.user.id, req.params.id);
  res.json({ success: true, message: 'Bank account verified successfully', data: account });
}));

// Get wallet settings (enabled/disabled)
router.get('/settings', asyncHandler(async (req, res) => {
  const settings = await walletService.getWalletSettings();
  res.json({ success: true, data: settings });
}));

// ================ Mee Card Wallet Registration (Customer) ================

// Submit Mee card wallet registration
router.post('/mee-card-registration', [
  body('mee_card_number').notEmpty().withMessage('Mee card number is required'),
  body('mee_card_holder_name').notEmpty().withMessage('Card holder name is required'),
  body('mee_card_exp_month').isInt({ min: 1, max: 12 }).withMessage('Invalid expiry month'),
  body('mee_card_exp_year').isInt({ min: new Date().getFullYear() }).withMessage('Invalid expiry year'),
  body('mee_card_type').optional().isIn(['debit', 'credit', 'prepaid']).withMessage('Invalid card type'),
  body('phone_number').optional().isString(),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('metadata').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  const registration = await walletService.createMeeCardWalletRegistration(req.user.id, req.body);
  res.status(201).json({ success: true, message: 'Mee card wallet registration submitted for review', data: registration });
}));

// Get my Mee card wallet registration status
router.get('/mee-card-registration', asyncHandler(async (req, res) => {
  const registration = await walletService.getMyMeeCardRegistration(req.user.id);
  res.json({ success: true, data: registration });
}));



export default router;