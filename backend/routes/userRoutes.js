const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const { getUsers, getUserById, updateUserRole, deleteUser } = require("../controllers/userController");

const router = express.Router();

router.get("/", protect, authorize("admin"), getUsers);
router.get("/:id", protect, getUserById);
router.put("/:id/role", protect, authorize("admin"), updateUserRole);
router.delete("/:id", protect, authorize("admin"), deleteUser);

module.exports = router;
