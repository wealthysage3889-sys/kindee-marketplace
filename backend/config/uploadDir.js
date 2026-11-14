const fs = require("fs");
const path = require("path");

// Absolute path to <backend>/uploads so it never depends on the process cwd
const uploadsDir = path.join(__dirname, "..", "uploads");

// Create the uploads folder when it is missing (ENOENT prevention)
const ensureUploadsDir = () => {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
};

module.exports = { uploadsDir, ensureUploadsDir };