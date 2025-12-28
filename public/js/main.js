const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

let serverSettings = { fade: true };
let themeConfig = null;

function resizeCanvas() {
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class FloatingImage {
constructor(id, img, zone) {
    this.id = id;
    this.img = img;
    
    // zufällige Position NUR innerhalb der Zone
    const yMin = canvas.height * (zone.yStartPct / 100);
    const yMax = canvas.height * (zone.yEndPct / 100) - img.height;

    this.x = Math.random() * Math.max(0, canvas.width - img.width);
    this.y = yMin + Math.random() * Math.max(0, yMax - yMin);

    this.vx = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);
    this.vy = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);

    this.zone = zone;
    this.alpha = 1;
}

update() {
    this.x += this.vx;
    this.y += this.vy;

    // Bounce nur in Zone
    const yMin = canvas.height * (this.zone.yStartPct / 100);
    const yMax = canvas.height * (this.zone.yEndPct / 100) - this.img.height;

    if (this.x <= 0 || this.x + this.img.width >= canvas.width) {
    this.vx *= -1;
    }
    if (this.y <= yMin || this.y >= yMax) {
    this.vy *= -1;
    }

    // Fade
    if (serverSettings.fade) {
    const prevAlpha = this.alpha;
    this.alpha = Math.max(0, this.alpha - 0.0005);
    
    // Notify server when image is fully faded
    if (prevAlpha > 0 && this.alpha === 0) {
        socket.emit('image:faded', this.id);
    }
    } else {
    this.alpha = 1;
    }
}

isFaded() {
    return this.alpha === 0;
}

draw() {
    ctx.globalAlpha = this.alpha;
    ctx.drawImage(this.img, this.x, this.y);
    ctx.globalAlpha = 1;
}
}

const activeImages = [];

function animate() {
ctx.clearRect(0, 0, canvas.width, canvas.height);

// Update and draw, then remove fully faded images
for (let i = activeImages.length - 1; i >= 0; i--) {
    activeImages[i].update();
    activeImages[i].draw();
    
    // Remove if fully faded
    if (activeImages[i].isFaded()) {
        activeImages.splice(i, 1);
    }
}

requestAnimationFrame(animate);
}
animate();

// INITIAL CONFIG LOAD
socket.on("app:init", ({ config, settings }) => {
serverSettings = settings;

const themeName = config.activeTheme;
const theme = config.themes[themeName];
themeConfig = theme;

statusEl.textContent = `theme: ${themeName} | fade: ${settings.fade ? 'ON' : 'OFF'}`;

// Hintergrund laden
canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(theme.image)}")`;
});

// CONFIG CHANGED (when admin switches theme)
socket.on("config:changed", (config) => {
const themeName = config.activeTheme;
const theme = config.themes[themeName];
themeConfig = theme;
activeImages.length = 0; // Clear active images

statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;

// Update background
canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(theme.image)}")`;
});

// SETTINGS UPDATE
socket.on("admin:updateSettings", (settings) => {
serverSettings = settings;
statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${settings.fade ? 'ON' : 'OFF'}`;
});

// Bild kommt an, mit Zone-ID und eindeutiger ID
socket.on("newImage", ({ id, dataUrl, zoneId }) => {
const img = new Image();
img.onload = () => {
    const zone = themeConfig.zones.find(z => z.id === zoneId);
    activeImages.push(new FloatingImage(id, img, zone));
};
img.src = dataUrl;
});

// Admin removed an image - filter it out from activeImages
socket.on("admin:removeImageFromMain", (imageId) => {
const index = activeImages.findIndex(img => img.id === imageId);
if (index !== -1) {
    activeImages.splice(index, 1);
    console.log("Image removed. Remaining:", activeImages.length);
} else {
    console.log("Image not found:", imageId);
}
});

// Screenshot
document.getElementById('screenshot').addEventListener('click', () => {
const link = document.createElement('a');
link.href = canvas.toDataURL('image/png');
link.download = `main_${Date.now()}.png`;
link.click();
});