const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["customer", "seller", "admin"],
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverRole: {
      type: String,
      enum: ["customer", "seller", "admin"],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ store: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);