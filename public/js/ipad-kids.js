const overlayElem = document.getElementById("kids-tutorial-overlay");
const mascotElem = document.getElementById("kids-tutorial-mascot");
const kidsTextElem = document.getElementById("kids-tutorial-text");
const continueBtn = document.getElementById("kids-tutorial-continue-btn");

// NEXT TODOs:
// - Unterscheidung welche Steps auf Zone View und welche auf Draw View angezeigt werden sollen
// - Maskottchen entsprechend Theme anpassen

const kidsTutorial = {
  step: 0,
  steps: [
    {
      text: "Hey, ich bin Momo. <br>Lass uns etwas zeichnen!",
      mascot: "/media/monkey-mascot.png"
    },
    {
      text: "Super! Wähle jetzt einen Bereich.",
      mascot: "/media/monkey-mascot.png",
      highlight: ".zone-0",
      continuesOnClick: true
    },
    {
      text: "Jetzt wird gezeichnet! 🎨",
      mascot: "/media/monkey-mascot.png"
    }
  ]
};

function showCurrentStep() {
  const step = kidsTutorial.steps[kidsTutorial.step];
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
  kidsTutorial.step++;
  if (kidsTutorial.step >= kidsTutorial.steps.length) {
    endTutorial();
  } else {
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
      kidsTutorial.step++;
      if (kidsTutorial.step < kidsTutorial.steps.length) {
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
  hole.style.height = (rect.height + 4) + "px";
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

function endTutorial() {
  clearHighlight();
  hideOverlay();
  socket.emit("kidsMode:set", false);
}

showCurrentStep();