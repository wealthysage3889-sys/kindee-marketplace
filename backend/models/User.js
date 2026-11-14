const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "กรุณากรอกอีเมลให้ถูกต้อง",
      ],
    },
    password: {
      type: String,
      minlength: 6,
      select: false,
    },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    role: {
      type: String,
      enum: ["customer", "seller", "admin", "owner"],
      default: "customer",
    },
    avatar: { type: String, default: "" },
    googleId: { type: String, trim: true },
    facebookId: { type: String, trim: true },
    lineId: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ facebookId: 1 }, { unique: true, sparse: true });
userSchema.index({ lineId: 1 }, { unique: true, sparse: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
