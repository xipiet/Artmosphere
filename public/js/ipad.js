const socket = io();

// Category view elements
const categoryView = document.getElementById('categoryView');
const drawView = document.getElementById('drawView');
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
const cardsContainer = document.getElementById('cardsContainer');
const drawingTemplate = document.getElementById('drawingTemplate');

// Drawing view elements
const canvas = document.getElementById('drawArea');
const ctx = canvas.getContext('2d');
const sizeSlider = document.getElementById('sizeSlider');
const customColorBtn = document.getElementById('customColorBtn');
const customColorPreview = document.getElementById('customColorPreview');
const colorPickerPopup = document.getElementById('colorPickerPopup');
const colorWheel = document.getElementById('colorWheel');
const colorValueSlider = document.getElementById('colorValueSlider');
const freeColorValue = document.getElementById('freeColorValue');
const closeColorPickerBtn = document.getElementById('closeColorPicker');

let config = null;
let activeThemeName = null;
let theme = null;
let drawing = false;
let currentColor = "#000000";
let currentColorSource = "preset";
let currentSize = 4;
let currentTool = "draw";
let selectedCategory = null;       // category id (string)
let selectedCategoryDef = null;    // full category object from config
let selectedThemeName = null;
let facingDirection = "right";
const undoStack = [];
const redoStack = [];
const MAX_HISTORY_STEPS = 35;
let customColorHsv = { h: 0, s: 0, v: 0 };
let colorWheelPointerActive = false;
let colorValuePointerActive = false;

// THEME DISPLAY
let bgImg = new Image();
function drawBgImage() {
    if (!bgImg || !bgImg.complete) return;
    const cw = bgCanvas.width, ch = bgCanvas.height;
    const iw = bgImg.width, ih = bgImg.height;
    const scale = Math.max(cw/iw, ch/ih);
    const w = iw * scale, h = ih * scale;
    const x = (cw - w)/2, y = (ch - h)/2;
    bgCtx.clearRect(0, 0, cw, ch);
    bgCtx.drawImage(bgImg, x, y, w, h);
}

function resizeBg() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    if (theme) drawBgImage();
}
window.addEventListener('resize', resizeBg);

// SOCKET EVENTS
socket.on('app:init', (d) => {
    config = d.config || d;
    activeThemeName = config.activeTheme;
    theme = config.themes[activeThemeName] || null;
    updateThemeNameInHelp();
    if (theme) {
        loadBgAndApply();
    } else {
        console.warn("No theme found for", activeThemeName);
    }
});

socket.on('config:changed', (newConfig) => {
    config = newConfig;
    activeThemeName = config.activeTheme;
    theme = config.themes[activeThemeName] || null;
    updateThemeNameInHelp();
    if (theme) loadBgAndApply();
});

function updateThemeNameInHelp() {
    if (!activeThemeName) return;
    const themeDisplayNames = {
        'unterwasser': 'Unterwasserwelt',
        'stadt': 'Stadtwelt',
        'weltall': 'Weltraum'
    };
    const displayName = themeDisplayNames[activeThemeName] || activeThemeName;
    const themeNameEl = document.getElementById('themeName');
    if (themeNameEl) themeNameEl.textContent = displayName;
}

function loadBgAndApply() {
    if (!theme || !theme.image) return;
    bgImg = new Image();
    bgImg.src = '/theme-image/' + encodeURIComponent(theme.image);
    bgImg.onload = () => { resizeBg(); drawBgImage(); };
    bgImg.onerror = () => { console.error("Failed to load background image:", theme.image); };
    renderCategoryCards(theme.categories || []);
}

function renderCategoryCards(categories) {
    cardsContainer.innerHTML = '';
    categories.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.category = cat.id;

        const icon = document.createElement('div');
        icon.className = 'card-icon';
        icon.textContent = cat.icon || '';

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = cat.label || cat.id;

        card.appendChild(icon);
        card.appendChild(title);
        card.addEventListener('click', () => {
            selectedCategory = cat.id;
            selectedCategoryDef = cat;
            selectedThemeName = activeThemeName;
            enterDrawingMode();
        });
        cardsContainer.appendChild(card);
    });
}

