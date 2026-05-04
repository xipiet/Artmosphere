const socket = io();
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const galleryModeDropdown = document.getElementById('galleryModeDropdown');
const maxImagesInput = document.getElementById('maxImagesInput');
const maxImagesModeDropdown = document.getElementById('maxImagesModeDropdown');
const normalizeToggle = document.getElementById('normalizeToggle');
const foregroundPaintings = document.getElementById('foregroundPaintings');
const midgroundPaintings = document.getElementById('midgroundPaintings');
const backgroundPaintings = document.getElementById('backgroundPaintings');
const opacityInputs = {
    foregroundOpacityMin: document.getElementById('foregroundOpacityMin'),
    foregroundOpacityMax: document.getElementById('foregroundOpacityMax'),
    midgroundOpacityMin: document.getElementById('midgroundOpacityMin'),
    midgroundOpacityMax: document.getElementById('midgroundOpacityMax'),
    backgroundOpacityMin: document.getElementById('backgroundOpacityMin'),
    backgroundOpacityMax: document.getElementById('backgroundOpacityMax'),
};
const maxPaintingsSettings = document.getElementById('maxPaintingsSettings');
const maxImagesModeSetting = document.getElementById('maxImagesModeSetting');
const themeDropdown = document.getElementById('themeDropdown');
const categoryRangesList = document.getElementById('categoryRangesList');
const gallery = document.getElementById('gallery');
const galleryCount = document.getElementById('galleryCount');
const gallerySort = document.getElementById('gallerySort');
const galleryAggregate = document.getElementById('galleryAggregate');

let currentConfig = null;
let currentSettings = null;
let activeImages = [];

// Utility: Show status message
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
        galleryMode: "maxPaintings",
        maxImages: 30,
        maxImagesMode: "fade",
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
    
    document.getElementById('currentThemeName').textContent = currentConfig.activeTheme || 'ocean';
    galleryModeDropdown.value = currentSettings.galleryMode || 'fade';
    maxImagesInput.value = currentSettings.maxImages || 30;
    maxImagesModeDropdown.value = currentSettings.maxImagesMode || 'fade';
    normalizeToggle.checked = currentSettings.normalizeSize !== false;
    foregroundPaintings.value = currentSettings.foregroundPaintings || 10;
    midgroundPaintings.value = currentSettings.midgroundPaintings || 10;
    backgroundPaintings.value = currentSettings.backgroundPaintings || 10;
    hydrateOpacityInputs(currentSettings);

    updateGalleryModeUI();
    
    // Populate theme dropdown
    updateThemeDropdown();
    
    if (currentConfig.themes && currentConfig.themes[currentConfig.activeTheme]) {
        previewBg(currentConfig.themes[currentConfig.activeTheme].image);
    }
    renderCategoryRanges();

    // Request current gallery
    socket.emit('admin:requestGallery');
});

socket.on('config:changed', (conf) => {
    currentConfig = conf;
    document.getElementById('currentThemeName').textContent = conf.activeTheme;
    updateThemeDropdown();

    if (currentConfig.themes && currentConfig.themes[currentConfig.activeTheme]) {
        previewBg(currentConfig.themes[currentConfig.activeTheme].image);
    }
    renderCategoryRanges();
    showStatus('Theme config updated');
});

socket.on('category:rangesChanged', ({ themeName, categoryId, yMinPct, yMaxPct, speedMin, speedMax, scalePct }) => {
    if (!currentConfig || !currentConfig.themes || !currentConfig.themes[themeName]) return;
    const cat = currentConfig.themes[themeName].categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.yMinPct = yMinPct;
    cat.yMaxPct = yMaxPct;
    cat.speedMin = speedMin;
    cat.speedMax = speedMax;
    if (Number.isFinite(scalePct)) cat.scalePct = scalePct;
    if (themeName === currentConfig.activeTheme) {
        const row = categoryRangesList.querySelector(`[data-category-id="${categoryId}"]`);
        if (row) {
            const active = document.activeElement;
            row.querySelectorAll('input[data-field]').forEach(input => {
                if (input === active) return;
                input.value = cat[input.dataset.field];
            });
        }
    }
});

