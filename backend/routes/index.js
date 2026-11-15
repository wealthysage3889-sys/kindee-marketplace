import express from 'express';
import authRoutes from './authRoutes.js';
import storeRoutes from './storeRoutes.js';
import productRoutes from './productRoutes.js';
import orderRoutes from './orderRoutes.js';
import chatRoutes from './chatRoutes.js';
import callRoutes from './callRoutes.js';
import deliveryRoutes from './deliveryRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import userRoutes from './userRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import adminRoutes from './adminRoutes.js';
import settingRoutes from './settingRoutes.js';
import uploadRoutes from './uploadRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/stores', storeRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/chat', chatRoutes);
router.use('/calls', callRoutes);
router.use('/deliveries', deliveryRoutes);
router.use('/notifications', notificationRoutes);
router.use('/users', userRoutes);
router.use('/categories', categoryRoutes);
router.use('/admin', adminRoutes);
router.use('/settings', settingRoutes);
router.use('/upload', uploadRoutes);

export default router;