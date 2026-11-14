const express = require("express");
const mongoose = require("mongoose");
const { body } = require("express-validator");
const validate = require("../middleware/validate");
const { protect, authorize } = require("../middleware/auth");
const {
  getMessages,
  getChatList,
  sendMessage,
  markAsRead,
} = require("../controllers/messageController");

const router = express.Router();

// Get chat list for the logged-in seller/admin
router.get("/", protect, authorize("seller", "admin"), getChatList);

// Get messages for a specific store (authenticated users)
router.get(
  "/:storeId",
  protect,
  getMessages
);

// Send a message (any authenticated user, including customers)
router.post(
  "/:storeId",
  protect,
  [
    body(["text", "content"])
      .custom((value, { req }) => {
        const raw = req.body.text !== undefined && req.body.text !== null
          ? req.body.text
          : req.body.content;
        return typeof raw === "string" && raw.trim().length > 0;
      })
      .withMessage("กรุณากรอกข้อความ"),
    body(["receiverId", "receiver"])
      .optional({ nullable: true })
      .custom((value) => value === "" || mongoose.Types.ObjectId.isValid(String(value)))
      .withMessage("receiver ไม่ถูกต้อง"),
    body("senderRole")
      .optional({ nullable: true })
      .isIn(["customer", "seller", "admin"])
      .withMessage("senderRole ไม่ถูกต้อง"),
  ],
  validate,
  sendMessage
);

// Mark messages as read (seller/admin only)
router.put(
  "/:storeId/read",
  protect,
  authorize("seller", "admin"),
  markAsRead
);

module.exports = router;