socket.on('admin:updateSettings', (settings) => {
    currentSettings = settings;
    galleryModeDropdown.value = settings.galleryMode || 'fade';
    maxImagesInput.value = settings.maxImages || 30;
    maxImagesModeDropdown.value = settings.maxImagesMode || 'fade';
    normalizeToggle.checked = settings.normalizeSize !== false;
    foregroundPaintings.value = settings.foregroundPaintings || 10;
    midgroundPaintings.value = settings.midgroundPaintings || 10;
    backgroundPaintings.value = settings.backgroundPaintings || 10;
    hydrateOpacityInputs(settings);
    updateGalleryModeUI();
});

function hydrateOpacityInputs(s) {
    const defaults = {
        foregroundOpacityMin: 0.7, foregroundOpacityMax: 1.0,
        midgroundOpacityMin: 0.4, midgroundOpacityMax: 0.69,
        backgroundOpacityMin: 0.1, backgroundOpacityMax: 0.39,
    };
    Object.keys(opacityInputs).forEach(key => {
        const el = opacityInputs[key];
        if (!el) return;
        const v = s && Number.isFinite(Number(s[key])) ? Number(s[key]) : defaults[key];
        if (document.activeElement !== el) el.value = v;
    });
}

// Gallery updated
socket.on('admin:updateGallery', (images) => {
    activeImages = images || [];
    renderGallery();
});

// Live score change for a single image — patch in place + re-render
socket.on('image:voteUpdate', ({ id, score, votes }) => {
    const img = activeImages.find(i => i.id === id);
    if (!img) return;
    img.score = score || 0;
    if (votes) img.votes = votes;
    renderGallery();
});

if (gallerySort) {
    gallerySort.addEventListener('change', renderGallery);
}

function updateThemeDropdown() {
    themeDropdown.innerHTML = '';
    if (currentConfig && currentConfig.themes) {
    Object.keys(currentConfig.themes).forEach(themeName => {
        const option = document.createElement('option');
        option.value = themeName;
        option.textContent = themeName;
        if (themeName === currentConfig.activeTheme) {
        option.selected = true;
        }
        themeDropdown.appendChild(option);
    });
    }
}

function previewBg(fn) {
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = '/theme-image/' + encodeURIComponent(fn);
    img.onerror = () => preview.textContent = 'Image not found';
    preview.appendChild(img);
}

function renderCategoryRanges() {
    if (!categoryRangesList) return;
    const theme = currentConfig && currentConfig.themes && currentConfig.themes[currentConfig.activeTheme];
    if (!theme || !Array.isArray(theme.categories) || theme.categories.length === 0) {
        categoryRangesList.innerHTML = '<div style="color:#888; font-style:italic;">Kein aktives Theme oder keine Kategorien.</div>';
        return;
    }
    categoryRangesList.innerHTML = theme.categories.map(cat => `
        <div class="category-row" data-category-id="${cat.id}" style="display:flex; flex-wrap:wrap; gap:15px; align-items:center; padding:10px 0; border-bottom:1px solid #eee;">
            <div style="min-width:170px;"><span style="font-size:1.4em;">${cat.icon || ''}</span> <strong>${cat.label || cat.id}</strong> <small style="color:#888;">(${cat.id})</small></div>
            <label style="font-size:0.9em;">yMin %
                <input type="number" min="0" max="100" step="1" data-field="yMinPct" value="${cat.yMinPct}" style="width:70px; margin-left:5px;">
            </label>
            <label style="font-size:0.9em;">yMax %
                <input type="number" min="0" max="100" step="1" data-field="yMaxPct" value="${cat.yMaxPct}" style="width:70px; margin-left:5px;">
            </label>
            <label style="font-size:0.9em;">speedMin
                <input type="number" min="0" max="2" step="0.01" data-field="speedMin" value="${cat.speedMin}" style="width:80px; margin-left:5px;">
            </label>
            <label style="font-size:0.9em;">speedMax
                <input type="number" min="0" max="2" step="0.01" data-field="speedMax" value="${cat.speedMax}" style="width:80px; margin-left:5px;">
            </label>
            <label style="font-size:0.9em;">Größe %
                <input type="number" min="10" max="400" step="1" data-field="scalePct" value="${Number.isFinite(cat.scalePct) ? cat.scalePct : 100}" style="width:75px; margin-left:5px;">
            </label>
        </div>
    `).join('');
}

