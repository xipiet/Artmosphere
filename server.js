// -------------------- server.js --------------------
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
const settingsPath = path.join(__dirname, "settings.json"); // NEW: persistent settings

let serverConfig = {};
let serverSettings = {
  fade: true,
  movement: "floating",    // NEW default
  normalizeSize: true,     // NEW default
  maxImages: 30,           // NEW default
  hopSpeed: 0.05,          // NEW default hop speed
  floatSpeed: 1            // NEW default float speed
};
let activeImages = []; // Store active paintings { id, dataUrl, zoneId, timestamp }

// -------------------- Load Config --------------------
function loadConfig() {
  try {
    serverConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("Theme config loaded:", serverConfig.activeTheme);
  } catch (err) {
    console.error("ERROR loading config.json:", err);
  }
}
loadConfig();

// -------------------- Load Settings --------------------
function loadSettings() { // NEW: persistent settings
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

// Save config.json
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2), "utf8");
  console.log("Theme config saved.");
}

// Save server settings (NEW)
function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(serverSettings, null, 2), "utf8");
  console.log("Server settings saved.");
}

// ----------------------------------
// Static Files (public folder)
// ----------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ----------------------------------
// Routes
// ----------------------------------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/main", (req, res) => res.sendFile(path.join(__dirname, "public", "main.html")));
app.get("/ipad", (req, res) => res.sendFile(path.join(__dirname, "public", "ipad.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// ----------------------------------
// Theme Image Route
// ----------------------------------
app.get("/theme-image/:filename", (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  let filePath;
  
  if (path.isAbsolute(filename)) {
    filePath = filename;
  } else {
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

  // -------------------- iPad sends new image --------------------
  socket.on("sendImage", ({ dataUrl, zoneId }) => {
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const imageData = { id: imageId, dataUrl, zoneId, timestamp: Date.now() };
    activeImages.push(imageData);
    
    io.emit("newImage", imageData);
    io.emit("admin:updateGallery", activeImages);
  });

  // -------------------- Admin removes an image --------------------
  socket.on("admin:removeImage", (imageId) => {
    const index = activeImages.findIndex(img => img.id === imageId);
    if (index !== -1) activeImages.splice(index, 1);
    io.emit("admin:removeImageFromMain", imageId);
    io.emit("admin:updateGallery", activeImages);
  });

  // Send current gallery to newly connected admin
  socket.on("admin:requestGallery", () => {
    socket.emit("admin:updateGallery", activeImages);
  });

  // -------------------- Admin updates settings --------------------
  socket.on("admin:updateSettings", (newSettings) => {
    // Merge instead of overwrite (NEW)
    serverSettings = { ...serverSettings, ...newSettings };

    // Normalize types & defaults (NEW)
    serverSettings.fade = !!serverSettings.fade;
    serverSettings.movement = serverSettings.movement || "floating";
    serverSettings.normalizeSize = serverSettings.normalizeSize !== false;
    serverSettings.maxImages = Number(serverSettings.maxImages) || 30;
    serverSettings.hopSpeed = Number(serverSettings.hopSpeed) || 0.05;
    serverSettings.floatSpeed = Number(serverSettings.floatSpeed) || 1;

    console.log("Updated serverSettings:", serverSettings);

    saveSettings(); // persist settings (NEW)
    
    // Broadcast merged settings to ALL clients
    io.emit("admin:updateSettings", serverSettings);
  });

  // -------------------- Admin updates theme config --------------------
  socket.on("admin:updateConfig", (newConfig) => {
    serverConfig = newConfig;
    saveConfig();
    io.emit("config:changed", serverConfig);
  });

  // -------------------- Admin saves full config --------------------
  socket.on("saveConfig", (newConfig, callback) => {
    serverConfig = newConfig;
    saveConfig();
    io.emit("config:changed", serverConfig);
    if (callback) callback({ ok: true });
  });
});

// ----------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
