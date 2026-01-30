const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const TARGET_AREA = 50000; // pixels² for normalization
const MAX_PAINTING_SIZE = 250; // max width/height in pixels

let serverSettings = { 
    galleryMode: 'maxPaintings',
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
        this.zone = zone;
        this.layerAlpha = 1;
        this.fadeAlpha = 1;
        this.isFading = false;
        this.currentLayer = 'background'; // Will be set by redistributeLayers()
        
        // zufällige Position NUR innerhalb der Zone
        const yMin = canvas.height * (zone.yStartPct / 100);
        const yMax = canvas.height * (zone.yEndPct / 100) - img.height;

        this.x = Math.random() * Math.max(0, canvas.width - img.width);
        this.y = yMin + Math.random() * Math.max(0, yMax - yMin);

        this.vx = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);
        this.vy = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);
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

        // Fade: either in gallery fade mode OR if explicitly marked to fade
        const shouldFadeAll = serverSettings.galleryMode === 'fade';
        if (shouldFadeAll || this.isFading) {
            const prevFade = this.fadeAlpha;
            this.fadeAlpha = Math.max(0, this.fadeAlpha - 0.0005);
            
            // Notify server when image is fully faded
            if (prevFade > 0 && this.fadeAlpha === 0) {
                socket.emit('image:faded', this.id);
            }
        }
    }

    isFaded() {
        return this.fadeAlpha === 0;
    }

    draw() {
        ctx.globalAlpha = this.layerAlpha * this.fadeAlpha;
        ctx.drawImage(this.img, this.x, this.y);
        ctx.globalAlpha = 1;
    }
}

const activeImages = [];

// -------------------- LAYER DISTRIBUTION --------------------
function redistributeLayers() {
    const totalImages = activeImages.length;
    if (totalImages === 0) return;

    const fgCount = serverSettings.foregroundPaintings || 10;
    const mgCount = serverSettings.midgroundPaintings || 10;
    const bgCount = serverSettings.backgroundPaintings || 10;

    // Assign layers from newest (end of array) to oldest (start of array)
    activeImages.forEach((img, index) => {
        // Newest images first (from the end)
        const positionFromEnd = totalImages - 1 - index;

        if (positionFromEnd < fgCount) {
            img.currentLayer = 'foreground';
        } else if (positionFromEnd < fgCount + mgCount) {
            img.currentLayer = 'midground';
        } else {
            img.currentLayer = 'background';
        }
    });
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Redistribute layers before drawing
    redistributeLayers();

    // Group images by layer
    const layerGroups = {
        background: [],
        midground: [],
        foreground: []
    };

    activeImages.forEach(img => {
        layerGroups[img.currentLayer].push(img);
    });

    // Draw each layer with appropriate opacity
    ['background', 'midground', 'foreground'].forEach(layerName => {
        const group = layerGroups[layerName];
        const opacityRange = {
            min: serverSettings[layerName + 'OpacityMin'] !== undefined ? serverSettings[layerName + 'OpacityMin'] : 0.1,
            max: serverSettings[layerName + 'OpacityMax'] !== undefined ? serverSettings[layerName + 'OpacityMax'] : 1.0
        };

        group.forEach((img, localIndex) => {
            img.update();

            // Calculate opacity for this image within its layer
            if (group.length === 1) {
                img.layerAlpha = opacityRange.max;
            } else {
                const progress = (localIndex + 1) / group.length;
                img.layerAlpha = opacityRange.min + (opacityRange.max - opacityRange.min) * progress;
            }

            if (img.fadeAlpha > 0) img.draw();

            // Mark faded images for removal
            if (img.isFaded()) {
                const globalIndex = activeImages.indexOf(img);
                if (globalIndex !== -1) activeImages.splice(globalIndex, 1);
            }
        });
    });

    requestAnimationFrame(animate);
}
animate();

// INITIAL CONFIG LOAD
socket.on("app:init", (d) => {
    const config = d.config || d;
    const settings = d.settings || { 
        galleryMode: 'fade', 
        maxImages: 30, 
        maxImagesMode: 'fade',
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
    
    serverSettings = Object.assign({}, serverSettings, settings);

    const themeName = config.activeTheme;
    const theme = config.themes[themeName];
    themeConfig = theme;
    activeImages.length = 0; // Clear previous images

    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;

    // Hintergrund laden
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(theme.image)}")`;
    
    // Request all current images from server
    socket.emit("main:requestAllImages");
});

