# Artmosphere - Orakel

- Web-App mit /ipad, /ipad2 und /main <br/>

## Installation

- git clone <br/>
- cd Artmosphere <br/>
- Node & npm installieren (https://nodejs.org/en/download) <br/>
- npm install express socket.io<br/>
- node server.js <br/>

## Update

- ps aux | grep node <br/>
- kill "entsprechende PID" <br/>
- cd /Artmosphere <br/>
- git pull <br/>
- reboot <br/>

---

## Developer Guide

### Zwei iPad-Systeme: ipad.html vs. ipad2.html

**Artmosphere** verfügt über zwei unterschiedliche Zeichenmodi, die je nach Theme verwendet werden:

#### 1. **ipad.html** (Zonen-basiert) - klassisches System
- **Themes:** `ocean`, `jungle` (und andere zonenanbasierte Themes)
- **Funktionsweise:** Benutzer wählt eine von **3 vertikalen Zonen** auf dem Bildschirm
- **Bewegungslogik:** Bilder bounchen **frei innerhalb der gewählten Zone** (chaotische Bewegung)
- **Einsatz:** Für Szenarien mit Unterwasser, Dschungel, etc.

#### 2. **ipad2.html** (Kategorien-basiert) - neues System
- **Themes:** `stadt` (Stadtszene)
- **Funktionsweise:** Benutzer wählt eine **Kategorie** (Fußgänger 🚶, Auto 🚗, Flugzeug ✈️, Wasserverkehr 🚤)
- **Bewegungslogik:** Bilder bewegen sich **kategoriespezifisch**:
  - **✈️ Flugzeug:** oben (Luft), schnell, linear links-rechts
  - **🚤 Wasserverkehr:** unten (Wasser), normal schnell, linear links-rechts mit leichtem Schaukeln
  - **🚗 Auto:** unten (Straße), normal schnell, linear links-rechts
  - **🚶 Fußgänger:** unten (Gehweg), LANGSAM, linear links-rechts
- **Einsatz:** Für realistische, zielgerichtete Bewegungsmuster

### Workflow für Administratoren

1. **Im Admin Panel** (`/admin`):
   - Theme auswählen: z.B. `jungle` oder `stadt`
   - Painting-Einstellungen (Layer Distribution, Gallery Mode, Max Paintings)

2. **Auf dem iPad** (je nach Theme):
   - **Jungle/Ocean Theme:** Verwende `/ipad` → wähle Zone → zeichne
   - **Stadt Theme:** Verwende `/ipad2` → wähle Kategorie → zeichne

3. **Main Display** (`/main`):
   - Zeigt alle Malereien mit korrekter Bewegungslogik basierend auf System (Zone vs. Kategorie)

### Datenfluss im Backend

- **server.js:** Socket-Handler für `sendImage` akzeptiert beide Formate:
  - `{ dataUrl, zoneId }` für ipad.html
  - `{ dataUrl, movementType }` für ipad2.html

- **main.js:** `FloatingImage` Klasse erkennt den Typ und wendet passende Bewegungslogik an

### Theme-Struktur in config.json

```json
{
  "activeTheme": "jungle",
  "themes": {
    "jungle": {
      "image": "jungle.png",
      "zones": [
        { "id": "top", "yStartPct": 0, "yEndPct": 40 },
        { "id": "middle", "yStartPct": 40, "yEndPct": 70 },
        { "id": "bottom", "yStartPct": 70, "yEndPct": 100 }
      ]
    },
    "stadt": {
      "image": "stadt.png",
      "zones": [...]  // default zones für ipad.html Support
    }
  }
}
```

### Neue Themes/Kategorien hinzufügen

**Für Zone-basierte Themes (ipad.html):**
- Theme zu config.json hinzufügen mit entsprechenden Zones
- Image in `/public/themes/` ablegen

**Für Kategorien-basierte Themes (ipad2.html):**
- `movementType` in main.js `FloatingImage` Klasse hinzufügen
- Bewegungslogik in `initializeMovement()` und `update()` definieren