function applyTemplateForCategory(cat) {
    if (cat && cat.template) {
        drawView.style.setProperty('--drawing-template-image', `url("${cat.template}")`);
    } else {
        drawView.style.setProperty('--drawing-template-image', 'none');
    }
    drawView.style.setProperty('--drawing-template-size', (cat && cat.templateSize) || '88% auto');
}

function enterDrawingMode() {
    drawView.dataset.category = selectedCategory;
    applyTemplateForCategory(selectedCategoryDef);
    categoryView.style.display = 'none';
    drawView.style.display = 'flex';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentColor = "#000000";
    currentColorSource = "preset";
    currentSize = 4;
    sizeSlider.value = currentSize;
    setTool("draw");
    setActiveColorButton(currentColor, false);
    updateCustomColorUi(currentColor);
    closeColorPicker();
    setFacingDirection("right");
    resetHistory();
}

sizeSlider.addEventListener("input", () => {
    currentSize = parseInt(sizeSlider.value);
});

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
    };
}

function startDraw(e) {
    e.preventDefault();
    const { x, y } = getPos(e);
    if (currentTool === "fill") {
        saveHistoryStep();
        floodFill(Math.floor(x), Math.floor(y), hexToRgba(currentColor));
        return;
    }

    saveHistoryStep();
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
}

function draw(e) {
    e.preventDefault();
    if (!drawing) return;
    if (currentTool === "fill") return;

    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.globalCompositeOperation = currentTool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = currentTool === "erase" ? "rgba(0,0,0,1)" : currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
}

function endDraw() {
    drawing = false;
    ctx.globalCompositeOperation = "source-over";
}

function captureCanvasState() {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function restoreCanvasState(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(state, 0, 0);
}

function updateHistoryButtons() {
    document.getElementById("undoBtn").disabled = undoStack.length === 0;
    document.getElementById("redoBtn").disabled = redoStack.length === 0;
}

function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    updateHistoryButtons();
}

function saveHistoryStep() {
    undoStack.push(captureCanvasState());
    if (undoStack.length > MAX_HISTORY_STEPS) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
}

function undoCanvas() {
    if (undoStack.length === 0) return;
    redoStack.push(captureCanvasState());
    restoreCanvasState(undoStack.pop());
    updateHistoryButtons();
}

function redoCanvas() {
    if (redoStack.length === 0) return;
    undoStack.push(captureCanvasState());
    restoreCanvasState(redoStack.pop());
    updateHistoryButtons();
}

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", draw);
canvas.addEventListener("mouseup", endDraw);
canvas.addEventListener("mouseleave", endDraw);
canvas.addEventListener("touchstart", startDraw, { passive:false });
canvas.addEventListener("touchmove", draw, { passive:false });
canvas.addEventListener("touchend", endDraw);
canvas.addEventListener("touchcancel", endDraw);

document.querySelectorAll(".color-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        setDrawingColor(btn.dataset.color, { source: "preset" });
        closeColorPicker();
    });
});

function setDrawingColor(color, options = {}) {
    currentColor = normalizeColorHex(color);
    currentColorSource = options.source === "custom" ? "custom" : "preset";
    setActiveColorButton(currentColor, currentColorSource === "custom");
    updateCustomColorUi(currentColor, { syncPicker: options.syncPicker !== false });
    if (currentTool === "erase") setTool("draw");
}

function normalizeColorHex(color) {
    if (typeof color !== "string") return "#000000";
    const value = color.trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        return "#" + value.slice(1).split("").map(ch => ch + ch).join("").toLowerCase();
    }
    return "#000000";
}

function setActiveColorButton(color, preferCustom = false) {
    let matchedPreset = false;
    document.querySelectorAll(".color-btn").forEach(btn => {
        const isActive = !preferCustom && normalizeColorHex(btn.dataset.color) === normalizeColorHex(color);
        btn.classList.toggle("active", isActive);
        if (isActive) matchedPreset = true;
    });
    if (customColorBtn) customColorBtn.classList.toggle("active", preferCustom || !matchedPreset);
}

