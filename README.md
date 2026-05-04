# Artmosphere - Orakel

- Web-App mit /ipad, /main, /admin und /kritiker <br/>

## Installation

- git clone <br/>
- cd Artmosphere <br/>
- Node & npm installieren (https://nodejs.org/en/download) <br/>
- npm install (zieht express, socket.io und puppeteer)<br/>
- node server.js <br/>

**Speicherort der Kunstwerke:** Standardmäßig unter `~/.local/share/artmosphere/saved/` (XDG-Standard, kein sudo nötig). Override per Umgebungsvariable: `ARTMOSPHERE_SAVE_PATH=/eigener/pfad node server.js`.

**Screenshot-Pipeline:** Beim Server-Start startet im Hintergrund automatisch ein Headless-Chromium (via Puppeteer), der eine eigene Kopie der `/main`-Seite hält. Beim Speichern eines Kunstwerks wird ein Screenshot **dieses** Headless-Browsers in `main_canvas.png` geschrieben — der Anzeige-PC an der Wand muss dafür weder offen noch im Vordergrund sein. In Docker-Slim-Containern müssen die Chromium-Abhängigkeiten (`libnss3`, `libxss1`, `libasound2`, `libatk-bridge2.0-0`, `libgbm1` etc.) vorhanden sein.

## Update

- ps aux | grep node <br/>
- kill "entsprechende PID" <br/>
- cd /Artmosphere <br/>
- git pull <br/>
- reboot <br/>

---

## Developer Guide

### Kategorien-System (`/ipad`)

Der iPad-Flow besteht aus **einer** kategorienbasierten Auswahl:

- Auf `/ipad` wählt der Besucher eine **Kategorie** (z.B. Fußgänger 🚶, Auto 🚗, Flugzeug ✈️) aus dynamisch generierten Cards.
- Die Kategorie bestimmt vertikalen Bereich (`yMinPct`/`yMaxPct`) und Geschwindigkeit (`speedMin`/`speedMax`) der Bewegung auf dem `/main` Display.
- Beim Senden geht `{ dataUrl, movementType }` an den Server; `movementType` ist die `id` der Kategorie aus dem aktiven Theme.

### Workflow für Administratoren

1. **Admin Panel** (`/admin`): Theme auswählen, Layer-Distribution / Gallery Mode / Max Paintings einstellen.
2. **Auf dem iPad** (`/ipad`): Kategorie wählen → zeichnen → Senden → Name eingeben.
3. **Main Display** (`/main`): zeigt alle Malereien mit kategoriespezifischer Bewegung.

### Theme-Struktur in `public/themes/config.json`

```json
{
  "activeTheme": "stadt",
  "themes": {
    "stadt": {
      "image": "stadt.png",
      "categories": [
        { "id": "pedestrian", "icon": "🚶", "label": "Fußgänger", "style": "pedestrian",
          "yMinPct": 67, "yMaxPct": 100, "speedMin": 0.10, "speedMax": 0.15,
          "template": "/media/drawing-template-pedestrian.svg", "templateSize": "30% auto" },
        { "id": "car",        "icon": "🚗", "label": "Auto",     "style": "car",
          "yMinPct": 50, "yMaxPct": 60,  "speedMin": 0.22, "speedMax": 0.35,
          "template": "/media/drawing-template-car.svg",       "templateSize": "88% auto" },
        { "id": "airplane",   "icon": "✈️", "label": "Flugzeug", "style": "airplane",
          "yMinPct": 4,  "yMaxPct": 30,  "speedMin": 0.22, "speedMax": 0.36,
          "template": "/media/drawing-template-airplane.svg",  "templateSize": "72% auto" },
        { "id": "watercraft", "icon": "🚤", "label": "Wasserverkehr", "style": "watercraft",
          "yMinPct": 72, "yMaxPct": 90,  "speedMin": 0.16, "speedMax": 0.26,
          "template": "/media/drawing-template-watercraft.svg", "templateSize": "50% auto" }
      ]
    }
  }
}
```

`config.json` ist `.gitignored` und lebt nur lokal/auf der Prod-Maschine.

**Felder pro Kategorie:**
- `id` — eindeutige ID, wird als `movementType` über das Socket geschickt
- `icon` / `label` — Anzeige auf der Auswahl-Card
- `style` — bestimmt Bewegungs- und Render-Flair in `main.js`. Verfügbare Werte: `pedestrian` (langsam, geradlinig), `car` (Spurwechsel + Schatten), `airplane` (Banking + Kondensstreifen), `watercraft` (Wellen-Bob + Wake), `plain` (statisch). Eine neue `style`-Variante erfordert Code in `FloatingImage`.
- `yMinPct` / `yMaxPct` — vertikales Band (0–100% der Canvas-Höhe)
- `speedMin` / `speedMax` — horizontale Grundgeschwindigkeit
- `template` / `templateSize` — optionale Schablonen-SVG hinter dem Zeichen-Canvas (Helfer für die Besucher) und CSS `background-size`-String

### Neues Theme hinzufügen

1. Hintergrundbild in `public/themes/<theme>.png` ablegen.
2. Theme-Eintrag in `public/themes/config.json` ergänzen, mit Kategorien (siehe Felder oben). Wiederverwendbare `style`-Werte erfordern keinen Code, neue `style`-Werte schon.
3. Optional Schablonen-SVGs in `public/media/` ablegen.
4. Im Admin-Panel auf das neue Theme umschalten — `/ipad` und `/main` aktualisieren sich automatisch via `config:changed`.

### Zeichen-Tools auf `/ipad`

- Stift (frei zeichnen), Füllen (Flood-Fill, ~24-Toleranz), Radierer (Composite `destination-out`)
- Undo / Redo (35 Schritte; History wird beim Senden / Kategorie-Wechsel zurückgesetzt)
- Stiftgröße 1–30 Pixel
- Richtungsauswahl `Fährt: → / ←` — wird mit dem Bild gesendet als `facingDirection` und vom Display kombiniert mit der aktuellen Bewegungsrichtung gespiegelt
- Schablonen-Overlay pro Kategorie (helle Vorlage hinter dem Canvas, beim Senden wird nur das Zeichen-Layer übertragen)

