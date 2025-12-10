// -------------------- main.js --------------------
const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// -------------------- SETTINGS --------------------
let serverSettings = { fade: true, maxImages: 30, movement: null, hopSpeed: 0.05, floatSpeed: 1 }; // now holds admin-controlled settings
let themeConfig = null;

// All floating images will have the same "square footage"
const TARGET_AREA = 20000; // pixels²

// -------------------- CANVAS RESIZE --------------------
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// -------------------- MOVEMENT STRATEGY CLASSES --------------------

// Base class (optional)
class Movement {
    constructor(floatingImage) {
        this.img = floatingImage;
    }
    update() {}
}

// Floating / linear bounce movement
class FloatingMovement extends Movement {
    update() {
        const obj = this.img;
        const yMin = canvas.height * (obj.zone.yStartPct / 100);
        const yMax = canvas.height * (obj.zone.yEndPct / 100) - obj.img.height;

        // -------------------- CHANGE: use serverSettings.floatSpeed --------------------
        const speed = typeof serverSettings.floatSpeed === 'number' ? serverSettings.floatSpeed : 1;

        obj.x += obj.vx * speed;
        obj.y += obj.vy * speed;

        if (obj.x <= 0 || obj.x + obj.img.width >= canvas.width) obj.vx *= -1;
        if (obj.y <= yMin || obj.y >= yMax) obj.vy *= -1;
    }
}

// Hopping movement (vertical sine-wave hop)
class HoppingMovement extends Movement {
    update() {
        const obj = this.img;

        // -------------------- CHANGE: use serverSettings.hopSpeed for hopping --------------------
        const hopSpeed = typeof serverSettings.hopSpeed === 'number' ? serverSettings.hopSpeed : 0.05;
        const floatSpeed = typeof serverSettings.floatSpeed === 'number' ? serverSettings.floatSpeed : 1;

        obj.hopProgress += hopSpeed;
        obj.y = obj.baseY - Math.abs(Math.sin(obj.hopProgress) * obj.hopHeight);

        // Horizontal drift uses floatSpeed
        obj.x += obj.vx * floatSpeed;
        if (obj.x <= 0 || obj.x + obj.img.width >= canvas.width) obj.vx *= -1;
    }
}

// -------------------- FLOATING IMAGE CLASS --------------------
class FloatingImage {
    constructor(id, img, zone, movementType = "floating") {
        this.id = id;
        this.img = img;
        this.zone = zone;
        this.alpha = 1;

        // Random position within zone
        const yMin = canvas.height * (zone.yStartPct / 100);
        const yMax = canvas.height * (zone.yEndPct / 100) - img.height;
        this.x = Math.random() * Math.max(0, canvas.width - img.width);
        this.y = yMin + Math.random() * Math.max(0, yMax - yMin);

        // Velocities for floating or hopping
        this.vx = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);
        this.vy = (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1);

        // Hopping variables
        this.baseY = this.y;
        this.hopHeight = Math.random() * 30 + 20;
        this.hopProgress = Math.random() * Math.PI * 2;

        // Assign movement strategy
        switch (movementType) {
            case "hopping":
                this.movement = new HoppingMovement(this);
                break;
            case "floating":
            default:
                this.movement = new FloatingMovement(this);
                break;
        }
    }

    update() {
        this.movement.update();
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

// -------------------- ACTIVE IMAGES ARRAY --------------------
const activeImages = []; // arrival order: push adds newest to end

// -------------------- ANIMATION LOOP --------------------
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const len = activeImages.length;
    const maxVisible = (serverSettings && Number.isFinite(serverSettings.maxImages))
        ? Math.max(1, Math.floor(serverSettings.maxImages))
        : 30;

    const startIndex = Math.max(0, len - maxVisible);

    for (let i = 0; i < len; i++) {
        const obj = activeImages[i];
        obj.update();

        if (serverSettings.fade && len > 1) {
            if (i < startIndex) {
                obj.alpha = 0;
                continue;
            } else {
                const visibleIndex = i - startIndex;
                const visibleCount = len - startIndex;
                const MIN_ALPHA = 0.1;
                obj.alpha = MIN_ALPHA + (1 - MIN_ALPHA) * ((visibleIndex + 1) / visibleCount);
            }
        } else {
            obj.alpha = 1;
        }

        if (obj.alpha > 0) obj.draw();
    }

    requestAnimationFrame(animate);
}
animate();

// -------------------- SOCKET EVENTS --------------------
socket.on("app:init", ({ config, settings }) => {
    if (settings) {
        serverSettings = Object.assign({}, serverSettings, settings);
    }
    const themeName = config.activeTheme;
    themeConfig = config.themes[themeName];
    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(themeConfig.image)}")`;
});

socket.on("config:changed", (config) => {
    const themeName = config.activeTheme;
    themeConfig = config.themes[themeName];
    activeImages.length = 0;
    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(themeConfig.image)}")`;
});

socket.on("admin:updateSettings", (settings) => {
    serverSettings = Object.assign({}, serverSettings, settings);
    statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;
});

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
            const movementType = (themeConfig && themeConfig.movement) || serverSettings.movement || "floating";
            activeImages.push(new FloatingImage(id, resizedImg, zone, movementType));
        };
        resizedImg.src = tempCanvas.toDataURL();
    };
    img.src = dataUrl;
});

socket.on("admin:removeImageFromMain", (imageId) => {
    const index = activeImages.findIndex(img => img.id === imageId);
    if (index !== -1) activeImages.splice(index, 1);
});

document.getElementById('screenshot').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `main_${Date.now()}.png`;
    link.click();
});
