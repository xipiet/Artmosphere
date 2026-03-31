const overlayElem = document.getElementById("kids-tutorial-overlay");
const mascotElem = document.getElementById("kids-tutorial-mascot");
const kidsTextElem = document.getElementById("kids-tutorial-text");
const continueBtn = document.getElementById("kids-tutorial-continue-btn");

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
      highlight: ".zone-overlay"
    },
    // {
    //   text: "Jetzt kannst du malen 🎨",
    //   highlight: "#drawArea"
    // },
    // {
    //   text: "Wenn du fertig bist, drück auf Senden!",
    //   highlight: "#send"
    // }
  ]
};

function showCurrentStep() {
  const step = kidsTutorial.steps[kidsTutorial.step];
  console.log("Showing tutorial step:", step);                           // DEBUG
  if (!step) return;

  kidsTextElem.innerHTML = step.text;

  setMascot(step.mascot);

  clearHighlight();
  if (step.highlight) {
    highlightElement(step.highlight);
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

function highlightElement(selector) {
    const elem = document.querySelector(selector);
    if (!elem) return;

    elem.classList.add("kids-tutorial-highlight");
    currentHighlightElem = elem;
}

function clearHighlight() {
    if (currentHighlightElem) {
        currentHighlightElem.classList.remove("kids-tutorial-highlight");
        currentHighlightElem = null;
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