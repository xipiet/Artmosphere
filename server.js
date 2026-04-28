const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const mainRenderer = require('./lib/mainRenderer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024
});

// ----------------------------------
// Session & Artwork Storage Setup
// ----------------------------------
// Resolution order:
//   1. ARTMOSPHERE_SAVE_PATH env var (explicit override, e.g. for production)
//   2. $XDG_DATA_HOME/artmosphere/saved (Linux user data convention)
//   3. ~/.local/share/artmosphere/saved (XDG default)
const SAVE_PATH = process.env.ARTMOSPHERE_SAVE_PATH
  || path.join(
       process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
       'artmosphere',
       'saved'
     );

const sessionStorage = new Map(); // sessionId -> { drawingDataUrl, timestamp, movementType, facingDirection, expiresAt }
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min — unsaved drafts are dropped after this

try {
  fs.mkdirSync(SAVE_PATH, { recursive: true });
  console.log(`Artwork save path ready: ${SAVE_PATH}`);
} catch (err) {
  console.error('Failed to create SAVE_PATH:', SAVE_PATH, err);
}

// Periodic GC: drop expired sessions that the user never finalized
setInterval(() => {
  const now = Date.now();
  for (const [sid, sess] of sessionStorage) {
    if (sess.expiresAt && sess.expiresAt < now) {
      sessionStorage.delete(sid);
      console.log(`[gc] dropped expired session ${sid}`);
    }
  }
}, 60 * 1000);

// Helper: Save Base64 image to file
function saveBase64Image(base64Data, filename) {
  try {
    const base64String = base64Data.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64String, 'base64');
    fs.writeFileSync(filename, buffer);
    console.log(`Saved image: ${filename}`);
  } catch (err) {
    console.error(`Failed to save image: ${filename}`, err);
  }
}

// Helper: Generate unique session ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper: Sanitize username for directory name
function sanitizeUsername(username) {
  return (username || 'anonymous')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 50);
}

// ----------------------------------
// Load Theme Config + Settings
// ----------------------------------
const configPath = path.join(__dirname, "public", "themes", "config.json");
const settingsPath = path.join(__dirname, "settings.json");

let serverConfig = {};
let serverSettings = {
  galleryMode: "maxPaintings",
  maxImages: 30,
  maxImagesMode: "fade",
  normalizeSize: true,
  foregroundPaintings: 10,
  midgroundPaintings: 10,
  backgroundPaintings: 10,
  foregroundOpacityMax: 1.0,
  foregroundOpacityMin: 0.7,
  midgroundOpacityMax: 0.69,
  midgroundOpacityMin: 0.4,
  backgroundOpacityMax: 0.39,
  backgroundOpacityMin: 0.1
};
let activeImages = []; // Store active paintings { id, dataUrl, movementType, timestamp }

// -------------------- Load Config (Themes only) --------------------
function loadConfig() {
  try {
    serverConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("Theme config loaded:", serverConfig.activeTheme);
  } catch (err) {
    console.error("ERROR loading config.json:", err);
  }
}
loadConfig();

// -------------------- Load Settings (Admin settings) --------------------
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      serverSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      console.log("Settings loaded:", serverSettings);
    }
  } catch (e) {
    console.error("Failed to load settings.json", e);
  }
}
loadSettings();

// Save config.json (Themes)
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2), "utf8");
  console.log("Theme config saved.");
}

// Save settings.json (Admin settings)
function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(serverSettings, null, 2), "utf8");
  console.log("Settings saved.");
}

// ----------------------------------
// Static Files (public folder)
// ----------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ----------------------------------
// Routes
// ----------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/main", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.html"));
});

app.get("/ipad", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ipad.html"));
});

app.get("/ipad-endscreen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ipadEndscreen.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ----------------------------------
// Theme Image Route
// ----------------------------------
app.get("/theme-image/:filename", (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  let filePath;
  
  // If it starts with /, treat as absolute path from root drive
  // Otherwise, resolve relative to public/themes/
  if (filename.startsWith('/') && !filename.startsWith('/')) {
    // Unix-style absolute path - try as-is
    filePath = filename;
  } else if (path.isAbsolute(filename)) {
    // Already absolute (Windows style)
    filePath = filename;
  } else {
    // Relative path - resolve from themes folder
    filePath = path.join(__dirname, "public", "themes", filename);
  }
  
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error serving image:", filePath, err.message);
      res.status(404).send('Image not found');
    }
  });
});

