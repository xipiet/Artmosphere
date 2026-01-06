const socket = io();
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const fadeToggle = document.getElementById('fadeToggle');

// Speed controls
const hopSpeedInput = document.getElementById('hopSpeedInput');
const floatSpeedInput = document.getElementById('floatSpeedInput');

// Movement selector, normalize toggle, max images
const movementSelect = document.getElementById('movementSelect');  
const normalizeToggle = document.getElementById('normalizeToggle'); 
const maxImagesInput = document.getElementById('maxImagesInput');   

// ⭐ NEW: Opacity controls
const foregroundOpacityMax = document.getElementById('foregroundOpacityMax');
const foregroundOpacityMin = document.getElementById('foregroundOpacityMin');
const midgroundOpacityMax = document.getElementById('midgroundOpacityMax');
const midgroundOpacityMin = document.getElementById('midgroundOpacityMin');
const backgroundOpacityMax = document.getElementById('backgroundOpacityMax');
const backgroundOpacityMin = document.getElementById('backgroundOpacityMin');

const themeDropdown = document.getElementById('themeDropdown');
const gallery = document.getElementById('gallery');
const galleryCount = document.getElementById('galleryCount');

let currentConfig = null;
let currentSettings = null;
let activeImages = [];

function showStatus(message, isError = false) {
    status.textContent = message;
    status.className = isError ? 'error' : 'success';
    status.style.display = 'block';
    setTimeout(() => {
        status.style.display = 'none';
    }, 3000);
}

socket.on('app:init', (d) => {
    currentConfig = d.config || d;
    currentSettings = d.settings || { 
        fade: true, 
        movement: "floating", 
        maxImages: 30, 
        normalizeSize: true, 
        hopSpeed: 0.05, 
        floatSpeed: 1,
        foregroundOpacityMax: 1.0,
        foregroundOpacityMin: 0.70,
        midgroundOpacityMax: 0.69,
        midgroundOpacityMin: 0.40,
        backgroundOpacityMax: 0.39,
        backgroundOpacityMin: 0.10
    };

    document.getElementById('currentThemeName').textContent = currentConfig.activeTheme || 'ocean';

    fadeToggle.checked = currentSettings.fade !== false;
    movementSelect.value = currentSettings.movement || "floating";
    normalizeToggle.checked = currentSettings.normalizeSize !== false;
    maxImagesInput.value = currentSettings.maxImages || 30;

    hopSpeedInput.value = currentSettings.hopSpeed || 0.05;
    floatSpeedInput.value = currentSettings.floatSpeed || 1;

    // ⭐ Initialize opacity controls
    foregroundOpacityMax.value = currentSettings.foregroundOpacityMax || 1.0;
    foregroundOpacityMin.value = currentSettings.foregroundOpacityMin || 0.70;
    midgroundOpacityMax.value = currentSettings.midgroundOpacityMax || 0.69;
    midgroundOpacityMin.value = currentSettings.midgroundOpacityMin || 0.40;
    backgroundOpacityMax.value = currentSettings.backgroundOpacityMax || 0.39;
    backgroundOpacityMin.value = currentSettings.backgroundOpacityMin || 0.10;

    updateThemeDropdown();
    const t = currentConfig.themes[currentConfig.activeTheme];
    if (t) {
        document.getElementById('z0start').value = t.zones[0].yStartPct;
        document.getElementById('z0end').value = t.zones[0].yEndPct;
        document.getElementById('z1start').value = t.zones[1].yStartPct;
        document.getElementById('z1end').value = t.zones[1].yEndPct;
        document.getElementById('z2start').value = t.zones[2].yStartPct;
        document.getElementById('z2end').value = t.zones[2].yEndPct;

        if (t.movement) movementSelect.value = t.movement;
    }
    previewBg(t.image);
    socket.emit('admin:requestGallery');
});

socket.on('config:changed', (conf) => {
    currentConfig = conf;
    document.getElementById('currentThemeName').textContent = conf.activeTheme;
    updateThemeDropdown();
    const t = currentConfig.themes[currentConfig.activeTheme];
    previewBg(t.image);
    if (t.movement) movementSelect.value = t.movement;
    showStatus('Theme config updated');
});

socket.on('admin:updateSettings', (settings) => {
    currentSettings = settings;
    fadeToggle.checked = settings.fade !== false;
    movementSelect.value = settings.movement || "floating";
    normalizeToggle.checked = settings.normalizeSize !== false;
    maxImagesInput.value = settings.maxImages || 30;

    hopSpeedInput.value = settings.hopSpeed || 0.05;
    floatSpeedInput.value = settings.floatSpeed || 1;

    // ⭐ Update opacity controls
    foregroundOpacityMax.value = settings.foregroundOpacityMax || 1.0;
    foregroundOpacityMin.value = settings.foregroundOpacityMin || 0.70;
    midgroundOpacityMax.value = settings.midgroundOpacityMax || 0.69;
    midgroundOpacityMin.value = settings.midgroundOpacityMin || 0.40;
    backgroundOpacityMax.value = settings.backgroundOpacityMax || 0.39;
    backgroundOpacityMin.value = settings.backgroundOpacityMin || 0.10;
});

