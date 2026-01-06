// -------------------- main.js --------------------
const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// -------------------- SETTINGS --------------------
let serverSettings = { 
    fade: true, 
    maxImages: 30, 
    movement: null, 
    hopSpeed: 0.05, 
    floatSpeed: 1,
    // ⭐ Opacity-Grenzen für jede Schicht
    foregroundOpacityMax: 1.0,
    foregroundOpacityMin: 0.70,
    midgroundOpacityMax: 0.69,
    midgroundOpacityMin: 0.40,
    backgroundOpacityMax: 0.39,
    backgroundOpacityMin: 0.10
}; 
let themeConfig = null;

const TARGET_AREA = 20000; // pixels²

// -------------------- CANVAS RESIZE --------------------
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// -------------------- MOVEMENT STRATEGY CLASSES --------------------

class Movement {
    constructor(floatingImage) {
        this.img = floatingImage;
    }
    update() {}
}

class FloatingMovement extends Movement {
    update() {
        const obj = this.img;
        const yMin = canvas.height * (obj.zone.yStartPct / 100);
        const yMax = canvas.height * (obj.zone.yEndPct / 100) - obj.img.height;

        const speed = typeof serverSettings.floatSpeed === 'number' ? serverSettings.floatSpeed : 1;

        obj.x += obj.vx * speed;
        obj.y += obj.vy * speed;

        if (obj.x <= 0 || obj.x + obj.img.width >= canvas.width) obj.vx *= -1;
        if (obj.y <= yMin || obj.y >= yMax) obj.vy *= -1;
    }
}

class HoppingMovement extends Movement {
    update() {
        const obj = this.img;

        const hopSpeed = typeof serverSettings.hopSpeed === 'number' ? serverSettings.hopSpeed : 0.05;
        const floatSpeed = typeof serverSettings.floatSpeed === 'number' ? serverSettings.floatSpeed : 1;

        obj.hopProgress += hopSpeed;
        obj.y = obj.baseY - Math.abs(Math.sin(obj.hopProgress) * obj.hopHeight);

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
        this.originalZone = zone; // Ursprüngliche Zone speichern

        // ⭐ Aktuelle Schicht wird später bei redistributeLayers() gesetzt
        this.currentLayer = 'foreground';

        // Random position within zone
        const yMin = canvas.height * (zone.yStartPct / 100);
        const yMax = canvas.height * (zone.yEndPct / 100) - img.height;
        this.x = Math.random() * Math.max(0, canvas.width - img.width);
        this.y = yMin + Math.random() * Math.max(0, yMax - yMin);

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
    }

    draw() {
        ctx.globalAlpha = this.alpha;
        ctx.drawImage(this.img, this.x, this.y);
        ctx.globalAlpha = 1;
    }
}

// -------------------- ACTIVE IMAGES ARRAY (⭐ ein einziges Array für FIFO) --------------------
const activeImages = []; // älteste am Anfang, neueste am Ende

// -------------------- LAYER MANAGEMENT --------------------
function redistributeLayers() {
    const maxVisible = (serverSettings && Number.isFinite(serverSettings.maxImages))
        ? Math.max(1, Math.floor(serverSettings.maxImages))
        : 30;
    
    const maxPerLayer = Math.floor(maxVisible / 3);
    const totalImages = activeImages.length;
    
    if (totalImages === 0) return;

    // ⭐ Weise Schichten zu basierend auf Position im Array (neueste = foreground)
    // Aber die Position/Zone des Bildes bleibt unverändert!
    activeImages.forEach((img, index) => {
        // Die neuesten maxPerLayer Bilder → Vordergrund
        if (index >= totalImages - maxPerLayer) {
            img.currentLayer = 'foreground';
        }
        // Die nächsten maxPerLayer Bilder → Mittelgrund
        else if (index >= totalImages - maxPerLayer * 2) {
            img.currentLayer = 'midground';
        }
        // Die ältesten → Hintergrund
        else {
            img.currentLayer = 'background';
        }
    });
}

// -------------------- ANIMATION LOOP --------------------
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const maxVisible = (serverSettings && Number.isFinite(serverSettings.maxImages))
        ? Math.max(1, Math.floor(serverSettings.maxImages))
        : 30;
    
    const len = activeImages.length;
    const startIndex = Math.max(0, len - maxVisible);

    // ⭐ Opacity-Bereiche pro Schicht (aus serverSettings)
    const opacityRanges = {
        'foreground': { 
            max: serverSettings.foregroundOpacityMax || 1.0, 
            min: serverSettings.foregroundOpacityMin || 0.70 
        },
        'midground': { 
            max: serverSettings.midgroundOpacityMax || 0.69, 
            min: serverSettings.midgroundOpacityMin || 0.40 
        },
        'background': { 
            max: serverSettings.backgroundOpacityMax || 0.39, 
            min: serverSettings.backgroundOpacityMin || 0.10 
        }
    };

    // Gruppiere Bilder nach Schicht für Opacity-Berechnung
    const layerGroups = {
        background: [],
        midground: [],
        foreground: []
    };

    for (let i = startIndex; i < len; i++) {
        layerGroups[activeImages[i].currentLayer].push({ img: activeImages[i], globalIndex: i });
    }

    // Zeichne alle Ebenen in der richtigen Reihenfolge
    ['background', 'midground', 'foreground'].forEach(layerName => {
        const group = layerGroups[layerName];
        const layerLen = group.length;
        
        group.forEach(({ img, globalIndex }, localIndex) => {
            img.update();

            if (serverSettings.fade) {
                const range = opacityRanges[layerName];
                
                if (layerLen === 1) {
                    // Nur ein Bild in dieser Schicht
                    img.alpha = range.max;
                } else {
                    // ⭐ Kontinuierliche Opacity innerhalb der Schicht
                    const progress = (localIndex + 1) / layerLen;
                    img.alpha = range.min + (range.max - range.min) * progress;
                }
            } else {
                // Ohne Fade: volle Schicht-Opacity
                img.alpha = opacityRanges[layerName].max;
            }

            if (img.alpha > 0) img.draw();
        });
    });

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
    
    // Lösche alle Bilder
    activeImages.length = 0;
    
    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;
    canvas.style.backgroundImage = `url("/theme-image/${encodeURIComponent(themeConfig.image)}")`;
});

socket.on("admin:updateSettings", (settings) => {
    serverSettings = Object.assign({}, serverSettings, settings);
    statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${serverSettings.fade ? 'ON' : 'OFF'}`;
    
    // ⭐ Bei Settings-Änderung: Schichten neu verteilen
    redistributeLayers();
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
            
            // ⭐ Neues Bild wird mit seiner gezeichneten Zone erstellt
            const floatingImg = new FloatingImage(id, resizedImg, zone, movementType);
            
            // ⭐ Füge am Ende hinzu (neuestes Bild)
            activeImages.push(floatingImg);
            
            // ⭐ Verteile Schichten neu (bestimmt nur currentLayer, nicht Position)
            redistributeLayers();
        };
        resizedImg.src = tempCanvas.toDataURL();
    };
    img.src = dataUrl;
});

socket.on("admin:removeImageFromMain", (imageId) => {
    const index = activeImages.findIndex(img => img.id === imageId);
    if (index !== -1) {
        activeImages.splice(index, 1);
        // ⭐ Nach Entfernung: Schichten neu verteilen
        redistributeLayers();
    }
});

document.getElementById('screenshot').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `main_${Date.now()}.png`;
    link.click();
});