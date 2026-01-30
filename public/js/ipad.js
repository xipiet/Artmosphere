const socket = io();

// Theme view elements
const themeView = document.getElementById('themeView');
const drawView = document.getElementById('drawView');
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
const zoneEls = [document.getElementById('zone0'), document.getElementById('zone1'), document.getElementById('zone2')];

// Drawing view elements
const canvas = document.getElementById('drawArea');
const ctx = canvas.getContext('2d');

let config = null;
let activeThemeName = null;
let theme = null;
let drawing = false;
let currentColor = "#000000";
let currentSize = 4;
let eraseMode = false;
let selectedZone = null;

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
    // Set canvas resolution to full viewport
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    
    applyZoneLayout();
    if (theme) drawBgImage();
}
window.addEventListener('resize', resizeBg);

function applyZoneLayout() {
    for (let i=0;i<3;i++){
        const el = zoneEls[i];
        if (!theme || !theme.zones || !theme.zones[i]) { 
            el.style.display='none'; 
            continue; 
        }
        el.style.display='flex';
        const z = theme.zones[i];
        const start = z.yStartPct;
        const end = z.yEndPct;
        el.style.top = (start) + '%';
        el.style.height = (end - start) + '%';
    }
}

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
        'space': 'Weltraum'
    };
    const displayName = themeDisplayNames[activeThemeName] || activeThemeName;
    const themeNameEl = document.getElementById('themeName');
    if (themeNameEl) {
        themeNameEl.textContent = displayName;
    }
}

function loadBgAndApply() {
    if (!theme) return;
    const imageRef = theme.image;
    bgImg = new Image();
    bgImg.src = '/theme-image/' + encodeURIComponent(imageRef);
    bgImg.onload = () => { resizeBg(); drawBgImage(); };
    bgImg.onerror = () => { console.error("Failed to load image:", imageRef); };
    applyZoneLayout();
}

// ZONE CLICK HANDLERS
for (let i=0;i<3;i++){
    zoneEls[i].addEventListener('click', () => {
        if (!theme || !theme.zones[i]) return;
        selectedZone = theme.zones[i].id;
        enterDrawingMode();
    });
}

function enterDrawingMode() {
    themeView.style.display = 'none';
    drawView.style.display = 'flex';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentColor = "#000000";
    currentSize = 4;
    eraseMode = false;
}

// DRAWING HANDLERS
const sizeSlider = document.getElementById("sizeSlider");
sizeSlider.addEventListener("input", () => {
    currentSize = parseInt(sizeSlider.value);
});

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function startDraw(e) {
    drawing = true;
    ctx.beginPath();
    const { x, y } = getPos(e);
    ctx.moveTo(x, y);
}

function draw(e) {
    if (!drawing) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = eraseMode ? "#ffffff" : currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
}

function endDraw() { drawing = false; }

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", draw);
canvas.addEventListener("mouseup", endDraw);

canvas.addEventListener("touchstart", startDraw, { passive:false });
canvas.addEventListener("touchmove", draw, { passive:false });
canvas.addEventListener("touchend", endDraw);

document.querySelectorAll(".color-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        eraseMode = false;
        currentColor = btn.dataset.color;
    });
});

document.getElementById("erase").addEventListener("click", () => {
    eraseMode = true;
});

document.getElementById("back").addEventListener("click", () => {
    drawView.style.display = 'none';
    themeView.style.display = 'flex';
});

document.getElementById("clear").addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

document.getElementById("send").addEventListener("click", () => {
    const dataUrl = canvas.toDataURL("image/png");
    socket.emit("sendImage", { dataUrl, zoneId: selectedZone });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    window.location.href = "/ipad-endscreen";
});

// Screenshot (disabled in HTML)
// document.getElementById("screenshot").addEventListener("click", () => {
//     const link = document.createElement("a");
//     link.href = canvas.toDataURL("image/png");
//     link.download = `drawing_${Date.now()}.png`;
//     link.click();
// });

// HELP MODAL
const helpModal = document.getElementById("helpModal");
const helpBtnTheme = document.getElementById("helpBtnTheme");
const helpBtnDraw = document.getElementById("helpBtnDraw");
const modalClose = document.querySelector(".modal-close");

function openHelpModal() {
    helpModal.classList.add("show");
}

function closeHelpModal() {
    helpModal.classList.remove("show");
}

helpBtnTheme.addEventListener("click", openHelpModal);
helpBtnDraw.addEventListener("click", openHelpModal);
modalClose.addEventListener("click", closeHelpModal);

helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) {
        closeHelpModal();
    }
});

setTimeout(resizeBg, 120);