// ----------------------------------
// Socket.io
// ----------------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send config + settings to new client
  socket.emit("app:init", {
    config: serverConfig,
    settings: serverSettings
  });

  // iPad sends drawing + movementType. We acknowledge with the new sessionId.
  // Drawing is buffered in RAM only — nothing hits the disk until finalizeArtwork.
  socket.on("sendImage", ({ dataUrl, movementType, facingDirection }, ack) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
      if (typeof ack === 'function') ack({ ok: false, error: 'missing_dataUrl' });
      return;
    }

    const facing = facingDirection === 'left' ? 'left' : 'right';
    const sessionId = generateSessionId();
    const timestamp = Date.now();
    const imageId = `img_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;

    sessionStorage.set(sessionId, {
      drawingDataUrl: dataUrl,
      timestamp,
      movementType,
      facingDirection: facing,
      imageId,
      expiresAt: Date.now() + SESSION_TTL_MS
    });

    console.log(`[${sessionId}] sendImage cat=${movementType} facing=${facing} bytes=${dataUrl.length}`);

    // Acknowledge synchronously so the iPad knows the sessionId BEFORE redirecting
    if (typeof ack === 'function') ack({ ok: true, sessionId });

    // Persisted shape for activeImages (no sessionId — that's a one-shot signal
    // for the screenshot, not part of the floating image's identity).
    const imageData = { id: imageId, dataUrl, movementType, facingDirection: facing, timestamp };

    // Enforce max images limit in "maxPaintings" mode
    if (serverSettings.galleryMode === "maxPaintings" && activeImages.length >= serverSettings.maxImages) {
      const oldestImage = activeImages.shift();
      if (serverSettings.maxImagesMode === "fade") {
        io.emit("image:startFade", oldestImage.id);
      } else {
        io.emit("admin:removeImageFromMain", oldestImage.id);
      }
      io.emit("admin:updateGallery", activeImages);
    }

    activeImages.push(imageData);
    io.emit("newImage", imageData);
    io.emit("admin:updateGallery", activeImages);
    // The wall-PC sees this newImage event and renders it; the headless
    // renderer (./lib/mainRenderer) is also subscribed via its own /main page,
    // so its view stays in sync automatically. Screenshot is taken at finalize
    // time directly off that headless page.
  });

  // Admin removes an image
  socket.on("admin:removeImage", (imageId) => {
    const index = activeImages.findIndex(img => img.id === imageId);
    if (index !== -1) {
      activeImages.splice(index, 1);
    }
    io.emit("admin:removeImageFromMain", imageId);
    io.emit("admin:updateGallery", activeImages);
  });

  // Send current gallery to newly connected admin
  socket.on("admin:requestGallery", () => {
    socket.emit("admin:updateGallery", activeImages);
  });

  // Send all current images to main canvas on request (reconnect/refresh)
  socket.on("main:requestAllImages", () => {
    socket.emit("main:allImages", { images: activeImages });
  });

  // Admin updates settings
  socket.on("admin:updateSettings", (newSettings) => {
    serverSettings.galleryMode = newSettings.galleryMode;
    serverSettings.maxImages = newSettings.maxImages;
    serverSettings.maxImagesMode = newSettings.maxImagesMode;
    serverSettings.normalizeSize = newSettings.normalizeSize !== false;
    serverSettings.foregroundPaintings = Number(newSettings.foregroundPaintings) || 10;
    serverSettings.midgroundPaintings = Number(newSettings.midgroundPaintings) || 10;
    serverSettings.backgroundPaintings = Number(newSettings.backgroundPaintings) || 10;
    serverSettings.foregroundOpacityMax = Number(newSettings.foregroundOpacityMax) || 1.0;
    serverSettings.foregroundOpacityMin = Number(newSettings.foregroundOpacityMin) || 0.7;
    serverSettings.midgroundOpacityMax = Number(newSettings.midgroundOpacityMax) || 0.69;
    serverSettings.midgroundOpacityMin = Number(newSettings.midgroundOpacityMin) || 0.4;
    serverSettings.backgroundOpacityMax = Number(newSettings.backgroundOpacityMax) || 0.39;
    serverSettings.backgroundOpacityMin = Number(newSettings.backgroundOpacityMin) || 0.1;
    saveSettings();
    io.emit("admin:updateSettings", serverSettings);
  });

  // Admin updates Theme Config
  socket.on("admin:updateConfig", (newConfig) => {
    serverConfig = newConfig;
    saveConfig();
    io.emit("config:changed", serverConfig);
  });

  // Admin saves config
  socket.on("saveConfig", (newConfig, callback) => {
    serverConfig = newConfig;
    saveConfig();
    io.emit("config:changed", serverConfig);
    if (callback) callback({ ok: true });
  });

  // Main display notifies that image is fully faded
  socket.on("image:faded", (imageId) => {
    const index = activeImages.findIndex(img => img.id === imageId);
    if (index !== -1) {
      activeImages.splice(index, 1);
      console.log(`Image ${imageId} faded out. Remaining: ${activeImages.length}`);
      io.emit("admin:updateGallery", activeImages);
    }
  });

  // Endscreen: user wants to save. Snapshots the headless wall page synchronously
  // and writes everything (drawing.png, main_canvas.png, metadata.json) into the
  // final folder.
  socket.on("finalizeArtwork", async ({ sessionId, userName }, ack) => {
    const reply = (payload) => { if (typeof ack === 'function') ack(payload); };

    const sess = sessionStorage.get(sessionId);
    if (!sess) {
      console.warn(`[${sessionId}] finalize: session not found`);
      reply({ ok: false, error: 'session_expired' });
      return;
    }

    const trimmed = (typeof userName === 'string' ? userName : '').trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      reply({ ok: false, error: 'invalid_name' });
      return;
    }

    // Build the final folder path (suffix-disambiguated)
    const sanitizedName = sanitizeUsername(trimmed);
    const dateStr = new Date(sess.timestamp)
      .toISOString()
      .replace(/[T:]/g, '_')
      .split('.')[0];
    let finalFolderName = `${sanitizedName}_${dateStr}`;
    let finalPath = path.join(SAVE_PATH, finalFolderName);
    let suffix = 1;
    while (fs.existsSync(finalPath)) {
      finalFolderName = `${sanitizedName}_${dateStr}_${suffix++}`;
      finalPath = path.join(SAVE_PATH, finalFolderName);
    }

    // Capture the wall via the headless renderer. Settle a bit so the just-
    // pushed newImage has been picked up by the headless page's animation loop.
    let mainCanvasBuffer = null;
    try {
      const rendererUrl = `http://127.0.0.1:${PORT}/main`;
      mainCanvasBuffer = await mainRenderer.captureMainScreenshot(rendererUrl, { settleMs: 700 });
    } catch (err) {
      console.error(`[${sessionId}] renderer error:`, err.message);
    }

    try {
      fs.mkdirSync(finalPath, { recursive: true });
      saveBase64Image(sess.drawingDataUrl, path.join(finalPath, 'drawing.png'));
      if (mainCanvasBuffer) {
        fs.writeFileSync(path.join(finalPath, 'main_canvas.png'), mainCanvasBuffer);
      }

      const metadata = {
        name: trimmed,
        sanitizedName,
        timestamp: sess.timestamp,
        date: new Date(sess.timestamp).toISOString(),
        movementType: sess.movementType || null,
        facingDirection: sess.facingDirection || 'right',
        hasScreenshot: !!mainCanvasBuffer
      };
      fs.writeFileSync(path.join(finalPath, 'metadata.json'), JSON.stringify(metadata, null, 2));

      console.log(`[${sessionId}] finalized → ${finalFolderName} (screenshot=${metadata.hasScreenshot})`);
      sessionStorage.delete(sessionId);
      reply({ ok: true, folder: finalFolderName, hasScreenshot: metadata.hasScreenshot });
    } catch (err) {
      console.error(`[${sessionId}] save failed:`, err);
      reply({ ok: false, error: 'save_failed', detail: err.message });
    }
  });

  // User chose not to save — drop the in-memory session, nothing on disk.
  socket.on("discardArtwork", ({ sessionId }, ack) => {
    if (sessionId && sessionStorage.has(sessionId)) {
      sessionStorage.delete(sessionId);
      console.log(`[${sessionId}] discarded by user`);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

});

// ----------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);

  // Boot the headless renderer in the background so the first finalize is fast.
  // We do this lazily after the HTTP server is listening, so the renderer can
  // actually load /main from the same process.
  mainRenderer.ensureReady(`http://127.0.0.1:${PORT}/main`).catch(err => {
    console.error('[renderer] failed to boot:', err.message);
  });
});

// Graceful shutdown — close Chromium so we don't leak processes
function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down…`);
  mainRenderer.shutdown().finally(() => process.exit(0));
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
