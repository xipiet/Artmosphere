# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

There is no build step, linter, or test suite. The only commands are:

```bash
npm install            # installs express + socket.io
node server.js         # starts the server on PORT (default 3000)
```

In production the app runs as a long-lived `node server.js` process. To deploy a change: `ps aux | grep node` → `kill <PID>` → `git pull` → restart (see README.md).

## Routes

- `/` → `index.html` (landing)
- `/main` → display canvas (`main.html` + `main.js`) — drives the projected/visualized output
- `/ipad` → drawing tablet, category-based input (`ipad.html` + `ipad.js`)
- `/ipad-kids` → implements optional guided tutorial mode using the iPad interface (`ipad-kids.html` + `ipad-kids.js`)
- `/ipad-endscreen` → name-entry screen after sending a drawing
- `/admin` → operator panel for theme + gallery settings
- `/theme-image/:filename` → serves theme background images from `public/themes/`

## Architecture

### Single-process Socket.io hub

`server.js` is the only backend file. It owns three pieces of state in memory:

- `serverConfig` — themes, persisted to `public/themes/config.json` (this file is **gitignored**)
- `serverSettings` — gallery/layer/opacity tunables, persisted to `settings.json` (committed; defaults are duplicated inside `server.js` and several frontend files — keep them in sync)
- `activeImages[]` — current paintings shown on `/main`, plus `sessionStorage` (a `Map`) for in-flight artwork sessions

All clients (iPad, main display, admin) join the same default Socket.io room. The server fans out events with `io.emit(...)`; per-socket replies use `socket.emit(...)`.

### Category-driven iPad input

A single iPad UI at `/ipad`. Visitor picks a **category** and the iPad emits `sendImage` with `{ dataUrl, movementType, facingDirection }`, where `movementType` is the category's `id` from the active theme.

Categories are **per-theme**, defined in `public/themes/config.json` under `themes.<name>.categories[]`. Schema:

```json
{ "id": "watercraft", "icon": "🚤", "label": "Wasserverkehr",
  "style": "watercraft",
  "yMinPct": 72, "yMaxPct": 90, "speedMin": 0.16, "speedMax": 0.26,
  "template": "/media/drawing-template-watercraft.svg", "templateSize": "50% auto" }
```

- `id` is the `movementType` value sent over the socket
- `style` selects the rendering/physics flavor in `FloatingImage`. Defined styles: `pedestrian` (linear), `car` (lane drift + bumps + shadow ellipse), `airplane` (banking + altitude oscillation + contrail), `watercraft` (wave bob + drift + wake trails), `plain` (static fallback). Adding a new style requires editing `FloatingImage.initializeMovement()` / `update()` / `draw()`. Reusing an existing style across themes does NOT.
- `yMinPct`/`yMaxPct` define the vertical band; `speedMin`/`speedMax` the base horizontal speed range; both are read from config so new themes can reposition the same physics
- `template`/`templateSize` set a CSS-variable–driven SVG underlay on the drawing canvas (hint silhouette for visitors)

`facingDirection` (`'right'` | `'left'`) is the visitor's chosen heading. The display flips both image and motion: `drawDirectionalImage` multiplies `vx`'s sign with the user's facing — i.e. an image facing left + moving left renders un-flipped (image author drew it for that orientation), facing right + moving left flips it, etc. `rotation` (banking/roll for animated styles) is also flipped to match.

`ipad.js` generates the selection cards dynamically from `theme.categories` on `app:init` / `config:changed`. The drawing tools (Stift / Füllen / Radierer with Undo/Redo, max 35 steps) live in `public/js/ipad.js`. Eraser uses canvas `globalCompositeOperation = 'destination-out'` so the canvas stays transparent (important — `main.js` composites paintings over the theme background).

### Artwork session lifecycle (lazy save, headless screenshot)

The wall-PC is purely a projector — its browser state never affects save reliability. Screenshots come from a **headless Chromium** managed by `lib/mainRenderer.js`, booted at server startup with one persistent `/main` page that stays in sync with the live wall via the same socket.io traffic.

