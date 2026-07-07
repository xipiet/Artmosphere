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

## Update

- ps aux | grep node <br/>
- kill "entsprechende PID" <br/>
- cd /Artmosphere <br/>
- git pull <br/>
- reboot <br/>