// CONFIG CHANGED (when admin switches theme)
socket.on("config:changed", (config) => {
    const themeName = config.activeTheme;
    const theme = config.themes[themeName];
    themeConfig = theme;
    activeImages.length = 0; // Clear active images

    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;

    // Update background
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(theme.image)}")`;
});

// SETTINGS UPDATE
socket.on("admin:updateSettings", (settings) => {
    serverSettings = Object.assign({}, serverSettings, settings);
    statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;
});

// Bild kommt an, mit Zone-ID und eindeutiger ID
socket.on("newImage", ({ id, dataUrl, zoneId }) => {
    const img = new Image();
    img.onload = () => {
        const zone = themeConfig.zones.find(z => z.id === zoneId);
        
        let finalImg = img;
        
        // Normalize size if enabled
        if (serverSettings.normalizeSize) {
            const aspectRatio = img.width / img.height;
            let newWidth, newHeight;
            
            // Scale to fit within MAX_PAINTING_SIZE, preserving aspect ratio
            if (aspectRatio > 1) {
                // Wider than tall
                newWidth = MAX_PAINTING_SIZE;
                newHeight = MAX_PAINTING_SIZE / aspectRatio;
            } else {
                // Taller than wide
                newHeight = MAX_PAINTING_SIZE;
                newWidth = MAX_PAINTING_SIZE * aspectRatio;
            }
            
            // Create canvas with max size, center the image (letterbox style)
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = MAX_PAINTING_SIZE;
            tempCanvas.height = MAX_PAINTING_SIZE;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Fill with transparent background
            tempCtx.clearRect(0, 0, MAX_PAINTING_SIZE, MAX_PAINTING_SIZE);
            
            // Center the image
            const x = (MAX_PAINTING_SIZE - newWidth) / 2;
            const y = (MAX_PAINTING_SIZE - newHeight) / 2;
            tempCtx.drawImage(img, x, y, newWidth, newHeight);
            
            finalImg = new Image();
            finalImg.src = tempCanvas.toDataURL();
        }
        
        activeImages.push(new FloatingImage(id, finalImg, zone));
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

// Server signals to fade out an image (when max reached in fade mode)
socket.on("image:startFade", (imageId) => {
const img = activeImages.find(img => img.id === imageId);
if (img) {
    img.isFading = true; // Mark for fading
    console.log("Image marked for fade:", imageId);
} else {
    console.log("Image not found for fade:", imageId);
}
});

// Receive all current images from server (on reconnect/refresh)
socket.on("main:allImages", ({ images }) => {
    activeImages.length = 0; // Clear current array
    images.forEach(imageData => {
        const img = new Image();
        img.onload = () => {
            const zone = themeConfig.zones.find(z => z.id === imageData.zoneId);
            
            let finalImg = img;
            
            // Normalize size if enabled
            if (serverSettings.normalizeSize) {
                const aspectRatio = img.width / img.height;
                let newWidth, newHeight;
                
                if (aspectRatio > 1) {
                    newWidth = MAX_PAINTING_SIZE;
                    newHeight = MAX_PAINTING_SIZE / aspectRatio;
                } else {
                    newHeight = MAX_PAINTING_SIZE;
                    newWidth = MAX_PAINTING_SIZE * aspectRatio;
                }
                
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = MAX_PAINTING_SIZE;
                tempCanvas.height = MAX_PAINTING_SIZE;
                const tempCtx = tempCanvas.getContext('2d');
                
                tempCtx.clearRect(0, 0, MAX_PAINTING_SIZE, MAX_PAINTING_SIZE);
                
                const x = (MAX_PAINTING_SIZE - newWidth) / 2;
                const y = (MAX_PAINTING_SIZE - newHeight) / 2;
                tempCtx.drawImage(img, x, y, newWidth, newHeight);
                
                finalImg = new Image();
                finalImg.src = tempCanvas.toDataURL();
            }
            
            activeImages.push(new FloatingImage(imageData.id, finalImg, zone));
        };
        img.src = imageData.dataUrl;
    });
});

// Screenshot (disabled in HTML)
// document.getElementById('screenshot').addEventListener('click', () => {
// const link = document.createElement('a');
// link.href = canvas.toDataURL('image/png');
// link.download = `main_${Date.now()}.png`;
// link.click();
// });