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

app.get("/ipad-kids", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ipad-kids.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/kritiker", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kritiker.html"));
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

  // Kids Mode (saved per device)
  if (!global.deviceModes) global.deviceModes = {};
  if (!global.deviceModes[socket.id]) {
    global.deviceModes[socket.id] = { kidsMode: false };
  }

  // tell device its current mode
  socket.emit("kidsMode:update", global.deviceModes[socket.id]);

  // device toggles its own kidsMode
  socket.on("kidsMode:set", (isActive) => {
    global.deviceModes[socket.id].kidsMode = isActive;
    socket.emit("kidsMode:update", { kidsMode: isActive });
    console.log(`KidsMode for ${socket.id} = ${isActive}`);
  });

  // Admin sets kidsMode for specific device
  socket.on("admin:kidsModeSet", ({ targetId, isActive }) => {
    if (global.deviceModes[targetId]) {
      global.deviceModes[targetId].kidsMode = isActive;
      io.to(targetId).emit("kidsMode:update", { kidsMode: isActive });
      console.log(`Admin set KidsMode for ${targetId} = ${isActive}`);
    }
  });

  // Init: send theme + server settings
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
    const imageData = {
      id: imageId, dataUrl, movementType, facingDirection: facing, timestamp,
      score: 0,
      votes: { veryGood: 0, good: 0, bad: 0, veryBad: 0 }
    };

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

  // Kritiker rates an image with a 4-tier scale.
  // Layer movement = |delta| steps toward foreground (+) or background (-).
  // Glow tier scales with score. Image dropped when score <= -3 AND in BG.
  const RATE_DELTA = { veryGood: +2, good: +1, bad: -1, veryBad: -2 };

  function moveOneStep(image, direction) {
    // direction: +1 = toward foreground, -1 = toward background
    // Returns true if image was deleted (BG + threshold met).
    const idx = activeImages.findIndex(img => img.id === image.id);
    if (idx === -1) return false;
    const totalBefore = activeImages.length;
    const positionFromEnd = totalBefore - 1 - idx;
    const fgCount = serverSettings.foregroundPaintings || 10;
    const mgCount = serverSettings.midgroundPaintings || 10;

    activeImages.splice(idx, 1);

    if (direction > 0) {
      if (positionFromEnd < fgCount) {
        // Already FG — go to the very end (foreground-most)
        activeImages.push(image);
      } else if (positionFromEnd < fgCount + mgCount) {
        // MG → FG: land just inside FG
        const newIndex = activeImages.length - fgCount + 1;
        activeImages.splice(Math.min(activeImages.length, Math.max(0, newIndex)), 0, image);
      } else {
        // BG → MG
        const newIndex = activeImages.length - fgCount - mgCount + 1;
        activeImages.splice(Math.max(0, newIndex), 0, image);
      }
      return false;
    } else {
      if (positionFromEnd < fgCount) {
        // FG → MG
        const newIndex = activeImages.length - fgCount;
        activeImages.splice(Math.max(0, newIndex), 0, image);
      } else if (positionFromEnd < fgCount + mgCount) {
        // MG → BG
        const newIndex = activeImages.length - fgCount - mgCount;
        activeImages.splice(Math.max(0, newIndex), 0, image);
      } else if (image.score <= -3) {
        // BG and unloved enough — drop it
        io.emit("admin:removeImageFromMain", image.id);
        return true;
      } else {
        // Stay in BG (front of array)
        activeImages.splice(0, 0, image);
      }
      return false;
    }
  }

  socket.on("kritiker:rateImage", ({ imageId, rating } = {}, ack) => {
    const reply = (payload) => { if (typeof ack === 'function') ack(payload); };
    const delta = RATE_DELTA[rating];
    if (delta === undefined) {
      reply({ ok: false, error: 'invalid_rating' });
      return;
    }

    const image = activeImages.find(img => img.id === imageId);
    if (!image) {
      reply({ ok: false, error: 'not_found' });
      return;
    }

    if (!image.votes) image.votes = { veryGood: 0, good: 0, bad: 0, veryBad: 0 };
    image.votes[rating] = (image.votes[rating] || 0) + 1;
    image.score = (image.score || 0) + delta;

    // "veryGood" jumps straight to the end — most prominent foreground slot.
    // For all other deltas, move |delta| layers in the appropriate direction.
    let removed = false;
    if (rating === 'veryGood') {
      const idx = activeImages.findIndex(img => img.id === imageId);
      if (idx !== -1) {
        activeImages.splice(idx, 1);
        activeImages.push(image);
      }
    } else {
      const direction = delta > 0 ? 1 : -1;
      const steps = Math.abs(delta);
      for (let i = 0; i < steps; i++) {
        if (moveOneStep(image, direction)) { removed = true; break; }
      }
    }

    if (removed) {
      io.emit("admin:updateGallery", activeImages);
      reply({ ok: true, removed: true, score: image.score, votes: image.votes });
      return;
    }

    io.emit("image:voteUpdate", { id: imageId, score: image.score, votes: image.votes });
    io.emit("admin:updateGallery", activeImages);
    reply({ ok: true, score: image.score, votes: image.votes });
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
    const opacity = (v, def) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.min(Math.max(n, 0), 1);
    };
    serverSettings.foregroundOpacityMax = opacity(newSettings.foregroundOpacityMax, 1.0);
    serverSettings.foregroundOpacityMin = opacity(newSettings.foregroundOpacityMin, 0.7);
    serverSettings.midgroundOpacityMax = opacity(newSettings.midgroundOpacityMax, 0.69);
    serverSettings.midgroundOpacityMin = opacity(newSettings.midgroundOpacityMin, 0.4);
    serverSettings.backgroundOpacityMax = opacity(newSettings.backgroundOpacityMax, 0.39);
    serverSettings.backgroundOpacityMin = opacity(newSettings.backgroundOpacityMin, 0.1);
    saveSettings();
    io.emit("admin:updateSettings", serverSettings);
  });

  // Admin updates Theme Config
  socket.on("admin:updateConfig", (newConfig) => {
    serverConfig = newConfig;
    saveConfig();
    io.emit("config:changed", serverConfig);
  });

  socket.on("saveConfig", (newConfig, callback) => {
    serverConfig = newConfig;
    saveConfig();
    io.emit("config:changed", serverConfig);
    if (callback) callback({ ok: true });
  });

  // Admin tunes per-category ranges (yMin/yMax/speedMin/speedMax) without
  // wiping the wall: mutate in place, persist, broadcast targeted event.
  socket.on("admin:updateCategoryRanges", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const { themeName, categoryId } = payload;
    const theme = serverConfig && serverConfig.themes && serverConfig.themes[themeName];
    if (!theme || !Array.isArray(theme.categories)) return;
    const cat = theme.categories.find(c => c.id === categoryId);
    if (!cat) return;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const yMin = clamp(Number(payload.yMinPct), 0, 100);
    const yMaxRaw = clamp(Number(payload.yMaxPct), 0, 100);
    const yMax = Math.max(yMin, yMaxRaw);
    const sMin = Math.max(0, Number(payload.speedMin));
    const sMax = Math.max(sMin, Number(payload.speedMax));
    const scaleRaw = Number(payload.scalePct);
    const scale = Number.isFinite(scaleRaw) ? clamp(scaleRaw, 10, 400) : (Number.isFinite(cat.scalePct) ? cat.scalePct : 100);
    if (![yMin, yMax, sMin, sMax].every(Number.isFinite)) return;
    cat.yMinPct = yMin;
    cat.yMaxPct = yMax;
    cat.speedMin = sMin;
    cat.speedMax = sMax;
    cat.scalePct = scale;
    saveConfig();
    io.emit("category:rangesChanged", {
      themeName, categoryId,
      yMinPct: yMin, yMaxPct: yMax, speedMin: sMin, speedMax: sMax, scalePct: scale
    });
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

      const liveImage = activeImages.find(img => img.id === sess.imageId);
      const metadata = {
        name: trimmed,
        sanitizedName,
        timestamp: sess.timestamp,
        date: new Date(sess.timestamp).toISOString(),
        movementType: sess.movementType || null,
        facingDirection: sess.facingDirection || 'right',
        hasScreenshot: !!mainCanvasBuffer,
        score: liveImage ? (liveImage.score || 0) : 0,
        votes: liveImage && liveImage.votes
          ? liveImage.votes
          : { veryGood: 0, good: 0, bad: 0, veryBad: 0 }
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
