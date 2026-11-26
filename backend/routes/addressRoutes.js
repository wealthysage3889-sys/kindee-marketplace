import express from 'express';
import { body } from 'express-validator';
import { verifyToken } from '../middleware/auth.js';
import { validate, validateId } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as addressService from '../services/addressService.js';

const router = express.Router();

const addressBodyRules = [
  body('label').optional().isString().trim().isLength({ max: 50 }),
  body('recipient_name').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('recipientName').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('phone').optional().isString().trim(),
  body('street').optional().isString().trim(),
  body('subdistrict').optional().isString().trim().isLength({ max: 120 }),
  body('district').optional().isString().trim(),
  body('province').optional().isString().trim(),
  body('postal_code').optional().isString().trim(),
  body('postalCode').optional().isString().trim(),
  body('country').optional().isString().trim().isLength({ max: 2 }),
  body('additional_details').optional().isString().trim().isLength({ max: 500 }),
  body('additionalDetails').optional().isString().trim().isLength({ max: 500 }),
  body('is_default').optional().isBoolean(),
  body('isDefault').optional().isBoolean(),
];

router.use(verifyToken);

router.get('/', asyncHandler(async (req, res) => {
  const addresses = await addressService.getAddresses(req.user.id);

  res.json({
    success: true,
    data: addresses,
  });
}));

router.post('/', addressBodyRules, validate, asyncHandler(async (req, res) => {
  const address = await addressService.createAddress(req.user.id, req.body);

  res.status(201).json({
    success: true,
    message: 'Address created',
    data: address,
  });
}));

router.put('/:id', validateId(), addressBodyRules, validate, asyncHandler(async (req, res) => {
  const address = await addressService.updateAddress(req.user.id, req.params.id, req.body);

  res.json({
    success: true,
    message: 'Address updated',
    data: address,
  });
}));

router.delete('/:id', validateId(), asyncHandler(async (req, res) => {
  const result = await addressService.deleteAddress(req.user.id, req.params.id);

  res.json({
    success: true,
    message: 'Address deleted',
    data: result,
  });
}));

const setDefaultHandler = asyncHandler(async (req, res) => {
  const address = await addressService.setDefaultAddress(req.user.id, req.params.id);

  res.json({
    success: true,
    message: 'Default address updated',
    data: address,
  });
});

router.post('/:id/default', validateId(), setDefaultHandler);
router.put('/:id/default', validateId(), setDefaultHandler);

export default router;