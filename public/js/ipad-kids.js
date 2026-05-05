const overlayElem = document.getElementById("kids-tutorial-overlay");
const mascotElem = document.getElementById("kids-tutorial-mascot");
const kidsTextElem = document.getElementById("kids-tutorial-text");
const continueBtn = document.getElementById("kids-tutorial-continue-btn");

// NEXT TODOs
// - Button aus Dialog Bubble ab Step 2 weg, dafür X zum Tutorial abbrechen
// - Position der Dialog Bubble an Highlight anpassen

function getMascot() {
  const theme = activeThemeName;

  if (theme === "ocean") {
    return { name: "Finn", image: "/media/shark-mascot-1.png"};
  } else if (theme === "jungle") {
    return { name: "Momo", image: "/media/monkey-mascot.png"};
  } else if (theme === "stadt") {
    return { name: "Blabla", image: "/media/monkey-mascot.png"};
  }
}
const mascotInfo = getMascot();

const kidsTutorial = {
  currentKey: "intro",
  steps: {
    intro: {
      text: `Hey, ich bin ${mascotInfo.name}.<br>Lass uns etwas zeichnen!`,
      mascot: mascotInfo.image,
      next: () => isDrawViewActive() ? "draw" : "category"
    },
    category: {
      text: "Wir wählen zuerst eine Kategorie aus, welche wir zeichnen wollen.",
      mascot: mascotInfo.image,
      highlight: "#cardsContainer",
      continuesOnClick: true,
      next: () => "draw"
    },
    draw: {
      text: "Jetzt wird gezeichnet! 🎨",
      mascot: mascotInfo.image,
      next: () => null
    }
  }
};

function isDrawViewActive() {
  const drawView = document.getElementById("drawView");
  return drawView && drawView.style.display === "flex";
}

function showCurrentStep() {
  const step = kidsTutorial.steps[kidsTutorial.currentKey];
  if (!step) return;

  kidsTextElem.innerHTML = step.text;
  setMascot(step.mascot);

  clearHighlight();
  if (step.highlight) {
    highlightElement(step.highlight, step.continuesOnClick);
    overlayElem.classList.remove("has-background");
  } else {
    overlayElem.classList.add("has-background");
  }

  showOverlay();
}

continueBtn.addEventListener("click", () => {
  const step = kidsTutorial.steps[kidsTutorial.currentKey];
  const nextKey = step.next();
  if (!nextKey) {
    endTutorial();
  } else {
    kidsTutorial.currentKey = nextKey;
    showCurrentStep();
  }
});

function setMascot(src) {
  if (!src) {
    mascotElem.classList.add("hidden");
    return;
  }
  mascotElem.src = src;
  mascotElem.classList.remove("hidden");
}

let currentHighlightElem = null;
let currentHoleElem = null;
let highlightClickHandler = null;
let originalStyles = null;

function highlightElement(selector, continuesOnClick = false) {
  const elem = document.querySelector(selector);
  if (!elem) {
    console.warn("Could not find element to highlight:", selector);
    return;
  }
  
  // Originale Styles zwischenspeichern
  originalStyles = {
    position: elem.style.position,
    top: elem.style.top,
    left: elem.style.left,
    width: elem.style.width,
    height: elem.style.height,
    pointerEvents: elem.style.pointerEvents
  };
  
  const rect = elem.getBoundingClientRect();
  
  elem.classList.add("kids-tutorial-highlight");
  elem.style.position = "fixed";
  elem.style.top = rect.top + "px";
  elem.style.left = rect.left + "px";
  elem.style.width = rect.width + "px";
  elem.style.height = rect.height + "px";
  elem.style.pointerEvents = "auto";
  
  if (continuesOnClick) {
    highlightClickHandler = () => {
      clearHighlight();
      hideOverlay();
      const step = kidsTutorial.steps[kidsTutorial.currentKey];
      const nextKey = step.next ? step.next() : null;
      kidsTutorial.currentKey = nextKey || "draw";
      if (nextKey) {
        showCurrentStep();
      } else {
        endTutorial();
      }
    };
  } else {
    highlightClickHandler = () => {
      endTutorial();
    };
  }
  elem.addEventListener("click", highlightClickHandler);
  
  const hole = document.createElement("div");
  hole.className = "kids-tutorial-hole";
  hole.style.top = (rect.top - 4) + "px";
  hole.style.left = (rect.left - 4) + "px";
  hole.style.width = (rect.width + 8) + "px";
  hole.style.height = (rect.height + 8) + "px";
  document.body.appendChild(hole);
  
  currentHighlightElem = elem;
  currentHoleElem = hole;
}

function clearHighlight() {
  if (currentHighlightElem) {
    if (highlightClickHandler) {
      currentHighlightElem.removeEventListener("click", highlightClickHandler);
      highlightClickHandler = null;
    }
    currentHighlightElem.classList.remove("kids-tutorial-highlight");
    
    // auf originale Styles zurücksetzen
    if (originalStyles) {
      currentHighlightElem.style.position = originalStyles.position || "";
      currentHighlightElem.style.top = originalStyles.top || "";
      currentHighlightElem.style.left = originalStyles.left || "";
      currentHighlightElem.style.width = originalStyles.width || "";
      currentHighlightElem.style.height = originalStyles.height || "";
      currentHighlightElem.style.pointerEvents = originalStyles.pointerEvents || "";
    }
    
    currentHighlightElem = null;
    originalStyles = null;
  }
  if (currentHoleElem) {
    currentHoleElem.remove();
    currentHoleElem = null;
  }
}

function showOverlay() {
  overlayElem.classList.add("active");
}

function hideOverlay() {
  overlayElem.classList.remove("active");
}

function clearTutorialUI() {
  clearHighlight();
  hideOverlay();
}

function endTutorial() {
  clearTutorialUI();
  socket.emit("kidsMode:set", false);
}

window.endTutorial = endTutorial;

if (window.kidsMode) {
  showCurrentStep();
}