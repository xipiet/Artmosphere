const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// Global settings and theme
let serverSettings = { fade: true };
let themeConfig = null;

// Target area for each image (all images have same "square footage")
const TARGET_AREA = 20000; // pixels²

// Resize canvas to fit window
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// -------------------- FloatingImage Class --------------------
class FloatingImage {
    constructor(id, img, zone) {
        this.id = id;
        this.img = img;

        // Position randomly inside vertical zone
        const yMin = canvas.height * (zone.yStartPct / 100);
        const yMax = canvas.height * (zone.yEndPct / 100) - img.height;

        this.x = Math.random() * Math.max(0, canvas.width - img.width);
        this.y = yMin + Math.random() * Math.max(0, yMax - yMin);

        // Random movement velocities
        this.vx = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);
        this.vy = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);

        this.zone = zone;
        this.alpha = 1; // Opacity for fading
    }

    // Update position, handle bouncing, and fade
    update() {
        this.x += this.vx;
        this.y += this.vy;

        const yMin = canvas.height * (this.zone.yStartPct / 100);
        const yMax = canvas.height * (this.zone.yEndPct / 100) - this.img.height;

        if (this.x <= 0 || this.x + this.img.width >= canvas.width) this.vx *= -1;
        if (this.y <= yMin || this.y >= yMax) this.vy *= -1;

        if (serverSettings.fade) this.alpha = Math.max(0, this.alpha - 0.0005);
        else this.alpha = 1;
    }

    // Draw image
    draw() {
        ctx.globalAlpha = this.alpha;
        ctx.drawImage(this.img, this.x, this.y);
        ctx.globalAlpha = 1;
    }
}

// Array to store active images
const activeImages = [];

// Animation loop
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    activeImages.forEach(obj => {
        obj.update();
        obj.draw();
    });

    requestAnimationFrame(animate);
}
animate();

// -------------------- Socket Events --------------------

// Initial config load
socket.on("app:init", ({ config, settings }) => {
    serverSettings = settings;
    const themeName = config.activeTheme;
    themeConfig = config.themes[themeName];
    statusEl.textContent = `theme: ${themeName} | fade: ${settings.fade ? 'ON' : 'OFF'}`;
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(themeConfig.image)}")`;
});

// Theme change
socket.on("config:changed", (config) => {
    const themeName = config.activeTheme;
    themeConfig = config.themes[themeName];
    activeImages.length = 0; // clear existing images
    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(themeConfig.image)}")`;
});

// Settings update (fade toggle)
socket.on("admin:updateSettings", (settings) => {
    serverSettings = settings;
    statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${settings.fade ? 'ON' : 'OFF'}`;
});

// New image arrives (from server or user)
socket.on("newImage", ({ id, dataUrl, zoneId }) => {
    const img = new Image();
    img.onload = () => {
        const zone = themeConfig?.zones.find(z => z.id === zoneId);
        if (!zone) return console.warn("Zone not found:", zoneId);

        // Resize image to same target area while preserving aspect ratio
        const aspectRatio = img.width / img.height;
        const newWidth = Math.sqrt(TARGET_AREA * aspectRatio);
        const newHeight = TARGET_AREA / newWidth;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = newWidth;
        tempCanvas.height = newHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0, newWidth, newHeight);

        const resizedImg = new Image();
        resizedImg.onload = () => {
            activeImages.push(new FloatingImage(id, resizedImg, zone));
        };
        resizedImg.src = tempCanvas.toDataURL();
    };
    img.src = dataUrl;
});

// Admin removes an image
socket.on("admin:removeImageFromMain", (imageId) => {
    const index = activeImages.findIndex(img => img.id === imageId);
    if (index !== -1) activeImages.splice(index, 1);
});

// Screenshot
document.getElementById('screenshot').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `main_${Date.now()}.png`;
    link.click();
});