function updateCustomColorUi(color, options = {}) {
    const normalized = normalizeColorHex(color);
    if (options.syncPicker !== false) {
        customColorHsv = hexToHsv(normalized);
    }
    if (freeColorValue) freeColorValue.textContent = normalized.toUpperCase();
    if (customColorPreview) customColorPreview.style.background = normalized;
    renderCustomColorPicker();
}

function hexToRgb(hex) {
    const normalized = normalizeColorHex(hex).slice(1);
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function rgbToHex({ r, g, b }) {
    return "#" + [r, g, b]
        .map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0"))
        .join("");
}

function hexToHsv(hex) {
    const { r, g, b } = hexToRgb(hex);
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const delta = max - min;
    let h = 0;

    if (delta !== 0) {
        if (max === rf) h = ((gf - bf) / delta) % 6;
        else if (max === gf) h = (bf - rf) / delta + 2;
        else h = (rf - gf) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    return {
        h,
        s: max === 0 ? 0 : delta / max,
        v: max
    };
}

function hsvToRgb(h, s, v) {
    const chroma = v * s;
    const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - chroma;
    let rf = 0;
    let gf = 0;
    let bf = 0;

    if (h < 60) [rf, gf, bf] = [chroma, x, 0];
    else if (h < 120) [rf, gf, bf] = [x, chroma, 0];
    else if (h < 180) [rf, gf, bf] = [0, chroma, x];
    else if (h < 240) [rf, gf, bf] = [0, x, chroma];
    else if (h < 300) [rf, gf, bf] = [x, 0, chroma];
    else [rf, gf, bf] = [chroma, 0, x];

    return {
        r: (rf + m) * 255,
        g: (gf + m) * 255,
        b: (bf + m) * 255
    };
}

function getCanvasPointerPos(targetCanvas, e) {
    const rect = targetCanvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (targetCanvas.width / rect.width),
        y: (e.clientY - rect.top) * (targetCanvas.height / rect.height)
    };
}

function renderCustomColorPicker() {
    renderColorWheel();
    renderColorValueSlider();
}

function renderColorWheel() {
    if (!colorWheel) return;
    const wheelCtx = colorWheel.getContext("2d");
    const width = colorWheel.width;
    const height = colorWheel.height;
    const radius = Math.min(width, height) / 2 - 2;
    const centerX = width / 2;
    const centerY = height / 2;
    const image = wheelCtx.createImageData(width, height);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const index = (y * width + x) * 4;

            if (distance <= radius) {
                const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
                const saturation = Math.min(1, distance / radius);
                const rgb = hsvToRgb(hue, saturation, 1);
                image.data[index] = rgb.r;
                image.data[index + 1] = rgb.g;
                image.data[index + 2] = rgb.b;
                image.data[index + 3] = 255;
            } else {
                image.data[index + 3] = 0;
            }
        }
    }

    wheelCtx.clearRect(0, 0, width, height);
    wheelCtx.putImageData(image, 0, 0);

    const markerAngle = customColorHsv.h * Math.PI / 180;
    const markerRadius = customColorHsv.s * radius;
    const markerX = centerX + Math.cos(markerAngle) * markerRadius;
    const markerY = centerY + Math.sin(markerAngle) * markerRadius;
    wheelCtx.lineWidth = 3;
    wheelCtx.strokeStyle = "#fff";
    wheelCtx.beginPath();
    wheelCtx.arc(markerX, markerY, 7, 0, Math.PI * 2);
    wheelCtx.stroke();
    wheelCtx.lineWidth = 1.5;
    wheelCtx.strokeStyle = "rgba(0,0,0,0.75)";
    wheelCtx.beginPath();
    wheelCtx.arc(markerX, markerY, 9, 0, Math.PI * 2);
    wheelCtx.stroke();
}

function renderColorValueSlider() {
    if (!colorValueSlider) return;
    const sliderCtx = colorValueSlider.getContext("2d");
    const width = colorValueSlider.width;
    const height = colorValueSlider.height;
    const fullColor = rgbToHex(hsvToRgb(customColorHsv.h, customColorHsv.s, 1));
    const gradient = sliderCtx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#000000");
    gradient.addColorStop(1, fullColor);

    sliderCtx.clearRect(0, 0, width, height);
    sliderCtx.fillStyle = gradient;
    sliderCtx.fillRect(0, 0, width, height);

    const markerX = customColorHsv.v * width;
    sliderCtx.lineWidth = 3;
    sliderCtx.strokeStyle = "#fff";
    sliderCtx.beginPath();
    sliderCtx.arc(markerX, height / 2, 8, 0, Math.PI * 2);
    sliderCtx.stroke();
    sliderCtx.lineWidth = 1.5;
    sliderCtx.strokeStyle = "rgba(0,0,0,0.75)";
    sliderCtx.beginPath();
    sliderCtx.arc(markerX, height / 2, 10, 0, Math.PI * 2);
    sliderCtx.stroke();
}

