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

let serverConfig = {};
let serverSettings = {
  fade: true
};
let activeImages = []; // Store active paintings { id, dataUrl, zoneId, timestamp }

// Load config.json
function loadConfig() {
  try {
    serverConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("Theme config loaded:", serverConfig.activeTheme);
  } catch (err) {
    console.error("ERROR loading config.json:", err);
  }
}
loadConfig();

// Save config.json
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2), "utf8");
  console.log("Theme config saved.");
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

  // iPad sends image + zone
  socket.on("sendImage", ({ dataUrl, zoneId }) => {
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const imageData = { id: imageId, dataUrl, zoneId, timestamp: Date.now() };
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

  // Admin toggles fade
  socket.on("admin:updateSettings", (newSettings) => {
    serverSettings = newSettings;
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
