const socket = io();
let activeImages = [];
let currentDisplayedImageId = null;

socket.on('connect', () => {
  console.log('Connected to server');
  // Request current gallery
  socket.emit('admin:requestGallery');
});

socket.on('admin:updateGallery', (images) => {
  activeImages = images;
  displayRandomPainting();
});

socket.on('newImage', (imageData) => {
  activeImages.push(imageData);
  displayRandomPainting();
});

socket.on('admin:removeImageFromMain', (imageId) => {
  activeImages = activeImages.filter(img => img.id !== imageId);
  displayRandomPainting();
});

function displayRandomPainting() {
  const paintingWindow = document.getElementById('paintingWindow');
  
  if (activeImages.length === 0) {
    paintingWindow.innerHTML = '<div class="loading">Keine Kunstwerke vorhanden</div>';
    currentDisplayedImageId = null;
    return;
  }

  const randomIndex = Math.floor(Math.random() * activeImages.length);
  const randomPainting = activeImages[randomIndex];
  currentDisplayedImageId = randomPainting.id;

  paintingWindow.innerHTML = `
    <img src="${randomPainting.dataUrl}" alt="Kunstwerk">
  `;
}

document.getElementById('likeBtn').addEventListener('click', () => {
  if (currentDisplayedImageId) {
    socket.emit('kritiker:rateImage', {
      imageId: currentDisplayedImageId,
      rating: 'like'
    });
    displayRandomPainting();
  }
});

document.getElementById('dislikeBtn').addEventListener('click', () => {
  if (currentDisplayedImageId) {
    socket.emit('kritiker:rateImage', {
      imageId: currentDisplayedImageId,
      rating: 'dislike'
    });
    displayRandomPainting();
  }
});
