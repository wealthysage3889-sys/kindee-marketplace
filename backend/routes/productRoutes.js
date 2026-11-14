const express = require("express");
const { body } = require("express-validator");
const validate = require("../middleware/validate");
const upload = require("../middleware/upload");
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getSellerProducts,
} = require("../controllers/productController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.get("/", getProducts);
router.get("/seller/mine", protect, getSellerProducts);
router.get("/:id", getProductById);

router.post(
  "/",
  protect,
  authorize("seller", "admin"),
  upload.array("images", 3),
  [
    body("name").trim().notEmpty().withMessage("กรุณากรอกชื่อสินค้า"),
    body("description").notEmpty().withMessage("กรุณากรอกรายละเอียดสินค้า"),
    body("price").isNumeric({ min: 0 }).withMessage("ราคาต้องเป็นตัวเลขและไม่ติดลบ"),
    body("discountPrice").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("ราคาโปรโมชั่นต้องเป็นตัวเลขและไม่ติดลบ"),
    body("stock").isInt({ min: 0 }).withMessage("จำนวนสินค้าต้องต้องเป็นจำนวนเต็มและไม่ติดลบ"),
    body("category").notEmpty().withMessage("กรุณาเลือกหมวดหมู่"),
    body("tags").optional({ nullable: true }).isArray().withMessage("tags ต้องเป็น array"),
  ],
  validate,
  createProduct
);

router.put(
  "/:id",
  protect,
  upload.array("images", 3),
  [
    body("name").optional({ nullable: true }).trim().notEmpty().withMessage("ชื่อสินค้าต้องไม่ว่าง"),
    body("description").optional({ nullable: true }).notEmpty().withMessage("รายละเอียดต้องไม่ว่าง"),
    body("price").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("ราคาต้องเป็นตัวเลขและไม่ติดลบ"),
    body("discountPrice").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("ราคาโปรโมชั่นต้องเป็นตัวเลขและไม่ติดลบ"),
    body("stock").optional({ nullable: true }).isInt({ min: 0 }).withMessage("จำนวนสินค้าต้องต้องเป็นจำนวนเต็มและไม่ติดลบ"),
    body("category").optional({ nullable: true }).notEmpty().withMessage("หมวดหมู่ต้องไม่ว่าง"),
    body("tags").optional({ nullable: true }).isArray().withMessage("tags ต้องเป็น array"),
    body("isActive").optional({ nullable: true }).isBoolean().withMessage("isActive ต้องเป็นบูเลียน"),
  ],
  validate,
  updateProduct
);

router.delete("/:id", protect, deleteProduct);

module.exports = router;