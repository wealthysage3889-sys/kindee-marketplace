const express = require("express");
const { body } = require("express-validator");
const validate = require("../middleware/validate");
const { protect, authorize } = require("../middleware/auth");
const upload = require("../middleware/upload");
const {
  getDashboardStats,
  getAllUsers,
  getUserById,
  updateUserRole,
  deleteUser,
  createUser,
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getReports,
  uploadProductImages,
} = require("../controllers/adminController");

const router = express.Router();

// Dashboard stats
router.get("/dashboard", protect, authorize("admin"), getDashboardStats);

// Image upload for products (admin / owner)
router.post(
  "/products/upload-images",
  protect,
  authorize("admin"),
  upload.array("images", 3),
  uploadProductImages
);

// Users
router.get("/users", protect, authorize("admin"), getAllUsers);
router.get("/users/:id", protect, authorize("admin"), getUserById);
router.post(
  "/users",
  protect,
  authorize("admin"),
  [
    body("name").trim().notEmpty().withMessage("กรุณากรอกชื่อ"),
    body("email").isEmail().normalizeEmail().withMessage("กรุณากรอกอีเมลให้ถูกต้อง"),
    body("password").isLength({ min: 6 }).withMessage("กรุณากรอกรหัสผ่านต้องอย่างน้อย 6 ตัวอักษร"),
    body("role")
      .isIn(["customer", "seller", "admin", "owner"])
      .withMessage("role ต้องเป็น customer, seller, admin หรือ owner"),
  ],
  validate,
  createUser
);
router.put(
  "/users/:id/role",
  protect,
  authorize("admin"),
  [body("role").isIn(["customer", "seller", "admin", "owner"]).withMessage("role ไม่ถูกต้อง")],
  validate,
  updateUserRole
);
router.delete("/users/:id", protect, authorize("admin"), deleteUser);

// Products (admin full control)
router.get("/products", protect, authorize("admin"), getAllProducts);
router.get("/products/:id", protect, authorize("admin"), getProductById);
router.post(
  "/products",
  protect,
  authorize("admin"),
  [
    body("name").trim().notEmpty().withMessage("กรุณากรอกชื่อสินค้า"),
    body("description").notEmpty().withMessage("กรุณากรอกรายละเอียดสินค้า"),
    body("price").isNumeric({ min: 0 }).withMessage("ราคาต้องเป็นตัวเลขและไม่ติดลบ"),
    body("discountPrice").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("ราคาโปรโมชั่นต้องเป็นตัวเลขและไม่ติดลบ"),
    body("stock").isInt({ min: 0 }).withMessage("จำนวนสินค้าต้องต้องเป็นจำนวนเต็มและไม่ติดลบ"),
    body("category").notEmpty().withMessage("กรุณาเลือกหมวดหมู่"),
    body("images").isArray({ min: 1 }).withMessage("กรุณาอัปโหลดรูปสินค้าอย่างน้อย 1 รูป"),
    body("tags").optional({ nullable: true }).isArray().withMessage("tags ต้องเป็น array"),
  ],
  validate,
  createProduct
);
router.put(
  "/products/:id",
  protect,
  authorize("admin"),
  [
    body("name").optional({ nullable: true }).trim().notEmpty().withMessage("ชื่อสินค้าต้องไม่ว่าง"),
    body("description").optional({ nullable: true }).notEmpty().withMessage("รายละเอียดต้องไม่ว่าง"),
    body("price").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("ราคาต้องเป็นตัวเลขและไม่ติดลบ"),
    body("discountPrice").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("ราคาโปรโมชั่นต้องเป็นตัวเลขและไม่ติดลบ"),
    body("stock").optional({ nullable: true }).isInt({ min: 0 }).withMessage("จำนวนสินค้าต้องต้องเป็นจำนวนเต็มและไม่ติดลบ"),
    body("category").optional({ nullable: true }).notEmpty().withMessage("หมวดหมู่ต้องไม่ว่าง"),
    body("images").optional({ nullable: true }).isArray({ min: 1 }).withMessage("ต้องอัปโหลดรูปสินค้าอย่างน้อย 1 รูป"),
    body("tags").optional({ nullable: true }).isArray().withMessage("tags ต้องเป็น array"),
    body("isActive").optional({ nullable: true }).isBoolean().withMessage("isActive ต้องเป็นบูเลียน"),
  ],
  validate,
  updateProduct
);
router.delete("/products/:id", protect, authorize("admin"), deleteProduct);

// Reports
router.get("/reports", protect, authorize("admin"), getReports);

module.exports = router;