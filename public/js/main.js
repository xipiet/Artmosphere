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
    constructor(id, img, category, facingDirection = 'right', score = 0) {
        this.id = id;
        this.img = img;
        this.category = category; // { id, style, yMinPct, yMaxPct, speedMin, speedMax, ... }
        this.movementType = category ? category.id : null;
        this.style = (category && category.style) || (category && category.id) || 'plain';
        this.facingDirection = facingDirection === 'left' ? 'left' : 'right';
        this.layerAlpha = 1;
        this.fadeAlpha = 1;
        this.isFading = false;
        this.currentLayer = 'background';
        this.age = Math.random() * 1000;
        this.rotation = 0;
        this.score = score;

        this.initializeMovement();
        this.applyInitialDirection();
    }

    applyInitialDirection() {
        const direction = this.facingDirection === 'left' ? -1 : 1;
        this.vx = Math.abs(this.vx) * direction;
    }

    get scaleFactor() {
        const s = this.category && Number(this.category.scalePct);
        return Number.isFinite(s) && s > 0 ? s / 100 : 1;
    }

    get w() { return this.img.width * this.scaleFactor; }
    get h() { return this.img.height * this.scaleFactor; }

    bounceHorizontally() {
        const maxX = Math.max(0, canvas.width - this.w);
        if (this.x <= 0) {
            this.x = 0;
            this.vx = Math.abs(this.vx);
        } else if (this.x >= maxX) {
            this.x = maxX;
            this.vx = -Math.abs(this.vx);
        }
    }

    yBounds() {
        const cat = this.category;
        const yMin = canvas.height * (cat.yMinPct / 100);
        const yMax = Math.max(yMin, canvas.height * (cat.yMaxPct / 100) - this.h);
        return { yMin, yMax };
    }

    randomSpeed() {
        const cat = this.category;
        return cat.speedMin + Math.random() * (cat.speedMax - cat.speedMin);
    }

    initializeMovement() {
        const { yMin, yMax } = this.yBounds();
        this.x = Math.random() * Math.max(0, canvas.width - this.w);
        this.baseY = yMin + Math.random() * Math.max(0, yMax - yMin);
        this.y = this.baseY;
        this.vx = this.randomSpeed() * (Math.random() < 0.5 ? 1 : -1);

        if (this.style === 'car') {
            this.vy = (Math.random() * 0.012 + 0.006) * (Math.random() < 0.5 ? 1 : -1);
            this.drivePhase = Math.random() * Math.PI * 2;
            this.driveSpeed = Math.random() * 0.025 + 0.025;
            this.bumpAmplitude = Math.random() * 2.2 + 1.2;
            this.laneDriftAmplitude = Math.random() * 8 + 4;
            this.rollAmplitude = Math.random() * 0.012 + 0.008;
        } else if (this.style === 'airplane') {
            this.vy = (Math.random() * 0.01 + 0.004) * (Math.random() < 0.5 ? 1 : -1);
            this.flightPhase = Math.random() * Math.PI * 2;
            this.flightSpeed = Math.random() * 0.011 + 0.008;
            this.altitudeAmplitude = Math.random() * 10 + 16;
            this.bankAmplitude = Math.random() * 0.05 + 0.03;
            this.gustAmplitude = Math.random() * 2 + 1.5;
        } else if (this.style === 'watercraft') {
            this.vy = (Math.random() * 0.025 + 0.01) * (Math.random() < 0.5 ? 1 : -1);
            this.wavePhase = Math.random() * Math.PI * 2;
            this.waveSpeed = Math.random() * 0.018 + 0.014;
            this.bobAmplitude = Math.random() * 7 + 5;
            this.driftAmplitude = Math.random() * 18 + 10;
            this.rollAmplitude = Math.random() * 0.035 + 0.025;
        } else {
            // 'pedestrian' or 'plain': straight horizontal
            this.vy = 0;
        }
    }

    update() {
        this.age += 1;
        this.x += this.vx;

        if (this.style === 'pedestrian' || this.style === 'plain') {
            this.y += this.vy;
            this.bounceHorizontally();
            const { yMin, yMax } = this.yBounds();
            if (this.y < yMin) this.y = yMin;
            if (this.y > yMax) this.y = yMax;
        } else {
            // Animated styles share a common base-band drift + sinusoidal motion
            this.bounceHorizontally();
            const { yMin, yMax } = this.yBounds();
            this.baseY += this.vy;
            if (yMax === yMin) {
                this.baseY = yMin;
                this.vy = 0;
            } else if (this.baseY <= yMin || this.baseY >= yMax) {
                this.vy *= -1;
                this.baseY = Math.min(Math.max(this.baseY, yMin), yMax);
            }

            if (this.style === 'car') {
                const road = this.age * this.driveSpeed + this.drivePhase;
                const bump = Math.sin(road * 3.6) * this.bumpAmplitude;
                const laneDrift = Math.sin(road * 0.45) * this.laneDriftAmplitude;
                const speedPulse = 1 + Math.sin(road * 1.4) * 0.09;
                this.x += this.vx * (speedPulse - 1);
                this.bounceHorizontally();
                this.y = this.baseY + laneDrift + bump;
                this.rotation = Math.sin(road * 2.4) * this.rollAmplitude;
            } else if (this.style === 'airplane') {
                const flight = this.age * this.flightSpeed + this.flightPhase;
                const prevY = this.y;
                const altitude = Math.sin(flight * 0.5) * this.altitudeAmplitude;
                const turbulence = Math.sin(flight * 1.9) * this.gustAmplitude;
                const speedPulse = 1 + Math.sin(flight * 0.72) * 0.055;
                this.x += this.vx * (speedPulse - 1);
                this.bounceHorizontally();
                this.y = Math.min(Math.max(this.baseY + altitude + turbulence, yMin), yMax);

                const direction = this.vx >= 0 ? 1 : -1;
                const verticalVelocity = this.y - prevY;
                const climbBank = Math.max(-this.bankAmplitude, Math.min(this.bankAmplitude, verticalVelocity * 0.012));
                const wingRock = Math.sin(flight * 0.83 + Math.PI / 5) * this.bankAmplitude * 0.35;
                this.rotation = (climbBank + wingRock) * direction;
            } else if (this.style === 'watercraft') {
                const wave = this.age * this.waveSpeed + this.wavePhase;
                const bob = Math.sin(wave) * this.bobAmplitude;
                const longSwell = Math.sin(wave * 0.43) * this.driftAmplitude;
                const speedPulse = 1 + Math.sin(wave * 0.7) * 0.12;
                this.x += this.vx * (speedPulse - 1);
                this.bounceHorizontally();
                this.y = this.baseY + bob + longSwell * 0.2;
                this.rotation = Math.sin(wave + Math.PI / 5) * this.rollAmplitude;
            }
        }

        const shouldFadeAll = serverSettings.galleryMode === 'fade';
        if (shouldFadeAll || this.isFading) {
            const prevFade = this.fadeAlpha;
            this.fadeAlpha = Math.max(0, this.fadeAlpha - 0.0005);
            if (prevFade > 0 && this.fadeAlpha === 0) {
                socket.emit('image:faded', this.id);
            }
        }
    }

    isFaded() {
        return this.fadeAlpha === 0;
    }

    drawDirectionalImage(alpha, centerX, centerY) {
        const drawnFacingScale = this.facingDirection === 'left' ? -1 : 1;
        const movementFacingScale = this.vx < 0 ? -1 : 1;
        const facingScale = drawnFacingScale * movementFacingScale;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(centerX, centerY);
        ctx.scale(facingScale, 1);
        ctx.rotate(this.rotation * facingScale);

        // Glow for well-rated paintings — only in foreground to bound shadowBlur cost
        if (this.currentLayer === 'foreground' && (this.score || 0) > 0) {
            const tier = Math.min(this.score, 6);
            ctx.shadowBlur = tier * 6;
            ctx.shadowColor = `rgba(255, 215, 130, ${Math.min(0.5 + tier * 0.05, 0.85)})`;
        }

        ctx.drawImage(this.img, -this.w / 2, -this.h / 2, this.w, this.h);
        ctx.restore();
    }

    draw() {
        const alpha = this.layerAlpha * this.fadeAlpha;
        const centerX = this.x + this.w / 2;
        const centerY = this.y + this.h / 2;

        if (this.style === 'airplane') {
            const trailDirection = this.vx >= 0 ? -1 : 1;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.86)';

            for (let side = -1; side <= 1; side += 2) {
                const wingY = centerY + side * this.h * 0.18;
                for (let i = 0; i < 5; i++) {
                    const trailOffset = this.w * 0.34 + i * 24;
                    const fade = 1 - i / 5;
                    const lift = Math.sin(this.age * 0.028 + i * 0.9 + side) * (4 + i * 1.2);

                    ctx.globalAlpha = alpha * 0.34 * fade;
                    ctx.lineWidth = Math.max(1.4, 3 - i * 0.24);
                    ctx.beginPath();
                    ctx.moveTo(
                        centerX + trailDirection * trailOffset,
                        wingY + lift
                    );
                    ctx.quadraticCurveTo(
                        centerX + trailDirection * (trailOffset + 18),
                        wingY + lift + side * 1.5,
                        centerX + trailDirection * (trailOffset + 42),
                        wingY + lift + Math.sin(this.age * 0.04 + i) * 3
                    );
                    ctx.stroke();
                }
            }
            ctx.restore();
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else if (this.style === 'car') {
            ctx.save();
            ctx.globalAlpha = alpha * 0.24;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.beginPath();
            ctx.ellipse(
                centerX,
                this.y + this.h * 0.92,
                this.w * 0.34,
                Math.max(5, this.h * 0.06),
                0, 0, Math.PI * 2
            );
            ctx.fill();
            ctx.restore();
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else if (this.style === 'watercraft') {
            const wakeDirection = this.vx >= 0 ? -1 : 1;
            ctx.save();
            ctx.globalAlpha = alpha * 0.32;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            for (let i = 0; i < 3; i++) {
                const wakeOffset = 18 + i * 15;
                const waveLift = Math.sin(this.age * 0.08 + i) * 5;
                ctx.beginPath();
                ctx.moveTo(centerX + wakeDirection * wakeOffset, centerY + this.h * 0.22 + waveLift);
                ctx.quadraticCurveTo(
                    centerX + wakeDirection * (wakeOffset + 18),
                    centerY + this.h * 0.18 + waveLift + 5,
                    centerX + wakeDirection * (wakeOffset + 38),
                    centerY + this.h * 0.22 + waveLift
                );
                ctx.stroke();
            }
            ctx.restore();
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else if (this.style === 'pedestrian') {
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else {
            ctx.globalAlpha = alpha;
            ctx.drawImage(this.img, this.x, this.y, this.w, this.h);
            ctx.globalAlpha = 1;
        }
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
    
    console.log('⚙️  APP:INIT - Theme config loaded');
    serverSettings = Object.assign({}, serverSettings, settings);

    const themeName = config.activeTheme;
    const theme = config.themes[themeName];
    themeConfig = theme;
    activeImages.length = 0; // Clear previous images

    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;

    // Hintergrund laden
    const bgUrl = `/theme-image/${encodeURIComponent(theme.image)}`;
    canvas.style.backgroundImage = `url("${bgUrl}")`;

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

    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(theme.image)}")`;
});

// CATEGORY RANGES CHANGED (admin tuned yMin/yMax/speedMin/speedMax for one
// category) — apply live without wiping the wall: pull active paintings of
// that category into the new band and rescale their horizontal speed.
socket.on("category:rangesChanged", ({ themeName, categoryId, yMinPct, yMaxPct, speedMin, speedMax, scalePct }) => {
    if (!themeConfig || !themeConfig.categories) return;
    const cat = themeConfig.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.yMinPct = yMinPct;
    cat.yMaxPct = yMaxPct;
    cat.speedMin = speedMin;
    cat.speedMax = speedMax;
    if (Number.isFinite(scalePct)) cat.scalePct = scalePct;
    activeImages.forEach(fi => {
        if (!fi.category || fi.category.id !== categoryId) return;
        const { yMin, yMax } = fi.yBounds();
        fi.baseY = Math.min(Math.max(fi.baseY, yMin), yMax);
        fi.y = fi.baseY;
        const sign = Math.sign(fi.vx) || (Math.random() < 0.5 ? -1 : 1);
        fi.vx = sign * fi.randomSpeed();
    });
});

// SETTINGS UPDATE
socket.on("admin:updateSettings", (settings) => {
    serverSettings = Object.assign({}, serverSettings, settings);
    statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;
});

// Bild kommt an, mit movementType (Kategorie-ID des aktiven Themes)
socket.on("newImage", ({ id, dataUrl, movementType, facingDirection, score }) => {
    const img = new Image();
    img.onload = () => {
        const category = themeConfig && themeConfig.categories
            ? themeConfig.categories.find(c => c.id === movementType)
            : null;
        if (!category) {
            console.warn('newImage: unknown movementType, dropping image:', movementType);
            return;
        }

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
        
        activeImages.push(new FloatingImage(id, finalImg, category, facingDirection, score));
    };
    img.src = dataUrl;
});

// Score changed for a specific image — update the live FloatingImage
// instance so the glow reflects the new score. Don't re-create the object,
// otherwise the painting would teleport.
socket.on("image:voteUpdate", ({ id, score }) => {
    const target = activeImages.find(img => img.id === id);
    if (target) target.score = score || 0;
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
            const category = themeConfig && themeConfig.categories
                ? themeConfig.categories.find(c => c.id === imageData.movementType)
                : null;
            if (!category) {
                console.warn('main:allImages: unknown movementType, skipping:', imageData.movementType);
                return;
            }

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
            
            activeImages.push(new FloatingImage(imageData.id, finalImg, category, imageData.facingDirection, imageData.score));
        };
        img.src = imageData.dataUrl;
    });
});

// Note: this client (`/main`) is purely for projection. It does NOT take
// screenshots for the save flow — the server runs its own headless /main page
// (see lib/mainRenderer.js) and screenshots that one on finalizeArtwork.
// That decouples save reliability from the wall-PC's browser state.
