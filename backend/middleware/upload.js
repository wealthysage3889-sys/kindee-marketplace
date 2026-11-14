const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { uploadsDir, ensureUploadsDir } = require("../config/uploadDir");

// Create the folder once on module load
ensureUploadsDir();

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

// busboy decodes filenames as latin1, so restore UTF-8 names (e.g. Thai) when possible
const toUtf8 = (value) => {
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
};

const sanitizeBaseName = (originalname) => {
  const base = path
    .parse(toUtf8(originalname || ""))
    .name.normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);

  return base || "image";
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      // Re-check on every upload so a deleted folder cannot break the request
      cb(null, ensureUploadsDir());
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(toUtf8(file.originalname || "")).toLowerCase() || ".jpg").replace(
      /[^.a-z0-9]/g,
      ""
    );
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : ".jpg";
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    cb(null, `${unique}-${sanitizeBaseName(file.originalname)}${safeExt}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = ALLOWED_EXTENSIONS.includes(
    path.extname(toUtf8(file.originalname || "")).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype || "");
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error("รองรับเฉพาะไฟล์รูปภาพเท่านั้น"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;