const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const settings = {
  fade: true
};

// Statische Dateien
app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.png'));
});

app.get('/', (req, res) => 
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);
app.get('/main', (req, res) => res.sendFile(path.join(__dirname, 'public', 'main.html')));
app.get('/ipad', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ipad.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Socket.io: broadcast an Main + Admin-Updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Sende beim Verbinden die aktuellen Settings an den Client
  socket.emit('admin:init', settings);

  socket.on('sendImage', (dataUrl) => {
    // Spez. Event bleibt unverändert: alle Clients bekommen das neue Bild
    io.emit('newImage', dataUrl);
  });

  // Admin sendet Updates (z.B. toggle fade). Wir speichern und broadcasten sofort.
  socket.on('admin:update', (newSettings) => {
    // Nur erlaubte Felder updaten (minimal)
    if (typeof newSettings.fade === 'boolean') {
      settings.fade = newSettings.fade;
    }
    // Broadcast an alle Clients -> main/pads reagieren darauf
    io.emit('admin:update', settings);
    console.log('Admin updated settings:', settings);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
