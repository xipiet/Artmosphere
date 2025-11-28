const socket = io();
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const fadeToggle = document.getElementById('fadeToggle');
const themeDropdown = document.getElementById('themeDropdown');

let currentConfig = null;
let currentSettings = null;

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
});

socket.on('config:changed', (conf) => {
    currentConfig = conf;
    document.getElementById('currentThemeName').textContent = conf.activeTheme;
    status.textContent = 'Config updated';
    updateThemeDropdown();
    previewBg(currentConfig.themes[currentConfig.activeTheme].image);
});

socket.on('admin:updateSettings', (settings) => {
    currentSettings = settings;
    fadeToggle.checked = settings.fade !== false;
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
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.onerror = () => preview.textContent = 'Background not found';
    preview.appendChild(img);
}

// Fade toggle
fadeToggle.addEventListener('change', () => {
    const newSettings = { fade: fadeToggle.checked };
    socket.emit('admin:updateSettings', newSettings, (res) => {
    status.textContent = 'Fade ' + (fadeToggle.checked ? 'enabled' : 'disabled');
    });
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
    // basic validation
    if (themeObj.zones[0].yStartPct !== 0 || themeObj.zones[2].yEndPct !== 100 || themeObj.zones[0].yEndPct !== themeObj.zones[1].yStartPct || themeObj.zones[1].yEndPct !== themeObj.zones[2].yStartPct) {
    status.textContent = 'Invalid zone percentages (must be sequential and cover 0..100)';
    return;
    }
    // Save with ALL existing themes, only update the current one
    const cfg = { 
    activeTheme: currentConfig.activeTheme, 
    themes: { ...currentConfig.themes } // Copy all themes
    };
    cfg.themes[themeName] = themeObj; // Update only the current theme
    socket.emit('saveConfig', cfg, (res) => {
    if (res && res.ok) {
        status.textContent = 'Saved config.';
        previewBg(themeObj.image);
    } else {
        status.textContent = 'Save failed';
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
        status.textContent = `Switched to theme: ${selectedTheme}`;
        // Load the selected theme's data
        document.getElementById('currentThemeName').textContent = selectedTheme;
        if (currentConfig.themes[selectedTheme]) {
        const t = currentConfig.themes[selectedTheme];
        document.getElementById('z0start').value = t.zones[0].yStartPct;
        document.getElementById('z0end').value = t.zones[0].yEndPct;
        document.getElementById('z1start').value = t.zones[1].yStartPct;
        document.getElementById('z1end').value = t.zones[1].yEndPct;
        document.getElementById('z2start').value = t.zones[2].yStartPct;
        document.getElementById('z2end').value = t.zones[2].yEndPct;
        }
        previewBg(currentConfig.themes[selectedTheme].image);
    } else {
        status.textContent = 'Switch failed';
    }
    });
});

// initial preview
// --- LÄDT SOWIESO BEIM INIT --- sm
// previewBg(document.getElementById('bgFile').value);