if (categoryRangesList) {
    categoryRangesList.addEventListener('change', (e) => {
        const input = e.target.closest('input[data-field]');
        if (!input) return;
        const row = input.closest('[data-category-id]');
        if (!row || !currentConfig) return;
        const categoryId = row.dataset.categoryId;
        const themeName = currentConfig.activeTheme;
        const theme = currentConfig.themes && currentConfig.themes[themeName];
        const cat = theme && theme.categories.find(c => c.id === categoryId);
        if (!cat) return;
        const fields = ['yMinPct', 'yMaxPct', 'speedMin', 'speedMax', 'scalePct'];
        const payload = { themeName, categoryId };
        fields.forEach(f => {
            const el = row.querySelector(`input[data-field="${f}"]`);
            payload[f] = Number(el.value);
        });
        socket.emit('admin:updateCategoryRanges', payload);
        showStatus(`Kategorie "${cat.label || categoryId}" aktualisiert`);
    });
}

// Render gallery
function totalVotes(img) {
    const v = img.votes || {};
    return (v.veryGood || 0) + (v.good || 0) + (v.bad || 0) + (v.veryBad || 0);
}

function scoreBadge(score) {
    const cls = score > 0 ? 'score-pos' : score < 0 ? 'score-neg' : 'score-zero';
    const sign = score > 0 ? '+' : '';
    return `<span class="score-badge ${cls}">Score ${sign}${score}</span>`;
}

function voteBreakdown(votes) {
    const v = votes || {};
    const vg = v.veryGood || 0, g = v.good || 0, b = v.bad || 0, vb = v.veryBad || 0;
    if (vg + g + b + vb === 0) return '<div class="vote-breakdown"><span>no votes yet</span></div>';
    return `<div class="vote-breakdown">
        <span class="vb-vg">⭐ ${vg}</span>
        <span class="vb-g">👍 ${g}</span>
        <span class="vb-b">👎 ${b}</span>
        <span class="vb-vb">💀 ${vb}</span>
    </div>`;
}

function sortedImages() {
    const mode = gallerySort ? gallerySort.value : 'recent';
    const copy = activeImages.slice();
    switch (mode) {
        case 'scoreDesc':
            return copy.sort((a, b) => (b.score || 0) - (a.score || 0) || b.timestamp - a.timestamp);
        case 'scoreAsc':
            return copy.sort((a, b) => (a.score || 0) - (b.score || 0) || b.timestamp - a.timestamp);
        case 'totalVotes':
            return copy.sort((a, b) => totalVotes(b) - totalVotes(a) || b.timestamp - a.timestamp);
        case 'recent':
        default:
            return copy.reverse(); // newest first; activeImages keeps oldest at index 0
    }
}

function renderGallery() {
    galleryCount.textContent = activeImages.length;

    // Aggregate header: avg score + total votes across active images
    if (galleryAggregate) {
        if (activeImages.length === 0) {
            galleryAggregate.textContent = '';
        } else {
            const totalV = activeImages.reduce((s, i) => s + totalVotes(i), 0);
            const avg = activeImages.reduce((s, i) => s + (i.score || 0), 0) / activeImages.length;
            galleryAggregate.textContent = `Ø Score ${avg.toFixed(1)} · ${totalV} votes total`;
        }
    }

    if (activeImages.length === 0) {
        gallery.innerHTML = '<div class="gallery-empty">No paintings yet. Draw on the iPad to add!</div>';
        return;
    }

    gallery.innerHTML = sortedImages().map(img => `
        <div class="gallery-item">
          <img src="${img.dataUrl}" alt="Painting">
          <div class="gallery-item-info">
            <span class="zone-badge">${(img.movementType || '—').toUpperCase()}</span>
            ${scoreBadge(img.score || 0)}
            <br><small>${new Date(img.timestamp).toLocaleTimeString()}</small>
            ${voteBreakdown(img.votes)}
          </div>
          <button class="gallery-item-delete" onclick="deleteImage('${img.id}')">🗑️ Delete</button>
        </div>
    `).join('');
}

