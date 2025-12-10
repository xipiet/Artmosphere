// -------------------- main.js --------------------
const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// Settings and theme
let serverSettings = { fade: true };
let themeConfig = null;

// Target area for each image (all images have same "square footage")
const TARGET_AREA = 20000; // pixels²

// Maximum images on canvas
const MAX_IMAGES = 30;

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

        const yMin = canvas.height * (this.zone.yStartPct / 100);
        const yMax = canvas.height * (this.zone.yEndPct / 100) - this.img.height;

        if (this.x <= 0 || this.x + this.img.width >= canvas.width) this.vx *= -1;
        if (this.y <= yMin || this.y >= yMax) this.vy *= -1;

        // -------------------- OLD TIME-BASED FADING (commented) --------------------
        /*
        if (serverSettings.fade) {
            this.alpha = Math.max(0, this.alpha - 0.0005);
        } else {
            this.alpha = 1;
        }
        */
        // -------------------------------------------------------------------------------
    }

    draw() {
        ctx.globalAlpha = this.alpha;
        ctx.drawImage(this.img, this.x, this.y);
        ctx.globalAlpha = 1;
    }
}

// Array to store active images
const activeImages = [];

// -------------------- Animation Loop --------------------
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const len = activeImages.length;

    activeImages.forEach((obj, index) => {
        obj.update(); // position & bounce

        // -------------------- ORDER-BASED FADING WITH MAX_IMAGES --------------------
        if (serverSettings.fade && len > 1) {
            const MIN_ALPHA = 0.1;

            // Determine "visible window" of last MAX_IMAGES
            const startIndex = Math.max(0, len - MAX_IMAGES);
            if (index < startIndex) {
                // Oldest images beyond limit are invisible
                obj.alpha = 0;
            } else {
                // Scale alpha linearly within visible window
                const visibleIndex = index - startIndex;
                const visibleLen = len - startIndex;
                obj.alpha = MIN_ALPHA + (1 - MIN_ALPHA) * ((visibleIndex + 1) / visibleLen);
            }
        } else {
            obj.alpha = 1; // fully opaque if fade off or only one image
        }
        // ------------------------------------------------------------

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
    activeImages.length = 0;
    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(themeConfig.image)}")`;
});

// Settings update
socket.on("admin:updateSettings", (settings) => {
    serverSettings = settings;
    statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${settings.fade ? 'ON' : 'OFF'}`;
});

// New image arrives
socket.on("newImage", ({ id, dataUrl, zoneId }) => {
    const img = new Image();
    img.onload = () => {
        const zone = themeConfig?.zones.find(z => z.id === zoneId);
        if (!zone) return console.warn("Zone not found:", zoneId);

        const aspectRatio = img.width / img.height;
        const newWidth = Math.sqrt(TARGET_AREA * aspectRatio);
        const newHeight = TARGET_AREA / newWidth;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = newWidth;
        tempCanvas.height = newHeight;
        tempCanvas.getContext('2d').drawImage(img, 0, 0, newWidth, newHeight);

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
