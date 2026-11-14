const Order = require("../models/Order");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");

const createOrder = asyncHandler(async (req, res) => {
  const {
    orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    shippingPrice,
    taxPrice,
    totalPrice,
  } = req.body;

  if (!orderItems || orderItems.length === 0) {
    res.status(400).json({ success: false, message: "ไม่มีสินค้าในออเดอร์" });
    return;
  }

  const order = await Order.create({
    user: req.user.id,
    orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    shippingPrice,
    taxPrice,
    totalPrice,
  });

  res.status(201).json({ success: true, data: order });
});

const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user.id }).sort("-createdAt");
  res.json({ success: true, data: orders });
});

const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate("user", "name email");
  if (!order) {
    res.status(404).json({ success: false, message: "ไม่พบออเดอร์" });
    return;
  }

  if (
    order.user._id.toString() !== req.user.id &&
    !["admin", "owner"].includes(req.user.role)
  ) {
    res
      .status(403)
      .json({ success: false, message: "คุณไม่มีสิทธิ์ดูออเดอร์นี้" });
    return;
  }

  res.json({ success: true, data: order });
});

const updateOrderToPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404).json({ success: false, message: "ไม่พบออเดอร์" });
    return;
  }

  order.isPaid = true;
  order.paidAt = Date.now();
  order.paymentStatus = "paid";
  const updatedOrder = await order.save();

  res.json({ success: true, data: updatedOrder });
});

const updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404).json({ success: false, message: "ไม่พบออเดอร์" });
    return;
  }

  order.isDelivered = true;
  order.deliveredAt = Date.now();
  order.orderStatus = "delivered";
  const updatedOrder = await order.save();

  res.json({ success: true, data: updatedOrder });
});

module.exports = {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
};
