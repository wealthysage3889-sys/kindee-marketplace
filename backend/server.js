import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { ensureUploadsDir, uploadsDir } from './config/uploadDir.js';
import { errorHandler } from './middleware/errorHandler.js';
import { responseFormatter } from './middleware/responseFormatter.js';
import apiRoutes from './routes/index.js';
import { initialize as initSocket } from './services/socketService.js';
import { supabaseAdmin, isSupabaseConfigured } from './config/supabase.js';

// Fail fast when Supabase credentials are missing: every API route reads from
// Supabase, so starting without them only produces runtime 500s.
if (!isSupabaseConfigured) {
  console.error(
    'FATAL: Supabase is not configured. Set SUPABASE_URL and ' +
    'SUPABASE_SERVICE_ROLE_KEY before starting the API.'
  );
  process.exit(1);
}

// Ensure uploads directory exists
ensureUploadsDir();

// Initialize default settings in database
async function initializeSettings() {
  if (!supabaseAdmin) {
    console.warn('Service role key not configured. Skipping settings initialization.');
    return;
  }
  
  try {
    const { error } = await supabaseAdmin.rpc('initialize_default_settings');
    if (error) {
      // 42883 / PGRST202: function has not been deployed to this database yet.
      if (['42883', 'PGRST202', '404'].includes(String(error.code))) {
        console.log('Default settings initialization skipped (function not deployed)');
      } else {
        console.error('Failed to initialize default settings:', error.message);
      }
    } else {
      console.log('Default settings initialized');
    }
  } catch (error) {
    console.error('Settings initialization error:', error.message);
  }
}

initializeSettings();

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({ 
  origin: process.env.CLIENT_URL || "*", 
  credentials: true 
}));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(responseFormatter);

// Ensure UTF-8 encoding for all responses
app.use((req, res, next) => {
  res.charset = "utf-8";
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// Serve uploaded files
app.use("/uploads", express.static(uploadsDir));

app.get("/", (req, res) => {
  res.json({ 
    message: "Kindee Marketplace API is running",
    version: "2.0.0",
    database: "Supabase (PostgreSQL)"
  });
});

app.use("/api", apiRoutes);

app.use(errorHandler);

const BASE_PORT = Number(process.env.PORT) || 5000;

const startServer = (port, attemptsLeft = 3) => {
  const server = createServer(app);
  
  server.listen(port, () => {
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
    console.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });

  return server;
};

startServer(BASE_PORT);

export default app;