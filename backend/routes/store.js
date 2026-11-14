const express = require('express');
const { body, query } = require('express-validator');
const storeController = require('../controllers/storeController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

const parseAddressBody = (value) => {
  let address = value;
  if (typeof value === 'string') {
    try {
      address = JSON.parse(value);
    } catch {
      return { error: 'รูปแบบที่อยู่ไม่ถูกต้อง' };
    }
  }
  return { address };
};

const validateRequiredAddress = (value) => {
  const { address, error } = parseAddressBody(value);
  if (error) throw new Error(error);
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    throw new Error('กรุณาระบุที่อยู่ร้านค้า');
  }
  const labels = {
    street: 'ที่อยู่/ถนน',
    district: 'ตำบล/แขวง',
    province: 'อำเภอ/เขต/จังหวัด',
    postalCode: 'รหัสไปรษณีย์',
  };
  for (const [field, label] of Object.entries(labels)) {
    if (!String(address[field] || '').trim()) {
      throw new Error(`กรุณากรอก${label}`);
    }
  }
  return true;
};

const validateOptionalAddress = (value) => {
  const { address, error } = parseAddressBody(value);
  if (error) throw new Error(error);
  if (address === undefined || address === null) return true;
  if (typeof address !== 'object' || Array.isArray(address)) {
    throw new Error('รูปแบบที่อยู่ไม่ถูกต้อง');
  }
  return true;
};

router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('category').optional().trim(),
  query('search').optional().trim(),
  query('lat').optional().isFloat().withMessage('Latitude must be a number'),
  query('lng').optional().isFloat().withMessage('Longitude must be a number'),
  query('radius').optional().isInt({ min: 1 }).withMessage('Radius must be a positive integer')
], storeController.getStores);

router.get('/featured', storeController.getFeaturedStores);

router.get('/categories', storeController.getCategories);

router.get('/owner/:ownerId', storeController.getStoreByOwner);

router.get('/:id', storeController.getStoreById);

router.get('/:id/products', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('category').optional().trim(),
  query('search').optional().trim()
], storeController.getStoreProducts);

router.get('/owner/:ownerId', storeController.getStoreByOwner);

router.post('/', protect, authorize('seller', 'admin'), upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), [
  body('name').trim().notEmpty().withMessage('Store name is required'),
  body('description').optional().trim(),
  body('address').custom(validateRequiredAddress),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('openingHours').optional().custom((value) => typeof value === 'object' || typeof value === 'string'),
  body('categories').optional().custom((value) => Array.isArray(value) || typeof value === 'string'),
  body('deliveryFee').optional().isNumeric().withMessage('Delivery fee must be a number'),
  body('minimumOrder').optional().isNumeric().withMessage('Minimum order must be a number'),
  body('estimatedDeliveryTime').optional().isInt({ min: 1 }).withMessage('Estimated delivery time must be a positive integer')
], storeController.createStore);

router.put('/:id', protect, authorize('seller', 'admin'), upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), [
  body('name').optional().trim().notEmpty().withMessage('Store name cannot be empty'),
  body('description').optional().trim(),
  body('address').optional().custom(validateOptionalAddress),
  body('phone').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('openingHours').optional().custom((value) => typeof value === 'object' || typeof value === 'string'),
  body('categories').optional().custom((value) => Array.isArray(value) || typeof value === 'string'),
  body('deliveryFee').optional().isNumeric(),
  body('minimumOrder').optional().isNumeric(),
  body('estimatedDeliveryTime').optional().isInt({ min: 1 })
], storeController.updateStore);

router.delete('/:id', protect, authorize('seller', 'admin'), storeController.deleteStore);

router.put('/:id/status', protect, authorize('seller', 'admin'), [
  body('isActive').isBoolean().withMessage('isActive must be a boolean')
], storeController.updateStoreStatus);

router.get('/owner/my-stores', protect, authorize('seller', 'admin'), storeController.getMyStores);

module.exports = router;