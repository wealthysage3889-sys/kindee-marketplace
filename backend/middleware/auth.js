const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: "ไม่ได้รับอนุญาต กรุณาเข้าสู่ระบบ" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) {
      return res.status(401).json({ message: "ไม่พบผู้ใช้งาน" });
    }
    next();
  } catch (error) {
    return res.status(401).json({ message: "โทเค็นไม่ถูกต้อง" });
  }
};

const ADMIN_ROLES = ["admin", "owner"];

const isAdmin = (user) => user && ADMIN_ROLES.includes(user.role);

const authorize = (...roles) => {
  return (req, res, next) => {
    if (req.user && req.user.role === "owner") {
      return next();
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "คุณไม่มีสิทธิ์เข้าถึงทรัพยากรนี้" });
    }
    next();
  };
};

module.exports = { protect, authorize, isAdmin, ADMIN_ROLES };
