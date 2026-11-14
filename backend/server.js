require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const connectDB = require("./config/db");
const { uploadsDir, ensureUploadsDir } = require("./config/uploadDir");
const errorHandler = require("./middleware/errorHandler");
const apiRoutes = require("./routes/index");
const { initialize: initSocket } = require("./services/socketService");
const Setting = require("./models/Setting");

// Make sure <backend>/uploads exists before accepting uploads
ensureUploadsDir();

connectDB().then(async () => {
  // Initialize default settings
  try {
    await Setting.initDefaults();
    console.log("Default settings initialized");
  } catch (error) {
    console.error("Failed to initialize default settings:", error.message);
  }
});

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || "*", credentials: true }));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Ensure UTF-8 encoding for all responses
app.use((req, res, next) => {
  res.charset = "utf-8";
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// Serve uploaded files (absolute path, works from any working directory)
app.use("/uploads", express.static(uploadsDir));

app.get("/", (req, res) => {
  res.json({ message: "Kindee Marketplace API is running" });
});

app.use("/api", apiRoutes);

app.use(errorHandler);

const BASE_PORT = Number(process.env.PORT) || 5000;

const startServer = (port, attemptsLeft = 1) => {
  const server = app.listen(port, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${port}`);
    // Initialize Socket.IO after server is listening
    initSocket(server);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      const fallbackPort = port + 1;
      console.warn(`Port ${port} is in use, trying port ${fallbackPort}...`);
      startServer(fallbackPort, attemptsLeft - 1);
      return;
    }
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });

  process.on("unhandledRejection", (err) => {
    console.error(`她说她: ${err.message}`);
    server.close(() => process.exit(1));
  });

  return server;
};

startServer(BASE_PORT);

module.exports = app;
