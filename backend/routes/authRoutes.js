const express = require("express");
const { body } = require("express-validator");
const validate = require("../middleware/validate");
const { register, login, refreshToken, getProfile, updateProfile, logout, googleLogin, facebookLogin, lineLogin } = require("../controllers/authController");
const { protect } = require("../middleware/auth");

const router = express.Router();

const isEmailOrPhone = (value) => {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;
  return /^[0-9+\-\s]{8,20}$/.test(v);
};

router.post(
  "/register",
  [
    body("emailOrPhone").optional().trim(),
    body("email").optional().isEmail().normalizeEmail().withMessage("กรุณากรอกอีเมลให้ถูกต้อง"),
    body("password").optional().isLength({ min: 6 }).withMessage("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"),
    body("name").optional().trim(),
    body("phone").optional().trim(),
    body("role").optional().isIn(["customer", "seller"]).withMessage("role สำหรับสมัครสมาชิกได้ต้องเป็น customer หรือ seller"),
  ],
  validate,
  register
);

router.post(
  "/login",
  [
    body("email").custom(isEmailOrPhone).withMessage("กรุณากรอกเบอร์โทรศัพท์หรืออีเมลให้ถูกต้อง"),
    body("password").notEmpty().withMessage("กรุณากรอกรหัสผ่าน"),
  ],
  validate,
  login
);

router.post("/refresh", refreshToken);

router.post(
  "/google",
  [body("credential").notEmpty().withMessage("กรุณาระบุ Google credential")],
  validate,
  googleLogin
);

router.post(
  "/facebook",
  [body("accessToken").notEmpty().withMessage("กรุณาระบุ Facebook access token")],
  validate,
  facebookLogin
);

router.post(
  "/line",
  [body("code").notEmpty().withMessage("กรุณาระบุ LINE authorization code")],
  validate,
  lineLogin
);

router.get("/profile", protect, getProfile);
router.put(
  "/profile",
  protect,
  [
    body("email").optional({ nullable: true }).isEmail().normalizeEmail().withMessage("กรุณากรอกอีเมลให้ถูกต้อง"),
    body("password").optional({ nullable: true }).isLength({ min: 6 }).withMessage("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"),
    body("name").optional({ nullable: true }).trim().notEmpty().withMessage("ชื่อต้องไม่ว่าง"),
    body("phone").optional({ nullable: true }).trim(),
    body("address").optional({ nullable: true }).trim(),
    body("avatar").optional({ nullable: true }).trim(),
  ],
  validate,
  updateProfile
);

router.post("/logout", protect, logout);

module.exports = router;