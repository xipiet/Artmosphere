const topList = document.getElementById('topList');
const bottomList = document.getElementById('bottomList');
const totalCount = document.getElementById('totalCount');

function scoreClass(score) {
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

function formatScore(score) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderList(listEl, entries, startPos) {
  if (!entries.length) {
    listEl.innerHTML = '<li class="empty">Noch keine Werke bewertet</li>';
    return;
  }
  listEl.innerHTML = entries.map((entry, i) => `
    <li class="rank-item">
      <div class="rank-position">${startPos + i}</div>
      <div class="rank-thumb"><img src="${entry.thumb}" alt="" loading="lazy"></div>
      <div class="rank-info">
        <div class="rank-name">${escapeHtml(entry.name)}</div>
        <div class="rank-date">${formatDate(entry.timestamp)}</div>
      </div>
      <div class="rank-score ${scoreClass(entry.score)}">${formatScore(entry.score)}</div>
    </li>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function fetchScoreboard() {
  try {
    const res = await fetch('/api/scoreboard?limit=10', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderList(topList, data.top, 1);
    renderList(bottomList, data.bottom, 1);
    totalCount.textContent = data.total;
  } catch (err) {
    console.error('scoreboard fetch failed', err);
  }
}

// Debounced refetch so a flurry of votes only triggers one network round-trip.
let refetchTimer = null;
function scheduleRefetch() {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(fetchScoreboard, 1000);
}

fetchScoreboard();

const socket = io();
socket.on('image:voteUpdate', scheduleRefetch);
// New drawings won't change ranks, but their score=0 entry appears in "total".
socket.on('newImage', scheduleRefetch);
// A work just got saved → its name changed from "Anonym" to the entered name.
socket.on('image:saved', scheduleRefetch);
