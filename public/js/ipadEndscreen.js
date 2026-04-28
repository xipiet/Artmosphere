const socket = io();

const artworkNameInput = document.getElementById('artworkName');
const saveArtworkBtn = document.getElementById('saveArtwork');
const discardBtn = document.getElementById('discardArtwork');
const mainMessage = document.getElementById('mainMessage');
const artworkForm = document.getElementById('artworkForm');
const saveStatus = document.getElementById('saveStatus');

// sessionId is now passed via the URL — no localStorage races.
const params = new URLSearchParams(window.location.search);
const currentSessionId = params.get('sid');
let isSaved = false; // becomes true after a successful finalize, locks form

const ERROR_MESSAGES = {
    session_expired: 'Diese Zeichnung ist abgelaufen oder wurde nicht gefunden.',
    invalid_name: 'Bitte gib einen Namen mit 1–50 Zeichen ein.',
    save_failed: 'Speichern fehlgeschlagen. Bitte erneut versuchen.'
};

function setStatus(kind, html) {
    saveStatus.className = 'save-status visible ' + kind;
    saveStatus.innerHTML = html;
}

function clearStatus() {
    saveStatus.className = 'save-status';
    saveStatus.innerHTML = '';
}

function setSavingUI(saving) {
    saveArtworkBtn.disabled = saving || isSaved;
    if (discardBtn) discardBtn.disabled = saving || isSaved;
    artworkNameInput.disabled = saving || isSaved;
    saveArtworkBtn.textContent = isSaved
        ? 'Gespeichert'
        : (saving ? 'Wird gespeichert…' : 'Speichern');
}

document.addEventListener('DOMContentLoaded', () => {
    if (!currentSessionId) {
        mainMessage.textContent = 'Keine Zeichnung gefunden — gehe zurück zum iPad.';
        saveArtworkBtn.disabled = true;
        if (discardBtn) discardBtn.disabled = true;
        artworkNameInput.disabled = true;
        return;
    }
    artworkNameInput.focus();
});

function syncSaveEnabled() {
    if (isSaved) return;
    const name = (artworkNameInput.value || '').trim();
    saveArtworkBtn.disabled = !currentSessionId || name.length === 0 || name.length > 50;
}
artworkNameInput.addEventListener('input', () => {
    if (saveStatus.classList.contains('error')) clearStatus();
    syncSaveEnabled();
});
syncSaveEnabled();

saveArtworkBtn.addEventListener('click', () => {
    if (isSaved) return;
    const userName = (artworkNameInput.value || '').trim();
    if (!userName || !currentSessionId) return;

    setStatus('pending', 'Wird gespeichert…');
    setSavingUI(true);

    socket.timeout(10000).emit(
        'finalizeArtwork',
        { sessionId: currentSessionId, userName },
        (err, response) => {
            if (err) {
                setSavingUI(false);
                setStatus('error', ERROR_MESSAGES.save_failed + ' (Zeitüberschreitung)');
                return;
            }
            if (!response || !response.ok) {
                setSavingUI(false);
                const code = response && response.error;
                setStatus('error', ERROR_MESSAGES[code] || ('Fehler: ' + (code || 'unbekannt')));
                return;
            }

            // Success — lock form, show inline checkmark, stay on the page so
            // the visitor can read the QR code at their own pace.
            isSaved = true;
            setSavingUI(false);
            const note = response.hasScreenshot
                ? `Gespeichert als „${response.folder}"`
                : `Gespeichert als „${response.folder}" (ohne Hauptbild-Screenshot)`;
            setStatus('success', `<span class="check-icon" aria-hidden="true">✓</span><span>${note}</span>`);
        }
    );
});

if (discardBtn) {
    discardBtn.addEventListener('click', () => {
        if (isSaved) return;
        if (!currentSessionId) {
            window.location.href = '/ipad';
            return;
        }
        if (!confirm('Zeichnung verwerfen und nicht speichern?')) return;

        socket.timeout(5000).emit(
            'discardArtwork',
            { sessionId: currentSessionId },
            () => { window.location.href = '/ipad'; }
        );
    });
}