function applyCustomHsvColor() {
    const hex = rgbToHex(hsvToRgb(customColorHsv.h, customColorHsv.s, customColorHsv.v));
    setDrawingColor(hex, { source: "custom", syncPicker: false });
}

function updateColorWheelFromPointer(e) {
    if (!colorWheel) return;
    const { x, y } = getCanvasPointerPos(colorWheel, e);
    const radius = Math.min(colorWheel.width, colorWheel.height) / 2 - 2;
    const centerX = colorWheel.width / 2;
    const centerY = colorWheel.height / 2;
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 1) {
        customColorHsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    }
    customColorHsv.s = Math.min(1, distance / radius);
    if (customColorHsv.v < 0.08) customColorHsv.v = 1;
    applyCustomHsvColor();
}

function updateColorValueFromPointer(e) {
    if (!colorValueSlider) return;
    const { x } = getCanvasPointerPos(colorValueSlider, e);
    customColorHsv.v = Math.min(1, Math.max(0, x / colorValueSlider.width));
    applyCustomHsvColor();
}

function positionColorPickerPopup() {
    if (!customColorBtn || !colorPickerPopup || colorPickerPopup.hidden) return;
    const rect = customColorBtn.getBoundingClientRect();
    const margin = 12;
    const popupWidth = colorPickerPopup.offsetWidth;
    const popupHeight = colorPickerPopup.offsetHeight;
    const left = Math.min(
        window.innerWidth - popupWidth - margin,
        Math.max(margin, rect.left + rect.width / 2 - popupWidth / 2)
    );
    const top = Math.min(
        window.innerHeight - popupHeight - margin,
        rect.bottom + 12
    );
    colorPickerPopup.style.left = `${left}px`;
    colorPickerPopup.style.top = `${Math.max(margin, top)}px`;
}

function openColorPicker() {
    if (!customColorBtn || !colorPickerPopup) return;
    colorPickerPopup.hidden = false;
    customColorBtn.setAttribute("aria-expanded", "true");
    currentColorSource = "custom";
    setActiveColorButton(currentColor, true);
    customColorHsv = hexToHsv(currentColor);
    renderCustomColorPicker();
    positionColorPickerPopup();
}

function closeColorPicker() {
    if (!customColorBtn || !colorPickerPopup) return;
    colorPickerPopup.hidden = true;
    customColorBtn.setAttribute("aria-expanded", "false");
}

function toggleColorPicker() {
    if (!colorPickerPopup || colorPickerPopup.hidden) {
        openColorPicker();
    } else {
        closeColorPicker();
    }
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll(".tool-btn").forEach(btn => {
        btn.classList.toggle("active", btn.id === `${tool}Tool` || (tool === "erase" && btn.id === "erase"));
    });
}

document.getElementById("drawTool").addEventListener("click", () => setTool("draw"));
document.getElementById("fillTool").addEventListener("click", () => setTool("fill"));
document.getElementById("erase").addEventListener("click", () => setTool("erase"));
document.getElementById("undoBtn").addEventListener("click", undoCanvas);
document.getElementById("redoBtn").addEventListener("click", redoCanvas);

if (customColorBtn) {
    customColorBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleColorPicker();
    });
}

if (colorPickerPopup) {
    colorPickerPopup.addEventListener("click", (e) => e.stopPropagation());
}

