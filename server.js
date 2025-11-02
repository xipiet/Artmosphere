const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statische Dateien
app.use(express.static(path.join(__dirname, 'public')));

app.get('/main', (req, res) => res.sendFile(path.join(__dirname, 'public', 'main.html')));
app.get('/ipad', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ipad.html')));

// Socket.io: broadcast an Main
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('sendImage', (dataUrl) => {
    io.emit('newImage', dataUrl); // alle Clients (inkl. /main) erhalten Bild
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
