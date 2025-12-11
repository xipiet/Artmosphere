const startBtn = document.getElementById("start-btn");
const startScreen = document.getElementById("start-screen");
const secondScreen = document.getElementById("second-screen");
const closeBox = document.getElementById("close-box");
const overlayBox = document.getElementById("overlay-box");

startBtn.addEventListener("click", () => {
    startScreen.classList.remove("active");
    secondScreen.classList.add("active");
    document.body.classList.add("white-bg");
});

closeBox.addEventListener("click", () => {
    overlayBox.style.display = "none";
});