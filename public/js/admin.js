const socket = io();
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const fadeToggle = document.getElementById('fadeToggle');
const themeDropdown = document.getElementById('themeDropdown');
const gallery = document.getElementById('gallery');
const galleryCount = document.getElementById('galleryCount');

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
    currentSettings = d.settings || { fade: true };
    
    document.getElementById('currentThemeName').textContent = currentConfig.activeTheme || 'ocean';
    fadeToggle.checked = currentSettings.fade !== false;
    
    // Populate theme dropdown
    updateThemeDropdown();
    
    // Load current theme data
    if (currentConfig.themes && currentConfig.themes[currentConfig.activeTheme]) {
    const t = currentConfig.themes[currentConfig.activeTheme];
    document.getElementById('z0start').value = t.zones[0].yStartPct;
    document.getElementById('z0end').value = t.zones[0].yEndPct;
    document.getElementById('z1start').value = t.zones[1].yStartPct;
    document.getElementById('z1end').value = t.zones[1].yEndPct;
    document.getElementById('z2start').value = t.zones[2].yStartPct;
    document.getElementById('z2end').value = t.zones[2].yEndPct;
    }
    previewBg(currentConfig.themes[currentConfig.activeTheme].image);
    
    // Request current gallery
    socket.emit('admin:requestGallery');
});

socket.on('config:changed', (conf) => {
    currentConfig = conf;
    document.getElementById('currentThemeName').textContent = conf.activeTheme;
    updateThemeDropdown();
    previewBg(currentConfig.themes[currentConfig.activeTheme].image);
    showStatus('Theme config updated');
});

socket.on('admin:updateSettings', (settings) => {
    currentSettings = settings;
    fadeToggle.checked = settings.fade !== false;
});

// Gallery updated
socket.on('admin:updateGallery', (images) => {
    activeImages = images || [];
    renderGallery();
});

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

// Render gallery
function renderGallery() {
    galleryCount.textContent = activeImages.length;
    
    if (activeImages.length === 0) {
        gallery.innerHTML = '<div class="gallery-empty">No paintings yet. Draw on the iPad to add!</div>';
        return;
    }

    gallery.innerHTML = activeImages.map(img => `
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

// Delete image
window.deleteImage = function(imageId) {
    if (confirm('Delete this painting?')) {
        socket.emit('admin:removeImage', imageId);
    }
};

// Fade toggle
fadeToggle.addEventListener('change', () => {
    const newSettings = { fade: fadeToggle.checked };
    socket.emit('admin:updateSettings', newSettings);
});

// Save button
document.getElementById('saveBtn').addEventListener('click', () => {
    const themeName = currentConfig.activeTheme;
    const themeObj = {
    image: themeName + '.png',
    zones: [
        { id:'top', yStartPct: Number(document.getElementById('z0start').value), yEndPct: Number(document.getElementById('z0end').value) },
        { id:'middle', yStartPct: Number(document.getElementById('z1start').value), yEndPct: Number(document.getElementById('z1end').value) },
        { id:'bottom', yStartPct: Number(document.getElementById('z2start').value), yEndPct: Number(document.getElementById('z2end').value) }
    ]
    };
    
    // Validation
    if (themeObj.zones[0].yStartPct !== 0 || themeObj.zones[2].yEndPct !== 100 || 
        themeObj.zones[0].yEndPct !== themeObj.zones[1].yStartPct || 
        themeObj.zones[1].yEndPct !== themeObj.zones[2].yStartPct) {
        showStatus('Invalid zone percentages (must be sequential and cover 0..100)', true);
        return;
    }
    
    const cfg = { 
    activeTheme: currentConfig.activeTheme, 
    themes: { ...currentConfig.themes }
    };
    cfg.themes[themeName] = themeObj;
    
    socket.emit('saveConfig', cfg, (res) => {
    if (res && res.ok) {
        showStatus('✅ Zone config saved!');
    } else {
        showStatus('Save failed', true);
    }
    });
});

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