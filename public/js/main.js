const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const foregroundOverlay = document.getElementById('foregroundOverlay');
const themeTransitionVideo = document.getElementById('themeTransitionVideo');

function applyForegroundImage(theme) {
    if (theme && theme.foregroundImage) {
        foregroundOverlay.style.backgroundImage = `url("${theme.foregroundImage}")`;
        foregroundOverlay.style.display = 'block';
    } else {
        foregroundOverlay.style.backgroundImage = 'none';
        foregroundOverlay.style.display = 'none';
    }
}

let themeTransitionHideTimeoutId = null;
let themeTransitionCoverTimeoutId = null;
let themeTransitionEndedHandler = null;
let themeTransitionPlayingHandler = null;

// theme.transitionVideo can be a single path (used regardless of where we're
// coming from) or an object keyed by the previous theme's name, with an
// optional "default" fallback, e.g. { weltall: "...", unterwasser: "...", default: "..." }.
function resolveTransitionVideo(theme, fromThemeName) {
    const tv = theme && theme.transitionVideo;
    if (!tv) return null;
    if (typeof tv === 'string') return tv;
    return tv[fromThemeName] || tv.default || null;
}

// Transition videos are large (~20 MB) and are normally fetched from the server
// the instant a theme switch happens. Under event load (many iPads uploading)
// that download loses the race against the fallback timers and the animation is
// skipped. So we preload every transition video into a local blob once, up front
// (on page load / reconnect, while the network is quiet), and play the switch
// from that object URL — zero network at switch time.
const transitionVideoCache = new Map(); // network URL -> object URL (blob)

function collectTransitionVideoUrls(config) {
    const urls = new Set();
    const themes = (config && config.themes) || {};
    for (const theme of Object.values(themes)) {
        const tv = theme && theme.transitionVideo;
        if (!tv) continue;
        if (typeof tv === 'string') urls.add(tv);
        else for (const v of Object.values(tv)) if (v) urls.add(v);
    }
    return Array.from(urls);
}

// Warm the cache sequentially so the preload itself doesn't saturate the link.
async function preloadTransitionVideos(config) {
    for (const url of collectTransitionVideoUrls(config)) {
        if (transitionVideoCache.has(url)) continue;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            transitionVideoCache.set(url, URL.createObjectURL(await res.blob()));
        } catch (err) {
            console.warn('Transition video preload failed:', url, err.message);
        }
    }
}

// Plays the transition video matching (theme, fromThemeName) - if any - as a
// fullscreen overlay. Once the video is actually covering the screen (or
// immediately, if there's no video), calls onCovered() so the underlying
// theme swap stays hidden behind the video.
function playThemeTransition(theme, fromThemeName, onCovered) {
    // Cancel any in-flight transition first
    if (themeTransitionHideTimeoutId !== null) {
        clearTimeout(themeTransitionHideTimeoutId);
        themeTransitionHideTimeoutId = null;
    }
    if (themeTransitionCoverTimeoutId !== null) {
        clearTimeout(themeTransitionCoverTimeoutId);
        themeTransitionCoverTimeoutId = null;
    }
    if (themeTransitionEndedHandler) {
        themeTransitionVideo.removeEventListener('ended', themeTransitionEndedHandler);
        themeTransitionEndedHandler = null;
    }
    if (themeTransitionPlayingHandler) {
        themeTransitionVideo.removeEventListener('playing', themeTransitionPlayingHandler);
        themeTransitionPlayingHandler = null;
    }
    themeTransitionVideo.pause();
    themeTransitionVideo.style.display = 'none';

    const videoSrc = resolveTransitionVideo(theme, fromThemeName);
    if (!videoSrc) {
        if (onCovered) onCovered();
        return;
    }

    let covered = false;
    const cover = () => {
        if (covered) return;
        covered = true;
        if (themeTransitionCoverTimeoutId !== null) {
            clearTimeout(themeTransitionCoverTimeoutId);
            themeTransitionCoverTimeoutId = null;
        }
        if (themeTransitionPlayingHandler) {
            themeTransitionVideo.removeEventListener('playing', themeTransitionPlayingHandler);
            themeTransitionPlayingHandler = null;
        }
        if (onCovered) onCovered();
    };

    const hide = () => {
        themeTransitionVideo.style.display = 'none';
        themeTransitionVideo.pause();
        themeTransitionVideo.removeAttribute('src');
        themeTransitionVideo.load();
        if (themeTransitionHideTimeoutId !== null) {
            clearTimeout(themeTransitionHideTimeoutId);
            themeTransitionHideTimeoutId = null;
        }
        if (themeTransitionEndedHandler) {
            themeTransitionVideo.removeEventListener('ended', themeTransitionEndedHandler);
            themeTransitionEndedHandler = null;
        }
        cover(); // make sure the theme swap happens even if the video failed/ended early
    };

    themeTransitionEndedHandler = hide;
    themeTransitionPlayingHandler = cover;
    themeTransitionVideo.addEventListener('ended', themeTransitionEndedHandler);
    themeTransitionVideo.addEventListener('playing', themeTransitionPlayingHandler);

    themeTransitionVideo.src = transitionVideoCache.get(videoSrc) || videoSrc;
    themeTransitionVideo.style.display = 'block';
    themeTransitionVideo.currentTime = 0;

    const playPromise = themeTransitionVideo.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
            console.warn('Theme transition video play() failed:', err);
            hide();
        });
    }

    // Fallback: swap the theme underneath even if 'playing' never fires quickly.
    // 5s (was 1s) gives a slow/uncached video far more room to actually start
    // before we give up and swap without it.
    themeTransitionCoverTimeoutId = setTimeout(cover, 5000);

    // Safety: hide the overlay regardless. The videos are ~5.0s long, so the old
    // 5s cut the last frame; 8s lets the clip finish (and a slightly late start
    // still complete) while 'ended' hides it early in the normal case.
    themeTransitionHideTimeoutId = setTimeout(hide, 8000);
}

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
let activeThemeName = null;
let backgroundImageSize = null;
const activeImages = [];