Steps:

1. iPad emits `sendImage` with `{ dataUrl, movementType, facingDirection }` and an **ack callback**. Server creates a `sessionId`, stores the drawing dataUrl + metadata in the in-memory `sessionStorage` Map (with a 10-min TTL), and acks `{ ok, sessionId }`. **Nothing is written to disk yet.**
2. Server broadcasts `newImage`. Both the wall-PC's `/main` page AND the headless `/main` page receive it and animate the new image into the scene.
3. iPad redirects to `/ipad-endscreen?sid=<sessionId>` (URL param). Visitor types a name and clicks **Speichern** (→ `finalizeArtwork` ack) or clicks **Verwerfen** (→ `discardArtwork` ack).
4. On `finalizeArtwork`: server validates the name (1–50 chars), then calls `mainRenderer.captureMainScreenshot()` which `await`s `page.screenshot()` on the headless `/main` page (~100–300 ms). It writes `drawing.png` + `main_canvas.png` + `metadata.json` into `<sanitizedName>_<isoDate>[_n]/` under `SAVE_PATH`, deletes the session, replies `{ ok, folder, hasScreenshot }`.
5. On `discardArtwork` or 10-min TTL expiry: in-memory session is dropped, no files written.

The headless screenshot won't be pixel-identical to the wall (different `Math.random()` spawn positions per browser), but it **is** functionally identical: same theme background, same active drawings, same trails/animations, same layer alphas — exactly what an F5 on the wall-PC would show.

**`lib/mainRenderer.js`** owns one Chromium browser + one page bound to `http://127.0.0.1:<PORT>/main`. `ensureReady(url)` is idempotent — first call boots, subsequent calls return the running page. `captureMainScreenshot(url, { settleMs })` does an `await page.screenshot({ type: 'png' })`. On any failure (page died, browser crashed) the handle is dropped and the next call rebuilds. Server's `SIGINT`/`SIGTERM` handlers call `mainRenderer.shutdown()` so Chromium doesn't leak.

**`SAVE_PATH` resolution order** (in `server.js`):
1. `process.env.ARTMOSPHERE_SAVE_PATH` (explicit override, e.g. `/var/lib/artmosphere/saved` in production)
2. `$XDG_DATA_HOME/artmosphere/saved`
3. `~/.local/share/artmosphere/saved` (XDG default — works without sudo on dev machines)

**`maxHttpBufferSize`** is set to 5 MB on the Socket.io server to accommodate large dataUrls. iPad and endscreen use `socket.timeout(...).emit(event, payload, callback)` for ack-based requests so the UX always has an explicit success/error path.

**Container note:** Puppeteer's bundled Chromium needs `libnss3 libxss1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libxkbcommon0 libpango-1.0-0 libgtk-3-0` (or similar — error messages are explicit on missing libs). On most Linux distros these come with a desktop install; in a slim Docker container they need to be apt-installed.

### Display layer system

`main.js` distributes active images across three z-layers (foreground/midground/background) by recency — newest images are foreground. Per-layer counts and opacity ranges are configured by the admin and live in `settings.json` (`foregroundPaintings`, `foregroundOpacityMin/Max`, etc.). `redistributeLayers()` runs every frame.

Gallery modes (`serverSettings.galleryMode`):
- `'maxPaintings'` — cap at `maxImages`; oldest is removed via `image:startFade` (animated) or `admin:removeImageFromMain` (instant) depending on `maxImagesMode`.
- `'fade'` — every image continuously fades; clients emit `image:faded` when `fadeAlpha` hits 0 so the server can drop them from `activeImages`.

### Config vs Settings (don't conflate them)

- `public/themes/config.json` — themes & their zones, **gitignored**, written by admin via `admin:updateConfig` / `saveConfig` events.
- `settings.json` — gallery/painting/opacity knobs, **committed**, written by admin via `admin:updateSettings`.

Both are loaded once at server start and pushed to clients via the combined `app:init` event.
