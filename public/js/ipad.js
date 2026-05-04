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

let config = null;
let activeThemeName = null;
let theme = null;
let drawing = false;
let currentColor = "#000000";
let currentSize = 4;
let currentTool = "draw";
let selectedCategory = null;       // category id (string)
let selectedCategoryDef = null;    // full category object from config
let facingDirection = "right";
const undoStack = [];
const redoStack = [];
const MAX_HISTORY_STEPS = 35;

let initialized = false;

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
        'ocean': 'Unterwasserwelt',
        'jungle': 'Dschungelwelt',
        'forest': 'Waldwelt',
        'desert': 'Wüstenwelt',
        'space': 'Weltraum',
        'stadt': 'Stadtwelt'
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
    currentSize = 4;
    sizeSlider.value = currentSize;
    setTool("draw");
    setActiveColorButton(currentColor);
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
        currentColor = btn.dataset.color;
        setActiveColorButton(currentColor);
        if (currentTool === "erase") setTool("draw");
    });
});

function setActiveColorButton(color) {
    document.querySelectorAll(".color-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.color === color);
    });
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
        { dataUrl, movementType: selectedCategory, facingDirection },
        (err, response) => {
            sendBtn.disabled = false;
            sendBtn.textContent = "Send";

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

    if (!initialized) { 
        initialized = true; 
        kidsMode = newMode; 
        return; 
    } 
    
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
    }
    
    kidsMode = newMode;
});

setTimeout(resizeBg, 120);