const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Multer / upload errors
  if (err.code === "LIMIT_FILE_SIZE") {
    error = { message: "ไฟล์รูปภาพมีขนาดใหญ่เกินไป (สูงสุด 5 MB)", statusCode: 400 };
  } else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
    error = { message: "อัปโหลดรูปภาพได้ไม่เกิน 3 รูป", statusCode: 400 };
  } else if (err.code === "ENOENT" || err.code === "EACCES") {
    error = { message: "ไม่สามารถบันทึกไฟล์ได้ กรุณาตรวจสอบโฟลเดอร์ uploads", statusCode: 500 };
  }

  if (err.name === "CastError") {
    const message = "ทรัพยากรไม่พบ";
    error = { message, statusCode: 404 };
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field} นี้มีอยู่แล้วในระบบ`;
    error = { message, statusCode: 400 };
  }

  if (err.name === "ValidationError") {
    const message = Object.values(err.errors).map((val) => val.message);
    error = { message, statusCode: 400 };
  }

  if (err.name === "JsonWebTokenError") {
    error = { message: "โทเค็นไม่ถูกต้อง", statusCode: 401 };
  }

  if (err.name === "TokenExpiredError") {
    error = { message: "โทเค็นหมดอายุ", statusCode: 401 };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "เกิดข้อผิดพลาดในเซิร์ฟเวอร์",
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
};

module.exports = errorHandler;