if (colorWheel) {
    colorWheel.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        colorWheelPointerActive = true;
        colorWheel.setPointerCapture(e.pointerId);
        updateColorWheelFromPointer(e);
    });
    colorWheel.addEventListener("pointermove", (e) => {
        if (!colorWheelPointerActive) return;
        e.preventDefault();
        updateColorWheelFromPointer(e);
    });
    colorWheel.addEventListener("pointerup", (e) => {
        colorWheelPointerActive = false;
        if (colorWheel.hasPointerCapture(e.pointerId)) colorWheel.releasePointerCapture(e.pointerId);
    });
    colorWheel.addEventListener("pointercancel", () => {
        colorWheelPointerActive = false;
    });
}

if (colorValueSlider) {
    colorValueSlider.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        colorValuePointerActive = true;
        colorValueSlider.setPointerCapture(e.pointerId);
        updateColorValueFromPointer(e);
    });
    colorValueSlider.addEventListener("pointermove", (e) => {
        if (!colorValuePointerActive) return;
        e.preventDefault();
        updateColorValueFromPointer(e);
    });
    colorValueSlider.addEventListener("pointerup", (e) => {
        colorValuePointerActive = false;
        if (colorValueSlider.hasPointerCapture(e.pointerId)) colorValueSlider.releasePointerCapture(e.pointerId);
    });
    colorValueSlider.addEventListener("pointercancel", () => {
        colorValuePointerActive = false;
    });
}

if (closeColorPickerBtn) {
    closeColorPickerBtn.addEventListener("click", closeColorPicker);
}

document.addEventListener("click", (e) => {
    if (!colorPickerPopup || colorPickerPopup.hidden) return;
    if (customColorBtn && customColorBtn.contains(e.target)) return;
    if (colorPickerPopup.contains(e.target)) return;
    closeColorPicker();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeColorPicker();
});

window.addEventListener("resize", positionColorPickerPopup);

function hexToRgba(hex) {
    const value = hex.replace("#", "");
    const full = value.length === 3
        ? value.split("").map(ch => ch + ch).join("")
        : value;

    return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
        255
    ];
}

function colorsMatch(data, index, target, tolerance) {
    return Math.abs(data[index] - target[0]) <= tolerance &&
        Math.abs(data[index + 1] - target[1]) <= tolerance &&
        Math.abs(data[index + 2] - target[2]) <= tolerance &&
        Math.abs(data[index + 3] - target[3]) <= tolerance;
}

function floodFill(startX, startY, fillColor) {
    if (startX < 0 || startY < 0 || startX >= canvas.width || startY >= canvas.height) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const startIndex = (startY * canvas.width + startX) * 4;
    const targetColor = [
        data[startIndex],
        data[startIndex + 1],
        data[startIndex + 2],
        data[startIndex + 3]
    ];
    const tolerance = targetColor[3] === 0 ? 0 : 24;

    if (
        Math.abs(targetColor[0] - fillColor[0]) <= tolerance &&
        Math.abs(targetColor[1] - fillColor[1]) <= tolerance &&
        Math.abs(targetColor[2] - fillColor[2]) <= tolerance &&
        Math.abs(targetColor[3] - fillColor[3]) <= tolerance
    ) {
        return;
    }

    const stack = new Int32Array(canvas.width * canvas.height * 4);
    let stackSize = 0;
    const visited = new Uint8Array(canvas.width * canvas.height);
    stack[stackSize++] = startY * canvas.width + startX;

    while (stackSize > 0) {
        const pixel = stack[--stackSize];
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;

        if (visited[pixel]) continue;
        visited[pixel] = 1;

        const index = pixel * 4;
        if (!colorsMatch(data, index, targetColor, tolerance)) continue;

        data[index] = fillColor[0];
        data[index + 1] = fillColor[1];
        data[index + 2] = fillColor[2];
        data[index + 3] = fillColor[3];

        if (x + 1 < canvas.width) stack[stackSize++] = pixel + 1;
        if (x - 1 >= 0) stack[stackSize++] = pixel - 1;
        if (y + 1 < canvas.height) stack[stackSize++] = pixel + canvas.width;
        if (y - 1 >= 0) stack[stackSize++] = pixel - canvas.width;
    }

    ctx.putImageData(imageData, 0, 0);
}

function setFacingDirection(direction) {
    facingDirection = direction === "left" ? "left" : "right";
    drawView.dataset.facing = facingDirection;
    document.querySelectorAll(".direction-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.facing === facingDirection);
    });
}