socket.on('admin:updateGallery', (images) => {
    activeImages = images || [];
    renderGallery();
});

function updateThemeDropdown() {
    themeDropdown.innerHTML = '';
    if (!currentConfig || !currentConfig.themes) return;
    Object.keys(currentConfig.themes).forEach(themeName => {
        const option = document.createElement('option');
        option.value = themeName;
        option.textContent = themeName;
        if (themeName === currentConfig.activeTheme) option.selected = true;
        themeDropdown.appendChild(option);
    });
}

function previewBg(fn) {
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = '/theme-image/' + encodeURIComponent(fn);
    img.onerror = () => (preview.textContent = 'Image not found');
    preview.appendChild(img);
}

function renderGallery() {
    galleryCount.textContent = activeImages.length;
    if (activeImages.length === 0) {
        gallery.innerHTML = '<div class="gallery-empty">No paintings yet. Draw on the iPad to add!</div>';
        return;
    }
    gallery.innerHTML = activeImages
        .map(
            (img) => `
        <div class="gallery-item">
          <img src="${img.dataUrl}" alt="Painting">
          <div class="gallery-item-info">
            <span class="zone-badge">${img.zoneId.toUpperCase()}</span>
            <br><small>${new Date(img.timestamp).toLocaleTimeString()}</small>
          </div>
          <button class="gallery-item-delete" onclick="deleteImage('${img.id}')">🗑️ Delete</button>
        </div>
    `).join('');
}

window.deleteImage = function (imageId) {
    if (confirm('Delete this painting?')) {
        socket.emit('admin:removeImage', imageId);
    }
};

fadeToggle.addEventListener('change', updateSettings);
movementSelect.addEventListener('change', updateSettings);
normalizeToggle.addEventListener('change', updateSettings);
maxImagesInput.addEventListener('input', updateSettings);

hopSpeedInput.addEventListener('input', updateSettings);
floatSpeedInput.addEventListener('input', updateSettings);

// ⭐ NEW: Listen to opacity controls
foregroundOpacityMax.addEventListener('input', updateSettings);
foregroundOpacityMin.addEventListener('input', updateSettings);
midgroundOpacityMax.addEventListener('input', updateSettings);
midgroundOpacityMin.addEventListener('input', updateSettings);
backgroundOpacityMax.addEventListener('input', updateSettings);
backgroundOpacityMin.addEventListener('input', updateSettings);

function updateSettings() {
    const newSettings = {
        fade: fadeToggle.checked,
        movement: movementSelect.value,
        normalizeSize: normalizeToggle.checked,
        maxImages: Number(maxImagesInput.value) || 30,
        hopSpeed: Number(hopSpeedInput.value) || 0.05,
        floatSpeed: Number(floatSpeedInput.value) || 1,
        // ⭐ NEW: Include opacity settings
        foregroundOpacityMax: Number(foregroundOpacityMax.value) || 1.0,
        foregroundOpacityMin: Number(foregroundOpacityMin.value) || 0.70,
        midgroundOpacityMax: Number(midgroundOpacityMax.value) || 0.69,
        midgroundOpacityMin: Number(midgroundOpacityMin.value) || 0.40,
        backgroundOpacityMax: Number(backgroundOpacityMax.value) || 0.39,
        backgroundOpacityMin: Number(backgroundOpacityMin.value) || 0.10
    };
    socket.emit("admin:updateSettings", newSettings);
}

document.getElementById('saveBtn').addEventListener('click', () => {
    const themeName = currentConfig.activeTheme;
    const themeObj = {
        image: themeName + '.png',
        movement: movementSelect.value,
        zones: [
            { id: 'top', yStartPct: Number(document.getElementById('z0start').value), yEndPct: Number(document.getElementById('z0end').value) },
            { id: 'middle', yStartPct: Number(document.getElementById('z1start').value), yEndPct: Number(document.getElementById('z1end').value) },
            { id: 'bottom', yStartPct: Number(document.getElementById('z2start').value), yEndPct: Number(document.getElementById('z2end').value) }
        ]
    };

    if (
        themeObj.zones[0].yStartPct !== 0 ||
        themeObj.zones[2].yEndPct !== 100 ||
        themeObj.zones[0].yEndPct !== themeObj.zones[1].yStartPct ||
        themeObj.zones[1].yEndPct !== themeObj.zones[2].yStartPct
    ) {
        showStatus('Invalid zone percentages (must be sequential and cover 0..100)', true);
        return;
    }

    const cfg = { activeTheme: currentConfig.activeTheme, themes: { ...currentConfig.themes } };
    cfg.themes[themeName] = themeObj;
    socket.emit('saveConfig', cfg, (res) => {
        if (res && res.ok) showStatus('✅ Zone & movement config saved!');
        else showStatus('Save failed', true);
    });
});

themeDropdown.addEventListener('change', () => {
    const selectedTheme = themeDropdown.value;
    if (!selectedTheme) return;
    const cfg = { activeTheme: selectedTheme, themes: currentConfig.themes };
    socket.emit('saveConfig', cfg, (res) => {
        if (res && res.ok) showStatus(`Switched to theme: ${selectedTheme}`);
        else showStatus('Theme switch failed', true);
    });
});