// Delete image
window.deleteImage = function(imageId) {
    if (confirm('Delete this painting?')) {
        socket.emit('admin:removeImage', imageId);
    }
};

// Gallery Mode Dropdown + maxImages/maxImagesMode settings
galleryModeDropdown.addEventListener('change', () => {
    updateSettings();
});

maxImagesInput.addEventListener('change', () => {
    // Automatically distribute max images equally across layers
    const maxImg = Number(maxImagesInput.value);
    const base = Math.floor(maxImg / 3);
    const remainder = maxImg % 3;
    
    // Give foreground the remainder to handle uneven division
    foregroundPaintings.value = base + remainder;
    midgroundPaintings.value = base;
    backgroundPaintings.value = base;
    
    updateSettings();
});

maxImagesModeDropdown.addEventListener('change', () => {
    updateSettings();
});

normalizeToggle.addEventListener('change', () => {
    updateSettings();
});

foregroundPaintings.addEventListener('change', () => {
    updateSettings();
});

midgroundPaintings.addEventListener('change', () => {
    updateSettings();
});

backgroundPaintings.addEventListener('change', () => {
    updateSettings();
});

Object.values(opacityInputs).forEach(el => {
    if (el) el.addEventListener('change', () => updateSettings());
});

// Show/hide max paintings settings based on gallery mode
function updateGalleryModeUI() {
    const isMaxPaintingsMode = galleryModeDropdown.value === 'maxPaintings';
    maxPaintingsSettings.style.display = isMaxPaintingsMode ? 'block' : 'none';
    maxImagesModeSetting.style.display = isMaxPaintingsMode ? 'block' : 'none';
}

function updateSettings() {
    const clamp01 = v => Math.min(Math.max(Number(v), 0), 1);
    const fgMin = clamp01(opacityInputs.foregroundOpacityMin.value);
    const fgMax = Math.max(fgMin, clamp01(opacityInputs.foregroundOpacityMax.value));
    const mgMin = clamp01(opacityInputs.midgroundOpacityMin.value);
    const mgMax = Math.max(mgMin, clamp01(opacityInputs.midgroundOpacityMax.value));
    const bgMin = clamp01(opacityInputs.backgroundOpacityMin.value);
    const bgMax = Math.max(bgMin, clamp01(opacityInputs.backgroundOpacityMax.value));
    const newSettings = {
        galleryMode: galleryModeDropdown.value,
        maxImages: Number(maxImagesInput.value),
        maxImagesMode: maxImagesModeDropdown.value,
        normalizeSize: normalizeToggle.checked,
        foregroundPaintings: Number(foregroundPaintings.value) || 10,
        midgroundPaintings: Number(midgroundPaintings.value) || 10,
        backgroundPaintings: Number(backgroundPaintings.value) || 10,
        foregroundOpacityMax: fgMax,
        foregroundOpacityMin: fgMin,
        midgroundOpacityMax: mgMax,
        midgroundOpacityMin: mgMin,
        backgroundOpacityMax: bgMax,
        backgroundOpacityMin: bgMin,
    };
    socket.emit("admin:updateSettings", newSettings);
    updateGalleryModeUI();
    showStatus('Settings updated');
}

// Theme dropdown
themeDropdown.addEventListener('change', () => {
    const selectedTheme = themeDropdown.value;
    if (!selectedTheme) return;
    
    const cfg = { activeTheme: selectedTheme, themes: currentConfig.themes };
    socket.emit('saveConfig', cfg, (res) => {
    if (res && res.ok) {
        showStatus(`Switched to theme: ${selectedTheme}`);
    } else {
        showStatus('Theme switch failed', true);
    }
    });
});