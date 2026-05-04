const socket = io();
let activeImages = [];
let currentDisplayedImageId = null;

const ratingButtons = Array.from(document.querySelectorAll('.rating-button[data-rating]'));
const paintingWindow = document.getElementById('paintingWindow');
const voteToast = document.getElementById('voteToast');

const TOAST_LABELS = {
  veryGood: 'Sehr gut! ⭐',
  good: 'Gut! 👍',
  bad: 'Schlecht 👎',
  veryBad: 'Sehr schlecht 💀'
};

let toastTimer = null;
function showToast(rating) {
  voteToast.textContent = TOAST_LABELS[rating] || 'Danke für deine Bewertung!';
  voteToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => voteToast.classList.remove('show'), 3000);
}

function setButtonsEnabled(enabled) {
  ratingButtons.forEach(btn => { btn.disabled = !enabled; });
}

function displayRandomPainting() {
  if (activeImages.length === 0) {
    paintingWindow.innerHTML = '<div class="loading">Keine Kunstwerke vorhanden</div>';
    currentDisplayedImageId = null;
    setButtonsEnabled(false);
    return;
  }

  // Avoid showing the exact same painting twice in a row when there's >1 to choose from.
  let candidates = activeImages;
  if (activeImages.length > 1 && currentDisplayedImageId) {
    candidates = activeImages.filter(img => img.id !== currentDisplayedImageId);
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  currentDisplayedImageId = pick.id;
  paintingWindow.innerHTML = `<img src="${pick.dataUrl}" alt="Kunstwerk">`;
  setButtonsEnabled(true);
}

socket.on('connect', () => {
  socket.emit('admin:requestGallery');
});

socket.on('admin:updateGallery', (images) => {
  activeImages = images;
  // Only re-pick if the currently shown painting was removed (e.g. fully disliked)
  // or if we don't have one yet. Avoids shuffling under the user's finger.
  if (!currentDisplayedImageId || !activeImages.find(img => img.id === currentDisplayedImageId)) {
    displayRandomPainting();
  }
});

socket.on('newImage', (imageData) => {
  if (!activeImages.find(img => img.id === imageData.id)) {
    activeImages.push(imageData);
  }
  if (!currentDisplayedImageId) {
    displayRandomPainting();
  }
});

socket.on('admin:removeImageFromMain', (imageId) => {
  activeImages = activeImages.filter(img => img.id !== imageId);
  if (currentDisplayedImageId === imageId) {
    displayRandomPainting();
  }
});

function rate(rating) {
  if (!currentDisplayedImageId) return;
  const id = currentDisplayedImageId;
  setButtonsEnabled(false);
  socket.timeout(5000).emit('kritiker:rateImage', { imageId: id, rating }, (err, res) => {
    if (err || !res || !res.ok) {
      console.warn('rate failed', err, res);
      setButtonsEnabled(true);
      return;
    }
    showToast(rating);
    displayRandomPainting();
  });
}

ratingButtons.forEach(btn => {
  btn.addEventListener('click', () => rate(btn.dataset.rating));
});
