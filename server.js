const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
let activeImages = []; // Store active paintings { id, dataUrl, zoneId, timestamp }

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

app.get("/ipad2", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ipad2.html"));
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

  // iPad sends image + zone (ipad.html) OR image + movementType (ipad2.html)
  socket.on("sendImage", ({ dataUrl, zoneId, movementType }) => {
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Support both old (zoneId) and new (movementType) systems
    let imageData;
    if (movementType) {
      // ipad2 system: category-based movement
      imageData = { id: imageId, dataUrl, movementType, timestamp: Date.now() };
    } else {
      // ipad system: zone-based movement
      imageData = { id: imageId, dataUrl, zoneId, timestamp: Date.now() };
    }
    
    // Only enforce max images limit in "maxPaintings" mode
    if (serverSettings.galleryMode === "maxPaintings" && activeImages.length >= serverSettings.maxImages) {
      const oldestImage = activeImages.shift();
      console.log(`Max images reached (${serverSettings.maxImages}). Removing oldest: ${oldestImage.id}`);
      
      if (serverSettings.maxImagesMode === "fade") {
        // Signal to main canvas to fade out the oldest image
        io.emit("image:startFade", oldestImage.id);
      } else {
        // Remove immediately from all displays
        io.emit("admin:removeImageFromMain", oldestImage.id);
      }
      // Update gallery view in admin
      io.emit("admin:updateGallery", activeImages);
    }
    
    activeImages.push(imageData);
    
    io.emit("newImage", imageData);
    io.emit("admin:updateGallery", activeImages);
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
});

// ----------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
