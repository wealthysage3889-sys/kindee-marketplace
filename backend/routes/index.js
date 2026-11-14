const express = require("express");
const authRoutes = require("./authRoutes");
const productRoutes = require("./productRoutes");
const orderRoutes = require("./orderRoutes");
const userRoutes = require("./userRoutes");
const categoryRoutes = require("./categoryRoutes");
const storeRoutes = require("./store");
const adminRoutes = require("./adminRoutes");
const messageRoutes = require("./message");
const settingRoutes = require("./settingRoutes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/products", productRoutes);
router.use("/orders", orderRoutes);
router.use("/users", userRoutes);
router.use("/categories", categoryRoutes);
router.use("/stores", storeRoutes);
router.use("/admin", adminRoutes);
router.use("/messages", messageRoutes);
router.use("/settings", settingRoutes);

module.exports = router;
