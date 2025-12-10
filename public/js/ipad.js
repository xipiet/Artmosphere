const socket = io();

// Theme and drawing elements
const themeView = document.getElementById('themeView');
const drawView = document.getElementById('drawView');
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
const zoneEls = [document.getElementById('zone0'), document.getElementById('zone1'), document.getElementById('zone2')];

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

// -------------------- Theme & Background --------------------
let bgImg = new Image();
function drawBgImage() {
    if (!bgImg || !bgImg.complete) return;
    const cw = bgCanvas.width, ch = bgCanvas.height;
    const iw = bgImg.width, ih = bgImg.height;
    const scale = Math.max(cw/iw, ch/ih);
    const w = iw * scale, h = ih * scale;
    const x = (cw - w)/2, y = (ch - h)/2;
    bgCtx.clearRect(0,0,cw,ch);
    bgCtx.drawImage(bgImg, x, y, w, h);
}

function resizeBg() {
    const vp = document.getElementById('viewport');
    const rect = vp.getBoundingClientRect();
    bgCanvas.width = rect.width;
    bgCanvas.height = Math.max(320, Math.round(rect.width * 0.56));
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

// -------------------- Socket Events --------------------
socket.on('app:init', (d) => {
    config = d.config || d;
    activeThemeName = config.activeTheme;
    theme = config.themes[activeThemeName] || null;
    if (theme) loadBgAndApply();
});

socket.on('config:changed', (newConfig) => {
    config = newConfig;
    activeThemeName = config.activeTheme;
    theme = config.themes[activeThemeName] || null;
    if (theme) loadBgAndApply();
});

function loadBgAndApply() {
    if (!theme) return;
    const imageRef = theme.image;
    bgImg = new Image();
    bgImg.src = '/theme-image/' + encodeURIComponent(imageRef);
    bgImg.onload = () => { resizeBg(); drawBgImage(); };
    applyZoneLayout();
}

// -------------------- Drawing Setup --------------------
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

// Drawing event helpers
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
    btn.addEventListener("click", () => { eraseMode = false; currentColor = btn.dataset.color; });
});
document.getElementById("erase").addEventListener("click", () => { eraseMode = true; });
document.getElementById("back").addEventListener("click", () => { drawView.style.display='none'; themeView.style.display='flex'; });
document.getElementById("clear").addEventListener("click", () => { ctx.clearRect(0,0,canvas.width,canvas.height); });

// -------------------- Cropping & Resizing for Square Footage --------------------
const TARGET_AREA = 20000; // same as main.js

// Get bounding box of user drawing
function getDrawingBoundingBox(drawCanvas) {
    const data = drawCanvas.getContext('2d').getImageData(0,0,drawCanvas.width,drawCanvas.height).data;
    let minX=drawCanvas.width, minY=drawCanvas.height, maxX=0, maxY=0;
    for (let y=0;y<drawCanvas.height;y++){
        for (let x=0;x<drawCanvas.width;x++){
            const idx=(y*drawCanvas.width+x)*4;
            if(data[idx+3]>0){
                if(x<minX) minX=x; if(x>maxX) maxX=x;
                if(y<minY) minY=y; if(y>maxY) maxY=y;
            }
        }
    }
    if(minX>maxX || minY>maxY) return null;
    return {x:minX, y:minY, width:maxX-minX+1, height:maxY-minY+1};
}

// Crop canvas to bounding box
function cropDrawing(drawCanvas, bbox){
    const tempCanvas=document.createElement('canvas');
    tempCanvas.width=bbox.width; tempCanvas.height=bbox.height;
    tempCanvas.getContext('2d').drawImage(drawCanvas, bbox.x,bbox.y,bbox.width,bbox.height,0,0,bbox.width,bbox.height);
    return tempCanvas;
}

// Resize to target area
function resizeToTargetArea(canvas){
    const aspectRatio=canvas.width/canvas.height;
    const newWidth=Math.sqrt(TARGET_AREA*aspectRatio);
    const newHeight=TARGET_AREA/newWidth;
    const resizedCanvas=document.createElement('canvas');
    resizedCanvas.width=newWidth; resizedCanvas.height=newHeight;
    resizedCanvas.getContext('2d').drawImage(canvas,0,0,newWidth,newHeight);
    return resizedCanvas;
}

// Send drawing to server
document.getElementById("send").addEventListener("click", () => {
    const bbox = getDrawingBoundingBox(canvas);
    if(!bbox) return alert("Please draw something!");
    const cropped = cropDrawing(canvas,bbox);
    const resized = resizeToTargetArea(cropped);
    const dataUrl = resized.toDataURL("image/png");

    socket.emit("sendImage",{ dataUrl, zoneId: selectedZone });

    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawView.style.display='none';
    themeView.style.display='flex';
});

// Screenshot (optional)
document.getElementById("screenshot").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `drawing_${Date.now()}.png`;
    link.click();
});

setTimeout(resizeBg, 120);