document.querySelectorAll(".direction-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        setFacingDirection(btn.dataset.facing);
    });
});

document.getElementById("back").addEventListener("click", () => {
    drawView.style.display = 'none';
    categoryView.style.display = 'flex';
    delete drawView.dataset.category;
    delete drawView.dataset.facing;
    selectedCategory = null;
    selectedCategoryDef = null;
    selectedThemeName = null;
});

document.getElementById("clear").addEventListener("click", () => {
    saveHistoryStep();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

document.getElementById("send").addEventListener("click", () => {
    const sendBtn = document.getElementById("send");
    if (sendBtn.disabled) return;

    const dataUrl = canvas.toDataURL("image/png");
    sendBtn.disabled = true;
    sendBtn.textContent = "Wird gesendet…";

    // Wait for server ack to get the sessionId BEFORE redirecting. This avoids
    // the old race where the endscreen loaded before the session was registered.
    socket.timeout(10000).emit("sendImage",
        { dataUrl, movementType: selectedCategory, themeName: selectedThemeName || activeThemeName, facingDirection },
        (err, response) => {
            sendBtn.disabled = false;
            sendBtn.textContent = "Senden";

            if (err) {
                alert("Verbindungsfehler beim Senden — bitte nochmal versuchen.");
                return;
            }
            if (!response || !response.ok || !response.sessionId) {
                alert("Senden fehlgeschlagen: " + ((response && response.error) || "unbekannt"));
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            resetHistory();
            window.location.href = "/ipad-endscreen?sid=" + encodeURIComponent(response.sessionId);
        }
    );
});

// HELP MODAL
const helpModal = document.getElementById("helpModal");
const helpBtnCategory = document.getElementById("helpBtnCategory");
const helpBtnDraw = document.getElementById("helpBtnDraw");
const modalClose = document.querySelector(".modal-close");

function openHelpModal() { helpModal.classList.add("show"); }
function closeHelpModal() { helpModal.classList.remove("show"); }

helpBtnCategory.addEventListener("click", openHelpModal);
helpBtnDraw.addEventListener("click", openHelpModal);
modalClose.addEventListener("click", closeHelpModal);

helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) closeHelpModal();
});

// KIDS MODE TOGGLE
const checkbox = document.querySelector("#toggle-button-1 .toggle-checkbox");
checkbox.addEventListener("change", () => {
    const kidsMode = checkbox.checked;
    socket.emit("kidsMode:set", kidsMode);
});

// KIDS MODE (wird wie eine Art Modul geladen)
async function loadKidsUI() {
    const container = document.getElementById("kids-ui");

    if (!container) {
        console.error("kids-ui container not found");
        return;
    }

    if (container.dataset.loaded === "true") return;

    // HTML laden
    const res = await fetch("/ipad-kids.html");
    container.innerHTML = await res.text();

    // CSS laden
    if (!document.getElementById("kids-css")) {
        const link = document.createElement("link");
        link.id = "kids-css";
        link.rel = "stylesheet";
        link.href = "/css/ipad-kids.css";
        document.head.appendChild(link);
    }

    // JS laden
    const script = document.createElement("script");
    script.src = "/js/ipad-kids.js";
    script.defer = true;
    script.addEventListener("load", () => { script.dataset.ready = "true"; });
    document.body.appendChild(script);

    container.dataset.loaded = "true";
}

socket.on("kidsMode:update", async (d) => { 
    const newMode = d.kidsMode; 
    checkbox.checked = newMode;
    
    if (newMode) {
        await loadKidsUI();
        document.getElementById("kids-ui").style.display = "block";
        
        await new Promise((resolve) => {
            const script = document.querySelector('script[src="/js/ipad-kids.js"]');
            if (script && script.dataset.ready === "true") {
                resolve();
            } else {
                script.addEventListener("load", resolve, { once: true });
            }
        });

        kidsTutorial.currentKey = "intro";
        showCurrentStep();
        document.getElementById("kids-ui").style.display = "block";
    } else {
        document.getElementById("kids-ui").style.display = "none";
        if (typeof window.clearTutorialUI === 'function') {
            window.clearTutorialUI();
        }
    }
});

setTimeout(resizeBg, 120);