function imageBelongsToActiveTheme(imageData) {
    return imageData && imageData.themeName === activeThemeName;
}

function setThemeBackground(theme) {
    const bgUrl = `/theme-image/${encodeURIComponent(theme.image)}`;
    canvas.style.backgroundImage = `url("${bgUrl}")`;
    backgroundImageSize = null;

    const bgImg = new Image();
    bgImg.onload = () => {
        backgroundImageSize = {
            width: bgImg.naturalWidth,
            height: bgImg.naturalHeight
        };
        activeImages.forEach(img => img.clampIntoMovementBounds());
    };
    bgImg.onerror = () => {
        console.error('Failed to load theme background:', theme.image);
    };
    bgImg.src = bgUrl;
}

function backgroundCoverRect() {
    if (!backgroundImageSize || !canvas.width || !canvas.height) {
        return { x: 0, y: 0, width: canvas.width, height: canvas.height };
    }

    const scale = Math.max(
        canvas.width / backgroundImageSize.width,
        canvas.height / backgroundImageSize.height
    );
    const width = backgroundImageSize.width * scale;
    const height = backgroundImageSize.height * scale;

    return {
        x: (canvas.width - width) / 2,
        y: (canvas.height - height) / 2,
        width,
        height
    };
}

function resizeCanvas() {
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
requestAnimationFrame(() => {
    activeImages.forEach(img => img.clampIntoMovementBounds());
});
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
        this.visibleBottomRatio = this.detectVisibleBottomRatio();

        // Defaults for optional per-style effects (overridden in initializeMovement)
        this.pulseAmplitude = 0;
        this.pulseSpeed = 0;
        this.pulsePhase = 0;
        this.bubbleTrail = false;

        this.initializeMovement();
        this.applyInitialDirection();
    }

    detectVisibleBottomRatio() {
        if (!this.img || !this.img.width || !this.img.height) return null;

        try {
            const analysisCanvas = document.createElement('canvas');
            analysisCanvas.width = this.img.width;
            analysisCanvas.height = this.img.height;
            const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
            analysisCtx.drawImage(this.img, 0, 0);
            const pixels = analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height).data;
            const width = analysisCanvas.width;
            const height = analysisCanvas.height;
            const visited = new Uint8Array(width * height);
            const queue = new Int32Array(width * height);
            const components = [];

            for (let start = 0; start < width * height; start += 1) {
                if (visited[start] || pixels[start * 4 + 3] < 24) continue;

                let head = 0;
                let tail = 0;
                let area = 0;
                let bottomY = 0;
                const columnBottoms = new Map();
                queue[tail++] = start;
                visited[start] = 1;

                while (head < tail) {
                    const pixel = queue[head++];
                    const x = pixel % width;
                    const y = Math.floor(pixel / width);
                    area += 1;
                    bottomY = Math.max(bottomY, y);
                    columnBottoms.set(x, Math.max(columnBottoms.get(x) ?? -1, y));

                    const neighbors = [
                        x > 0 ? pixel - 1 : -1,
                        x + 1 < width ? pixel + 1 : -1,
                        y > 0 ? pixel - width : -1,
                        y + 1 < height ? pixel + width : -1
                    ];
                    neighbors.forEach(neighbor => {
                        if (neighbor < 0 || visited[neighbor] || pixels[neighbor * 4 + 3] < 24) return;
                        visited[neighbor] = 1;
                        queue[tail++] = neighbor;
                    });
                }

                components.push({ area, bottomY, columnBottoms });
            }

            if (components.length === 0) return null;
            const largestArea = Math.max(...components.map(component => component.area));
            const minSignificantArea = Math.max(3, largestArea * 0.01);
            const bottomByColumn = new Map();

            components
                .filter(component => component.area >= minSignificantArea)
                .forEach(component => {
                    component.columnBottoms.forEach((bottomY, x) => {
                        bottomByColumn.set(x, Math.max(bottomByColumn.get(x) ?? -1, bottomY));
                    });
                });

            const columnBottoms = [...bottomByColumn.values()];
            if (columnBottoms.length === 0) return null;

            // Use the lowest relevant painted pixel as the ground anchor.
            // Tiny isolated specks are already filtered out via minSignificantArea.
            return (Math.max(...columnBottoms) + 1) / height;
        } catch (error) {
            console.warn('Could not detect visible image bounds:', error);
        }

        return null;
    }

    applyInitialDirection() {
        const direction = this.facingDirection === 'left' ? -1 : 1;
        this.vx = Math.abs(this.vx) * direction;
        if (this.hasMovementPath()) {
            this.pathDirection = direction;
        }
    }

    get scaleFactor() {
        const s = this.category && Number(this.category.scalePct);
        return Number.isFinite(s) && s > 0 ? s / 100 : 1;
    }

    // Subtle "breathing" pulse for organic-feeling creatures (1 when unused)
    get pulseScale() {
        if (!this.pulseAmplitude) return 1;
        return 1 + Math.sin(this.age * this.pulseSpeed + this.pulsePhase) * this.pulseAmplitude;
    }

    get w() { return this.img.width * this.scaleFactor * this.pulseScale; }
    get h() { return this.img.height * this.scaleFactor * this.pulseScale; }

    get visibleBottomOffset() {
        return Number.isFinite(this.visibleBottomRatio)
            ? this.h * (1 - this.visibleBottomRatio)
            : 0;
    }

    visualBottomY() {
        return this.y + this.h * (Number.isFinite(this.visibleBottomRatio) ? this.visibleBottomRatio : 0.92);
    }

    rootedFraction() {
        const value = Number(this.category && this.category.rootFraction);
        return Number.isFinite(value) && value > 0 && value < 1 ? value : 0.75;
    }

    hasMovementPath() {
        return Array.isArray(this.category && this.category.pathPoints)
            && this.category.pathPoints.length >= 2;
    }

    movementPath() {
        if (!this.hasMovementPath()) return null;

        const bg = backgroundCoverRect();
        const points = this.category.pathPoints.map(point => ({
            x: bg.x + bg.width * (Number(point.xPct) / 100),
            y: bg.y + bg.height * (Number(point.yPct) / 100)
        }));
        const segments = [];
        let totalLength = 0;

        for (let i = 0; i < points.length - 1; i += 1) {
            const from = points[i];
            const to = points[i + 1];
            const length = Math.hypot(to.x - from.x, to.y - from.y);
            if (length <= 0) continue;
            segments.push({ from, to, length, start: totalLength });
            totalLength += length;
        }

        return totalLength > 0 ? { segments, totalLength } : null;
    }

    positionOnMovementPath() {
        const path = this.movementPath();
        if (!path) return;

        const distance = this.pathProgress * path.totalLength;
        const segment = path.segments.find(item => distance <= item.start + item.length)
            || path.segments[path.segments.length - 1];
        const progress = Math.min(1, Math.max(0, (distance - segment.start) / segment.length));
        const centerX = segment.from.x + (segment.to.x - segment.from.x) * progress;
        const groundY = segment.from.y + (segment.to.y - segment.from.y) * progress;
        const anchorY = Number.isFinite(this.visibleBottomRatio) ? this.visibleBottomRatio : 0.92;
        const horizontalDirection = Math.sign(segment.to.x - segment.from.x) * this.pathDirection;

        this.x = centerX - this.w / 2;
        this.y = groundY - this.h * anchorY;
        this.baseY = this.y;
        if (horizontalDirection !== 0) {
            this.vx = Math.abs(this.vx) * horizontalDirection;
        }
    }

    updateMovementPath() {
        const path = this.movementPath();
        if (!path) return;

        this.pathProgress += (Math.abs(this.vx) / path.totalLength) * this.pathDirection;
        if (this.pathProgress <= 0) {
            this.pathProgress = 0;
            this.pathDirection = 1;
        } else if (this.pathProgress >= 1) {
            this.pathProgress = 1;
            this.pathDirection = -1;
        }
        this.positionOnMovementPath();
    }

    xBounds() {
        const cat = this.category || {};
        const xMinPct = Number.isFinite(Number(cat.xMinPct)) ? Number(cat.xMinPct) : 0;
        const xMaxPct = Number.isFinite(Number(cat.xMaxPct)) ? Number(cat.xMaxPct) : 100;
        const bg = backgroundCoverRect();
        const zoneLeft = bg.x + bg.width * (Math.min(xMinPct, xMaxPct) / 100);
        const zoneRight = bg.x + bg.width * (Math.max(xMinPct, xMaxPct) / 100);
        const xMin = Math.max(0, zoneLeft);
        const xMax = Math.min(canvas.width - this.w, zoneRight - this.w);

        if (xMax < xMin) {
            const centeredX = Math.max(0, Math.min(canvas.width - this.w, (zoneLeft + zoneRight - this.w) / 2));
            return { xMin: centeredX, xMax: centeredX };
        }
        return { xMin, xMax };
    }

    bounceHorizontally() {
        const { xMin, xMax } = this.xBounds();
        if (this.x <= xMin) {
            this.x = xMin;
            this.vx = Math.abs(this.vx);
        } else if (this.x >= xMax) {
            this.x = xMax;
            this.vx = -Math.abs(this.vx);
        }
    }

    yBounds() {
        const cat = this.category;
        const bg = backgroundCoverRect();
        const yMinRaw = bg.y + bg.height * (cat.yMinPct / 100);
        const yMaxRaw = bg.y + bg.height * (cat.yMaxPct / 100);

        if (this.style === 'car' || this.style === 'watercraft') {
            const anchorY = Number.isFinite(this.visibleBottomRatio) ? this.visibleBottomRatio : 0.92;
            const yMin = yMinRaw - this.h * anchorY;
            const yMax = Math.max(yMin, yMaxRaw - this.h * anchorY);
            return { yMin, yMax };
        }

        const yMin = yMinRaw;
        const yMax = Math.max(yMin, yMaxRaw - this.h);
        return { yMin, yMax };
    }

    rootedYBounds(rootFraction = this.rootedFraction()) {
        const cat = this.category || {};
        const yMinPct = Number.isFinite(Number(cat.yMinPct)) ? Number(cat.yMinPct) : 0;
        const yMaxPct = Number.isFinite(Number(cat.yMaxPct)) ? Number(cat.yMaxPct) : 100;
        const bg = backgroundCoverRect();
        const rawMin = bg.y + bg.height * (Math.min(yMinPct, yMaxPct) / 100);
        const rawMax = bg.y + bg.height * (Math.max(yMinPct, yMaxPct) / 100);
        const visibleMaxRoot = canvas.height - this.h * (1 - rootFraction) - 2;
        const rootMin = Math.min(rawMin, visibleMaxRoot);
        const rootMax = Math.max(rootMin, Math.min(rawMax, visibleMaxRoot));
        return { rootMin, rootMax };
    }

    setRootY(rootY, rootFraction = this.rootedFraction()) {
        this.y = rootY - this.h * rootFraction;
        this.baseY = this.y;
    }

    randomSpeed() {
        const cat = this.category;
        return cat.speedMin + Math.random() * (cat.speedMax - cat.speedMin);
    }

    clampIntoMovementBounds() {
        if (this.style === 'pedestrian' && this.hasMovementPath()) {
            this.positionOnMovementPath();
            return;
        }

        const { xMin, xMax } = this.xBounds();
        if (this.style === 'sway' || this.style === 'still') {
            const rootFraction = this.rootedFraction();
            const { rootMin, rootMax } = this.rootedYBounds(rootFraction);
            const currentRoot = this.y + this.h * rootFraction;
            this.x = Math.min(Math.max(this.x, xMin), xMax);
            this.setRootY(Math.min(Math.max(currentRoot, rootMin), rootMax), rootFraction);
            return;
        }

        const { yMin, yMax } = this.yBounds();
        this.x = Math.min(Math.max(this.x, xMin), xMax);
        this.baseY = Math.min(Math.max(this.baseY, yMin), yMax);
        this.y = this.style === 'car'
            ? this.baseY
            : Math.min(Math.max(this.y, yMin), yMax);
    }

    initializeMovement() {
        if (this.style === 'rocket') {
            this.x = Math.random() * Math.max(0, canvas.width - this.w);
            this.y = Math.random() * canvas.height;
            this.vx = 0;
            this.vy = -this.randomSpeed();
            this.waiting = false;
            this.waitTimer = 0;
            return;
        }

        if (this.style === 'orbit') {
            const cat = this.category;
            // orbitT: 0 = sprite center at left edge, 1 = sprite center at right edge.
            // x  = orbitT * canvas.width  (linear, guaranteed full-width span)
            // y  = entryY − amplitude × sin(π × t)  (sine arc, peaks at t=0.5)
            const entryYPct = Number.isFinite(cat.orbitEntryYPct) ? cat.orbitEntryYPct : 72;
            const peakMinPct = Number.isFinite(cat.orbitPeakYPctMin) ? cat.orbitPeakYPctMin : 15;
            const peakMaxPct = Number.isFinite(cat.orbitPeakYPctMax) ? cat.orbitPeakYPctMax : 28;
            const peakYPct = peakMinPct + Math.random() * Math.max(0, peakMaxPct - peakMinPct);
            this.orbitEntryY = entryYPct / 100 * canvas.height;
            this.orbitPeakY  = peakYPct  / 100 * canvas.height;
            this.orbitDirection = Math.random() < 0.5 ? 1 : -1; // +1 L→R, −1 R→L
            const sMin = Number.isFinite(cat.speedMin) ? cat.speedMin : 0.003;
            const sMax = Number.isFinite(cat.speedMax) ? cat.speedMax : 0.007;
            this.orbitSpeed = sMin + Math.random() * Math.max(0, sMax - sMin);
            this.orbitWaiting = false;
            this.orbitWaitTimer = 0;
            // ot: how far past the screen edge (in t-units) the sprite starts
            const ot = (this.w / 2 + 20) / canvas.width;
            this.orbitT = this.orbitDirection > 0 ? -ot : 1 + ot;
            this.vx = canvas.width * this.orbitSpeed * this.orbitDirection;
            const rawSt = this.orbitDirection > 0 ? this.orbitT : 1 - this.orbitT;
            const st = (rawSt + ot) / (1 + 2 * ot);
            this.x = this.orbitT * canvas.width - this.w / 2;
            this.y = this.orbitEntryY - (this.orbitEntryY - this.orbitPeakY) * Math.sin(Math.PI * st) - this.h / 2;
            return;
        }

        const { yMin, yMax } = this.yBounds();
        const { xMin, xMax } = this.xBounds();
        if (this.style === 'walk' || this.style === 'ufo') {
            // Enter from the edge matching the chosen facing direction, so the
            // very first pass already goes all the way across before bouncing.
            this.x = this.facingDirection === 'left' ? xMax : xMin;
        } else {
            this.x = xMin + Math.random() * Math.max(0, xMax - xMin);
        }
        this.baseY = yMin + Math.random() * Math.max(0, yMax - yMin);
        this.y = this.baseY;
        this.vx = this.randomSpeed() * (Math.random() < 0.5 ? 1 : -1);

        if (this.style === 'car') {
            this.vy = 0;
            this.drivePhase = Math.random() * Math.PI * 2;
            this.driveSpeed = Math.random() * 0.02 + 0.02;
            this.rollAmplitude = 0;
        } else if (this.style === 'pedestrian' && this.hasMovementPath()) {
            this.pathProgress = Math.random();
            this.pathDirection = Math.random() < 0.5 ? -1 : 1;
            this.positionOnMovementPath();
        } else if (this.style === 'airplane') {
            this.vy = (Math.random() * 0.02 + 0.008) * (Math.random() < 0.5 ? 1 : -1);
            this.flightPhase = Math.random() * Math.PI * 2;
            this.flightSpeed = Math.random() * 0.015 + 0.01;
            this.altitudeAmplitude = Math.random() * 16 + 10;
            this.bankAmplitude = Math.random() * 0.045 + 0.025;
        } else if (this.style === 'watercraft') {
            this.vy = (Math.random() * 0.025 + 0.01) * (Math.random() < 0.5 ? 1 : -1);
            this.wavePhase = Math.random() * Math.PI * 2;
            this.waveSpeed = Math.random() * 0.018 + 0.014;
            this.bobAmplitude = Math.random() * 7 + 5;
            this.driftAmplitude = Math.random() * 18 + 10;
            this.rollAmplitude = Math.random() * 0.035 + 0.025;
        } else if (this.style === 'walk') {
            this.vy = 0;
            this.walkPhase = Math.random() * Math.PI * 2;
            const cat = this.category;
            const walkSpeedMin = Number.isFinite(cat.walkSpeedMin) ? cat.walkSpeedMin : 0.05;
            const walkSpeedMax = Number.isFinite(cat.walkSpeedMax) ? cat.walkSpeedMax : 0.07;
            const walkBobMin = Number.isFinite(cat.walkBobAmplitudeMin) ? cat.walkBobAmplitudeMin : 2;
            const walkBobMax = Number.isFinite(cat.walkBobAmplitudeMax) ? cat.walkBobAmplitudeMax : 4;
            const walkTiltMin = Number.isFinite(cat.walkTiltAmplitudeMin) ? cat.walkTiltAmplitudeMin : 0.012;
            const walkTiltMax = Number.isFinite(cat.walkTiltAmplitudeMax) ? cat.walkTiltAmplitudeMax : 0.022;
            this.walkSpeed = walkSpeedMin + Math.random() * (walkSpeedMax - walkSpeedMin);
            this.walkBobAmplitude = walkBobMin + Math.random() * (walkBobMax - walkBobMin);
            this.walkTiltAmplitude = walkTiltMin + Math.random() * (walkTiltMax - walkTiltMin);

            // Optional slow vertical drift, on top of the walk-bob, for a more
            // organic swimming path. Off by default (0/0 -> no drift).
            const driftAmpMin = Number.isFinite(cat.driftAmplitudeMin) ? cat.driftAmplitudeMin : 0;
            const driftAmpMax = Number.isFinite(cat.driftAmplitudeMax) ? cat.driftAmplitudeMax : 0;
            const driftSpeedMin = Number.isFinite(cat.driftSpeedMin) ? cat.driftSpeedMin : 0.004;
            const driftSpeedMax = Number.isFinite(cat.driftSpeedMax) ? cat.driftSpeedMax : 0.009;
            this.driftAmplitude = driftAmpMin + Math.random() * (driftAmpMax - driftAmpMin);
            this.driftSpeed = driftSpeedMin + Math.random() * (driftSpeedMax - driftSpeedMin);
            this.driftPhase = Math.random() * Math.PI * 2;

            // Optional gentle "breathing" size pulse. Off by default (0/0 -> no pulse).
            const pulseAmpMin = Number.isFinite(cat.pulseAmplitudeMin) ? cat.pulseAmplitudeMin : 0;
            const pulseAmpMax = Number.isFinite(cat.pulseAmplitudeMax) ? cat.pulseAmplitudeMax : 0;
            const pulseSpeedMin = Number.isFinite(cat.pulseSpeedMin) ? cat.pulseSpeedMin : 0.03;
            const pulseSpeedMax = Number.isFinite(cat.pulseSpeedMax) ? cat.pulseSpeedMax : 0.06;
            this.pulseAmplitude = pulseAmpMin + Math.random() * (pulseAmpMax - pulseAmpMin);
            this.pulseSpeed = pulseSpeedMin + Math.random() * (pulseSpeedMax - pulseSpeedMin);
            this.pulsePhase = Math.random() * Math.PI * 2;
            if (this.hasMovementPath()) {
                this.pathProgress = this.facingDirection === 'left' ? 1 : 0;
                this.pathDirection = this.facingDirection === 'left' ? -1 : 1;
                this.positionOnMovementPath();
            }
        } else if (this.style === 'ufo') {
            this.vy = 0;
            this.bubbleTrail = !!this.category.bubbleTrail;
        } else if (this.style === 'sway') {
            this.vx = 0;
            this.vy = 0;
            this.swayPhase = Math.random() * Math.PI * 2;
            this.swaySpeed = Math.random() * 0.01 + 0.008;
            this.swayAmplitude = Math.random() * 0.05 + 0.04;
            // Root (bottom of image) sits within the yMinPct..yMaxPct band.
            // The max root is capped so the visible square cannot drop below
            // the screen on low spawns.
            const rootFraction = this.rootedFraction();
            const { rootMin: swayRootMin, rootMax: swayRootMax } = this.rootedYBounds(rootFraction);
            const swayRoot = swayRootMin + Math.random() * Math.max(0, swayRootMax - swayRootMin);
            this.setRootY(swayRoot, rootFraction);
        } else if (this.style === 'still') {
            this.vx = 0;
            this.vy = 0;
            // Root (bottom of image) sits within the yMinPct..yMaxPct band.
            const rootFraction = this.rootedFraction();
            const { rootMin: stillRootMin, rootMax: stillRootMax } = this.rootedYBounds(rootFraction);
            const stillRoot = stillRootMin + Math.random() * Math.max(0, stillRootMax - stillRootMin);
            this.setRootY(stillRoot, rootFraction);
        } else if (this.style === 'spin') {
            this.vx = 0;
            this.vy = 0;
            this.spinSpeed = (Math.random() * 0.0015 + 0.0008) * (Math.random() < 0.5 ? 1 : -1);
        } else {
            // 'pedestrian' or 'plain': straight horizontal
            this.vy = 0;
        }
    }

    update() {
        this.age += 1;

        if (this.style === 'rocket') {
            if (this.waiting) {
                this.waitTimer -= 1;
                if (this.waitTimer <= 0) {
                    this.waiting = false;
                    this.x = Math.random() * Math.max(0, canvas.width - this.w);
                    this.y = canvas.height;
                    this.vy = -this.randomSpeed();
                }
            } else {
                this.y += this.vy;
                if (this.y + this.h < 0) {
                    this.waiting = true;
                    this.waitTimer = Math.floor(Math.random() * 90) + 60; // ~1-2.5s @ 60fps
                }
            }
            return this.updateFade();
        }

        if (this.style === 'sway') {
            this.rotation = Math.sin(this.age * this.swaySpeed + this.swayPhase) * this.swayAmplitude;
            return this.updateFade();
        }

        if (this.style === 'still') {
            return this.updateFade();
        }

        if (this.style === 'spin') {
            this.rotation += this.spinSpeed;
            return this.updateFade();
        }

        if (this.style === 'orbit') {
            if (this.orbitWaiting) {
                this.orbitWaitTimer -= 1;
                if (this.orbitWaitTimer <= 0) {
                    this.orbitWaiting = false;
                    const ot = (this.w / 2 + 20) / canvas.width;
                    this.orbitT = this.orbitDirection > 0 ? -ot : 1 + ot;
                }
            } else {
                this.orbitT += this.orbitSpeed * this.orbitDirection;
                this.vx = canvas.width * this.orbitSpeed * this.orbitDirection;
                const ot = (this.w / 2 + 20) / canvas.width;
                const rawSt = this.orbitDirection > 0 ? this.orbitT : 1 - this.orbitT;
                // st spans 0→1 over the full traversal incl. off-screen overshoot on both sides,
                // so the arc is already curving when the sprite first peeks into the visible area.
                const st = (rawSt + ot) / (1 + 2 * ot);
                this.x = this.orbitT * canvas.width - this.w / 2;
                this.y = this.orbitEntryY - (this.orbitEntryY - this.orbitPeakY) * Math.sin(Math.PI * st) - this.h / 2;
                if ((this.orbitDirection > 0 && this.orbitT > 1 + ot) ||
                    (this.orbitDirection < 0 && this.orbitT < -ot)) {
                    this.orbitWaiting = true;
                    const cat = this.category;
                    const waitMin = Number.isFinite(cat.orbitWaitMinFrames) ? cat.orbitWaitMinFrames : 120;
                    const waitMax = Number.isFinite(cat.orbitWaitMaxFrames) ? cat.orbitWaitMaxFrames : 300;
                    this.orbitWaitTimer = Math.floor(waitMin + Math.random() * Math.max(0, waitMax - waitMin));
                }
            }
            return this.updateFade();
        }


        if (this.style === 'pedestrian' && this.hasMovementPath()) {
            this.updateMovementPath();
        } else if (this.style === 'pedestrian' || this.style === 'plain') {
            this.x += this.vx;
            this.y += this.vy;
            this.bounceHorizontally();
            const { yMin, yMax } = this.yBounds();
            if (this.y < yMin) this.y = yMin;
            if (this.y > yMax) this.y = yMax;
        } else if (this.style === 'walk' && this.hasMovementPath()) {
            this.updateMovementPath();
            const walk = this.age * this.walkSpeed + this.walkPhase;
            const hop = Math.abs(Math.sin(walk)) * this.walkBobAmplitude;
            this.y = this.baseY - hop;
            this.rotation = Math.sin(walk) * this.walkTiltAmplitude;
        } else if (this.style === 'walk') {
            this.x += this.vx;
            this.bounceHorizontally();
            const walk = this.age * this.walkSpeed + this.walkPhase;
            const drift = this.driftAmplitude
                ? Math.sin(this.age * this.driftSpeed + this.driftPhase) * this.driftAmplitude
                : 0;
            const { yMin, yMax } = this.yBounds();
            const y = this.baseY + drift - Math.abs(Math.sin(walk)) * this.walkBobAmplitude;
            this.y = Math.min(Math.max(y, yMin), yMax);
            this.rotation = Math.sin(walk) * this.walkTiltAmplitude;
        } else if (this.style === 'ufo') {
            this.x += this.vx;
            this.bounceHorizontally();
            this.y = this.baseY;
        } else {
            this.x += this.vx;
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
                const speedPulse = 1 + Math.sin(road * 1.4) * 0.045;
                this.x += this.vx * (speedPulse - 1);
                this.bounceHorizontally();
                this.y = this.baseY;
                this.rotation = 0;
            } else if (this.style === 'airplane') {
                const flight = this.age * this.flightSpeed + this.flightPhase;
                const altitude = Math.sin(flight) * this.altitudeAmplitude;
                const speedPulse = 1 + Math.sin(flight * 0.8) * 0.1;
                this.x += this.vx * (speedPulse - 1);
                this.bounceHorizontally();
                this.y = this.baseY + altitude;
                this.rotation = Math.sin(flight + Math.PI / 4) * this.bankAmplitude * (this.vx >= 0 ? 1 : -1);
            } else if (this.style === 'watercraft') {
                const wave = this.age * this.waveSpeed + this.wavePhase;
                const bob = Math.sin(wave) * this.bobAmplitude;
                const longSwell = Math.sin(wave * 0.43) * this.driftAmplitude;
                const speedPulse = 1 + Math.sin(wave * 0.7) * 0.12;
                this.x += this.vx * (speedPulse - 1);
                this.bounceHorizontally();
                this.y = this.baseY + bob + longSwell * 0.2;
                this.y = Math.min(Math.max(this.y, yMin), yMax);
                this.rotation = Math.sin(wave + Math.PI / 5) * this.rollAmplitude;
            }
        }

        this.updateFade();
    }

    updateFade() {
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

    drawRootedImage(alpha, centerX) {
        // Pivot at 3/4 of image height: bottom quarter is "in the ground",
        // top three-quarters sway above the floor.
        const rootFraction = this.rootedFraction();
        const pivotX = centerX;
        const pivotY = this.y + this.h * rootFraction;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(pivotX, pivotY);
        ctx.rotate(this.rotation);
        ctx.drawImage(this.img, -this.w / 2, -this.h * rootFraction, this.w, this.h);
        ctx.restore();
    }

    // Small rising/fading bubbles trailing behind a vehicle (opposite of its
    // movement direction), for a "powered, mechanical" underwater feel.
    // Anchored to the vehicle's own center with a small fixed rise, so the
    // trail stays attached to it regardless of its size (scalePct).
    drawBubbleTrail(alpha, centerX, centerY) {
        const direction = this.vx >= 0 ? -1 : 1;
        const cycle = 90; // frames per bubble cycle
        const riseDistance = 60; // px the bubbles travel before fading out
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let i = 0; i < 4; i++) {
            const t = ((this.age + i * (cycle / 4)) % cycle) / cycle; // 0..1
            const bx = centerX + direction * this.w * 0.4 + Math.sin(this.age * 0.12 + i * 1.7) * 5;
            const by = centerY + 10 - t * riseDistance;
            const r = 1.5 + t * 2.5;
            ctx.globalAlpha = alpha * 0.5 * (1 - t);
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    drawCarExhaust(alpha, centerX) {
        const travelDirection = this.vx >= 0 ? 1 : -1;
        const smokeDirection = -travelDirection;
        const baseX = centerX - travelDirection * this.w * 0.43;
        const baseY = this.visualBottomY() - this.h * 0.28;
        const phase = this.age * 0.075 + this.drivePhase;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 4; i += 1) {
            const drift = i * 13 + (Math.sin(phase + i) + 1) * 4;
            const puff = (Math.sin(phase * 1.7 + i * 1.3) + 1) / 2;
            const radius = (5 + i * 2.5 + puff * 2) * this.scaleFactor;
            const x = baseX + smokeDirection * drift;
            const y = baseY - i * 4 + Math.sin(phase + i * 2) * 2;

            ctx.globalAlpha = alpha * Math.max(0, 0.26 - i * 0.045);
            ctx.fillStyle = 'rgba(210, 210, 210, 0.75)';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    draw() {
        if (this.style === 'rocket' && this.waiting) return;

        const alpha = this.layerAlpha * this.fadeAlpha;
        const centerX = this.x + this.w / 2;
        const centerY = this.y + this.h / 2;

        if (this.style === 'airplane') {
            const trailDirection = this.vx >= 0 ? -1 : 1;
            ctx.save();
            ctx.globalAlpha = alpha * 0.22;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            for (let i = 0; i < 3; i++) {
                const trailOffset = 22 + i * 22;
                const lift = Math.sin(this.age * 0.035 + i) * 7;
                ctx.beginPath();
                ctx.moveTo(centerX + trailDirection * trailOffset, centerY + lift);
                ctx.quadraticCurveTo(
                    centerX + trailDirection * (trailOffset + 20),
                    centerY + lift - 5,
                    centerX + trailDirection * (trailOffset + 44),
                    centerY + lift
                );
                ctx.stroke();
            }
            ctx.restore();
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else if (this.style === 'car') {
            this.drawCarExhaust(alpha, centerX);
            ctx.save();
            ctx.globalAlpha = alpha * 0.24;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.beginPath();
            ctx.ellipse(
                centerX,
                this.visualBottomY() - Math.max(2, this.h * 0.025),
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
                const wakeOffset = this.w * 0.23 + i * this.w * 0.07;
                const waveLift = Math.sin(this.age * 0.08 + i) * 5;
                ctx.beginPath();
                ctx.moveTo(centerX + wakeDirection * wakeOffset, centerY + this.h * 0.22 + waveLift);
                ctx.quadraticCurveTo(
                    centerX + wakeDirection * (wakeOffset + this.w * 0.08),
                    centerY + this.h * 0.18 + waveLift + 5,
                    centerX + wakeDirection * (wakeOffset + this.w * 0.16),
                    centerY + this.h * 0.22 + waveLift
                );
                ctx.stroke();
            }
            ctx.restore();
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else if (this.style === 'ufo' && this.bubbleTrail) {
            this.drawBubbleTrail(alpha, centerX, centerY);
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else if (this.style === 'sway' || this.style === 'still') {
            this.drawRootedImage(alpha, centerX);
        } else if (this.style === 'pedestrian' || this.style === 'walk' || this.style === 'ufo' || this.style === 'spin' || this.style === 'orbit') {
            this.drawDirectionalImage(alpha, centerX, centerY);
        } else {
            ctx.globalAlpha = alpha;
            ctx.drawImage(this.img, this.x, this.y, this.w, this.h);
            ctx.globalAlpha = 1;
        }
    }
}

// -------------------- AMBIENT BUBBLES (unterwasser) --------------------
const ambientBubbles = [];
let bubbleBurstCountdown = 180;

function spawnBubbleBurst() {
    const count = 10 + Math.floor(Math.random() * 15);
    for (let i = 0; i < count; i++) {
        ambientBubbles.push({
            x: Math.random() * canvas.width,
            y: canvas.height + Math.random() * 40,
            r: 3 + Math.random() * 14,
            speed: 0.7 + Math.random() * 2.0,
            drift: (Math.random() - 0.5) * 0.9,
            alpha: 0.25 + Math.random() * 0.35,
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.025 + Math.random() * 0.035,
        });
    }
    bubbleBurstCountdown = 180 + Math.floor(Math.random() * 360);
}

function updateAndDrawAmbientBubbles() {
    if (activeThemeName !== 'unterwasser') {
        ambientBubbles.length = 0;
        return;
    }

    bubbleBurstCountdown--;
    if (bubbleBurstCountdown <= 0) spawnBubbleBurst();

    for (let i = ambientBubbles.length - 1; i >= 0; i--) {
        const b = ambientBubbles[i];
        b.y -= b.speed;
        b.x += Math.sin(b.wobblePhase) * b.drift;
        b.wobblePhase += b.wobbleSpeed;

        if (b.y + b.r < 0) { ambientBubbles.splice(i, 1); continue; }

        const fadeTop = canvas.height * 0.12;
        const alpha = Math.max(0, b.y < fadeTop ? b.alpha * (b.y / fadeTop) : b.alpha);

        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = 'rgba(180, 220, 255, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.18;
        ctx.fillStyle = 'rgba(220, 240, 255, 1)';
        ctx.fill();
        ctx.restore();
    }
}

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

    updateAndDrawAmbientBubbles();

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
    activeThemeName = themeName;
    activeImages.length = 0; // Clear previous images

    statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;

    // Hintergrund laden
    const bgUrl = `/theme-image/${encodeURIComponent(theme.image)}`;
    canvas.style.backgroundImage = `url("${bgUrl}")`;
    setThemeBackground(theme);
    applyForegroundImage(theme);

    // Warm all transition videos into local blobs now (page load / reconnect,
    // typically before the crowd arrives) so later theme switches never fetch a
    // ~20 MB video over a saturated network.
    preloadTransitionVideos(config);

    // Request all current images from server
    socket.emit("main:requestAllImages");
});

// CONFIG CHANGED (when admin switches theme)
socket.on("config:changed", (config) => {
    const themeName = config.activeTheme;
    const theme = config.themes[themeName];
    const previousThemeName = activeThemeName;
    const themeChanged = themeName !== activeThemeName;

    const applyTheme = () => {
        themeConfig = theme;
        activeThemeName = themeName;
        activeImages.length = 0;

        statusEl.textContent = `theme: ${themeName} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;

        setThemeBackground(theme);
        applyForegroundImage(theme);

        // Delay ambient bubbles so they don't appear mid-screen during the transition
        if (themeName === 'unterwasser') bubbleBurstCountdown = 360;

        socket.emit("main:requestAllImages");
    };

    if (themeChanged) {
        // Preload the next background so it's cached when the video ends
        new Image().src = `/theme-image/${encodeURIComponent(theme.image)}`;
        playThemeTransition(theme, previousThemeName, applyTheme);
    } else {
        applyTheme();
    }
});

// CATEGORY RANGES CHANGED (admin tuned yMin/yMax/speedMin/speedMax for one
// category) — apply live without wiping the wall: pull active paintings of
// that category into the new band and rescale their horizontal speed.
socket.on("category:rangesChanged", ({ themeName, categoryId, xMinPct, xMaxPct, yMinPct, yMaxPct, speedMin, speedMax, scalePct }) => {
    if (themeName !== activeThemeName) return;
    if (!themeConfig || !themeConfig.categories) return;
    const cat = themeConfig.categories.find(c => c.id === categoryId);
    if (!cat) return;
    if (Number.isFinite(xMinPct)) cat.xMinPct = xMinPct;
    if (Number.isFinite(xMaxPct)) cat.xMaxPct = xMaxPct;
    cat.yMinPct = yMinPct;
    cat.yMaxPct = yMaxPct;
    cat.speedMin = speedMin;
    cat.speedMax = speedMax;
    if (Number.isFinite(scalePct)) cat.scalePct = scalePct;
    activeImages.forEach(fi => {
        if (!fi.category || fi.category.id !== categoryId) return;
        if (fi.style === 'rocket') return;
        fi.clampIntoMovementBounds();
        const sign = Math.sign(fi.vx) || (Math.random() < 0.5 ? -1 : 1);
        fi.vx = sign * fi.randomSpeed();
    });
});

// SETTINGS UPDATE
socket.on("admin:updateSettings", (settings) => {
    serverSettings = Object.assign({}, serverSettings, settings);
    statusEl.textContent = `theme: ${themeConfig ? themeConfig.id : '?'} | fade: ${serverSettings.galleryMode === 'fade' ? 'ON' : 'OFF'}`;
});

// Bild kommt an, mit Theme + movementType (Kategorie-ID dieses Themes)
socket.on("newImage", ({ id, dataUrl, themeName, movementType, facingDirection, score }) => {
    if (!imageBelongsToActiveTheme({ themeName })) return;

    const img = new Image();
    img.onload = () => {
        const category = themeConfig && themeConfig.categories
            ? themeConfig.categories.find(c => c.id === movementType)
            : null;
        if (!category) {
            console.warn('newImage: unknown movementType, dropping image:', movementType);
            return;
        }

        const addImage = (finalImg) => {
            activeImages.push(new FloatingImage(id, finalImg, category, facingDirection, score));
        };

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

            // Wait for the scaled image to fully load before constructing
            // FloatingImage — otherwise img.height = 0 at init time, which
            // breaks sway/still positioning (this.y is set only once).
            const finalImg = new Image();
            finalImg.onload = () => addImage(finalImg);
            finalImg.src = tempCanvas.toDataURL();
        } else {
            addImage(img);
        }
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
    images.filter(imageBelongsToActiveTheme).forEach(imageData => {
        const img = new Image();
        img.onload = () => {
            const category = themeConfig && themeConfig.categories
                ? themeConfig.categories.find(c => c.id === imageData.movementType)
                : null;
            if (!category) {
                console.warn('main:allImages: unknown movementType, skipping:', imageData.movementType);
                return;
            }

            const addImage = (finalImg) => {
                activeImages.push(new FloatingImage(imageData.id, finalImg, category, imageData.facingDirection, imageData.score));
            };

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

                const finalImg = new Image();
                finalImg.onload = () => addImage(finalImg);
                finalImg.src = tempCanvas.toDataURL();
            } else {
                addImage(img);
            }
        };
        img.src = imageData.dataUrl;
    });
});

// Note: this client (`/main`) is purely for projection. It does NOT take
// screenshots for the save flow — the server runs its own headless /main page
// (see lib/mainRenderer.js) and screenshots that one on finalizeArtwork.
// That decouples save reliability from the wall-PC's browser state.
