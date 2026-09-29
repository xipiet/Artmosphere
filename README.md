# Artmosphere - Orakel

Artmosphere ist eine interaktive Kunst-Installation, bei der aus vielen einzelnen Beiträgen ein gemeinsames, lebendiges Gesamtkunstwerk entsteht. Besucher malen auf einem iPad ihr eigenes Werk, das sich danach in eine große, animierte Leinwand einfügt und dort Teil einer ständig wachsenden Szene wird. Die Werke können bewertet werden – und am Ende nimmt jeder sein eigenes Kunstwerk als Erinnerung mit nach Hause.

## Was kann Artmosphere?

- **Malen & Senden:** Auf dem iPad zeichnen (Stift, Füllen, Radierer, Undo/Redo), Kategorie wählen, Fahrtrichtung festlegen und abschicken.
- **Lebendige Leinwand:** Jedes Bild bewegt sich je nach Kategorie unterschiedlich durch die Szene. Ältere Bilder wandern nach hinten, neue nach vorne.
- **Bewerten:** Der Kritiker gibt jedem Werk gute oder schlechte Stimmen. Daraus entsteht eine Bilanz.
- **Scoreboard:** Zeigt die beliebtesten (Top) und unbeliebtesten (Flop) Werke. Es tauchen nur Bilder auf, die schon mindestens einmal bewertet wurden.
- **Themes:** Über das Admin-Panel lässt sich das Motiv der Szene (z. B. Stadt) umschalten – die iPad-Kategorien passen sich automatisch an.
- **Kinder-Modus:** Eine geführte Anleitung fürs Malen für jüngere Besucher.
- **Speichern:** Beim Speichern wird automatisch ein Screenshot der Leinwand angelegt – der Anzeige-PC muss dafür nicht offen sein.
- **Eigenes Werk mitnehmen:** Jedes gespeicherte Werk landet in der eigenen Cloud – in einem Ordner mit dem Namen, den man sich gegeben hat. Darin liegt sowohl das eigene Kunstwerk als auch das Gesamtkunstwerk der Leinwand in genau diesem Moment. Unter [artmosphere.cc](https://artmosphere.cc) findet man seinen Ordner wieder und kann beides direkt herunterladen.

## Seiten

Die Startseite unter `http://<server>:3000` verlinkt einfach zu allen Seiten:

- **`/main`** – Die große Leinwand / Projektion. Zeigt alle Bilder animiert in der Szene.
- **`/ipad`** – Das Zeichen-Tablet für Besucher: Kategorie wählen, malen, senden, Name eingeben. (Für Kinder gibt es zusätzlich `/ipad-kids` mit geführter Anleitung.)
- **`/kritiker`** – Bewertungs-Ansicht: Werke gut oder schlecht bewerten.
- **`/scoreboard`** – Rangliste der Werke nach Bewertung (Top & Flop).
- **`/admin`** – Steuerung: Theme auswählen und Galerie-Einstellungen anpassen.

## Installation

- git clone <br/>
- cd Artmosphere <br/>
- Node & npm installieren (https://nodejs.org/en/download) <br/>
- npm install express socket.io puppeteer <br/>
- node server.js <br/>

Der Server läuft danach auf Port 3000 (bzw. `PORT`).

**Speicherort der Kunstwerke:** Standardmäßig unter `~/.local/share/artmosphere/saved/` (XDG-Standard, kein sudo nötig). Jedes Werk landet in einem eigenen Ordner mit Zeichnung, Screenshot der Leinwand und einer `metadata.json`. Anderer Pfad per Umgebungsvariable: `ARTMOSPHERE_SAVE_PATH=/eigener/pfad node server.js`.

### Nextcloud-Sync (optional)

Ein systemd-Timer kopiert den Speicherort jede Minute per rclone in einen Nextcloud-Ordner, aus dem Besucher ihr Werk herunterladen. Es wird nur hochgeladen, nie gelöscht. `metadata.json` bleibt lokal.

**1. Nextcloud:** Im selben Netz installieren, Benutzer `artmosphere` anlegen, als dieser einen Ordner `Artmosphere` erstellen und einen öffentlichen Link dafür erzeugen (= Download-Seite für Besucher).

**2. rclone** (als root, wie der Server). `<NEXTCLOUD-IP>` und `<PASSWORT>` des Benutzers `artmosphere` einsetzen:

```bash
apt install rclone
rclone config create nextcloud webdav url http://<NEXTCLOUD-IP>/remote.php/dav/files/artmosphere/ vendor nextcloud user artmosphere pass '<PASSWORT>' --obscure
rclone lsd nextcloud:   # muss den Ordner Artmosphere zeigen
```

**3. Service + Timer** anlegen und starten:

```bash
cat > /etc/systemd/system/artmosphere-sync.service <<'EOF'
[Unit]
Description=Sync Artmosphere saved artworks to Nextcloud
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStartPre=/bin/mkdir -p /root/.local/share/artmosphere/saved
ExecStart=/usr/bin/rclone copy /root/.local/share/artmosphere/saved nextcloud:Artmosphere --config /root/.config/rclone/rclone.conf --exclude metadata.json*
EOF

cat > /etc/systemd/system/artmosphere-sync.timer <<'EOF'
[Unit]
Description=Run Artmosphere sync every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=60
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now artmosphere-sync.timer
```

Logs: `journalctl -u artmosphere-sync`

- Der Pfad im Service muss dem Speicherort entsprechen. Läuft der Server nicht als root oder mit `ARTMOSPHERE_SAVE_PATH`, anpassen.
- Werke immer auf dem Server löschen (`rm -rf ~/.local/share/artmosphere/saved/*`). Nur in der Nextcloud gelöscht, werden sie beim nächsten Lauf wieder hochgeladen.

**Optional:** `artmosphere.cc` per 308 auf den öffentlichen Ordner leiten.

## Update

- ps aux | grep node <br/>
- kill "entsprechende PID" <br/>
- cd /Artmosphere <br/>
- git pull <br/>
- reboot <br/>
