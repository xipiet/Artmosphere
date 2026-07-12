const overlayElem = document.getElementById("kids-tutorial-overlay");
const mascotElem = document.getElementById("kids-tutorial-mascot");
const kidsTextElem = document.getElementById("kids-tutorial-text");
const continueBtn = document.getElementById("kids-tutorial-continue-btn");

let currentHighlightElem = null;
let currentHoleElem = null;
let highlightClickHandler = null;
let originalStyles = null;

function getMascot() {
  const theme = activeThemeName;

  if (theme === "unterwasser") {
    return { name: "Arti", image: "/media/mascot-arti-ocean.png"};
  } else if (theme === "weltall") {
    return { name: "Arti", image: "/media/mascot-arti-astronaut.png"};
  }
  return { name: "Arti", image: "/media/universal-mascot-arti-color-only.png"};
}

const mascotInfo = getMascot();

const kidsTutorial = {
  currentKey: "intro",
  steps: {
    intro: {
      text: `Hey, ich bin ${mascotInfo.name}.<br>Lass uns etwas zeichnen!`,
      mascot: mascotInfo.image,
      next: () => isDrawViewActive() ? "drawView" : "categoryView",
      showContinueBtn: true
    },
    categoryView: {
      text: "Wähle zuerst eine Kategorie aus, welche du zeichnen möchtest.",
      mascot: mascotInfo.image,
      highlight: "#cardsContainer",
      continuesOnClick: true,
      next: () => "drawView",
      showContinueBtn: false
    },
    drawView: {
      text: "Jetzt wird gezeichnet! 🎨",
      mascot: mascotInfo.image,
      next: () => "colors",
      showContinueBtn: true
    },
    colors: {
      text: "Such dir eine Farbe aus.",
      mascot: mascotInfo.image,
      highlight: "#colors",
      next: () => "strokeSlider",
      showContinueBtn: true
    },
    strokeSlider: {
      text: "Hier kannst du den Stift dicker oder dünner machen.",
      mascot: mascotInfo.image,
      highlight: "#stroke-slider",
      next: () => "toolPicker",
      showContinueBtn: true
    },
    toolPicker: {
      text: "Wähle hier ein Werkzeug aus...",
      mascot: mascotInfo.image,
      highlight: "#toolPicker",
      next: () => "pencil",
      showContinueBtn: true
    },
    pencil: {
      text: "Mit dem Stift zeichnest du Linien.",
      mascot: mascotInfo.image,
      highlight: "#drawTool",
      next: () => "fillTool",
      showContinueBtn: true
    },
    fillTool: {
      text: "Mit dem Farbeimer füllst du Flächen.",
      mascot: mascotInfo.image,
      highlight: "#fillTool",
      next: () => "eraser",
      showContinueBtn: true
    },
    eraser: {
      text: "Mit dem Radierer kannst du Fehler korrigieren.",
      mascot: mascotInfo.image,
      highlight: "#erase",
      next: () => "undoRedo",
      showContinueBtn: true
    },
    undoRedo: {
      text: "Hast du dich vertan? Kein Problem!<br><br>Einfach hier rückgängig machen oder wiederherstellen.",
      mascot: mascotInfo.image,
      highlight: "#historyControls",
      next: () => "directionPicker",
      showContinueBtn: true
    },
    directionPicker: {
      text: "Deine Zeichnung wird sich bewegen.<br>Hier kannst du die Richtung der Bewegung ändern.",
      mascot: mascotInfo.image,
      highlight: "#directionPicker",
      next: () => "backToCategory",
      showContinueBtn: true
    },
    backToCategory: {
      text: "Du wolltest eigentlich eine andere Kategorie? Hier geht's zurück!",
      mascot: mascotInfo.image,
      highlight: "#back",
      next: () => "clearDrawing",
      showContinueBtn: true
    },
    clearDrawing: {
      text: "Hier kannst du deine gesamte Zeichnung löschen und von vorne anfangen.",
      mascot: mascotInfo.image,
      highlight: "#clear",
      next: () => "send",
      showContinueBtn: true
    },
    send: {
      text: "Bist du fertig? Dann kannst du hier deine Zeichnung abschicken und sie wird lebendig!",
      mascot: mascotInfo.image,
      highlight: "#send",
      next: () => "drawArea",
      showContinueBtn: true
    },
    drawArea: {
      text: "Und nun leg los!<br>Du kannst die gezeigte Vorlage zur Hilfe nutzen, oder einfach malen wie du möchtest.",
      mascot: mascotInfo.image,
      next: () => null,
      showContinueBtn: true
    },    
  }
}

function isDrawViewActive() {
  const drawView = document.getElementById("drawView");
  return drawView && drawView.style.display === "flex";
}

function setMascot(src) {
  if (!src) {
    mascotElem.classList.add("hidden");
    return;
  }
  mascotElem.src = src;
  mascotElem.classList.remove("hidden");
}

function showCurrentStep() {
  const step = kidsTutorial.steps[kidsTutorial.currentKey];
  if (!step) return;

  kidsTextElem.innerHTML = step.text;
  setMascot(step.mascot);

  if (step.showContinueBtn === false) {
    continueBtn.classList.add("hidden");
  } else {
    continueBtn.classList.remove("hidden");
  }

  clearHighlight();
  if (step.highlight) {
    highlightElement(step.highlight, step.continuesOnClick);
    overlayElem.classList.remove("has-background");
  } else {
    centerDialog();
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

document.getElementById("kids-tutorial-close-btn").addEventListener("click", () => {
  endTutorial();
});

function showOverlay() {
  overlayElem.classList.add("active");
  if (currentHighlightElem) {
    const rect = currentHighlightElem.getBoundingClientRect();
    positionDialogBelowHighlight(rect);
  }
}

function hideOverlay() {
  overlayElem.classList.remove("active");
}

function positionDialogBelowHighlight(highlightRect) {
  const dialog = document.getElementById("kids-tutorial-dialog");
  const mascot = document.getElementById("kids-tutorial-mascot");
  if (!dialog) return;

  const dialogRect = dialog.getBoundingClientRect();
  const mascotRect = mascot ? mascot.getBoundingClientRect() : { width: 0 };

  const mascotWidth = mascotRect.width || 128;
  const gap = 20;
  const offsetForBubble = mascotWidth + gap + 2;

  const bubbleLeft = highlightRect.left;
  let dialogLeft = bubbleLeft - offsetForBubble;

  const maxRight = window.innerWidth - dialogRect.width - 20;
  dialogLeft = Math.min(dialogLeft, maxRight);
  dialogLeft = Math.max(20, dialogLeft);

  const spaceBelow = window.innerHeight - highlightRect.bottom;
  const spaceAbove = highlightRect.top;

  let top;
  if (spaceBelow > dialogRect.height + 20) {
    top = highlightRect.bottom + 12;
  } else if (spaceAbove > dialogRect.height + 20) {
    top = highlightRect.top - dialogRect.height - 12;
  } else {
    top = highlightRect.bottom + 12;
  }

  dialog.style.left = dialogLeft + "px";
  dialog.style.top = top + "px";
  dialog.style.transform = "none";
}

function centerDialog() {
  const dialog = document.getElementById("kids-tutorial-dialog");
  if (!dialog) return;

  dialog.style.left = "50%";
  dialog.style.top = "50%";
  dialog.style.transform = "translate(-50%, -50%)";
}

function highlightElement(selector, continuesOnClick = false) {
  const elem = document.querySelector(selector);
  if (!elem) {
    console.warn("Could not find element to highlight:", selector);
    return;
  }

  const rect = elem.getBoundingClientRect();
  const computed = window.getComputedStyle(elem);

  // Create a placeholder to maintain the layout flow while the original element
  // is temporarily set to position:fixed for the highlight effect.
  const placeholder = document.createElement("div");
  placeholder.style.width = rect.width + "px";
  placeholder.style.height = rect.height + "px";
  placeholder.style.margin = computed.margin;
  placeholder.style.flex = computed.flex;
  placeholder.style.display = (computed.display === "inline") ? "inline-block" : computed.display;
  placeholder.style.visibility = "hidden";
  placeholder.style.pointerEvents = "none";

  originalStyles = {
    position: elem.style.position,
    top: elem.style.top,
    left: elem.style.left,
    width: elem.style.width,
    height: elem.style.height,
    pointerEvents: elem.style.pointerEvents,
    placeholder: placeholder,
    parent: elem.parentNode,
    nextSibling: elem.nextSibling
  };

  // Move the element to document.body to "escape" parent constraints 
  // like 'backdrop-filter' or 'overflow: hidden' which break 'position: fixed' coordinates.
  elem.parentNode.insertBefore(placeholder, elem);
  document.body.appendChild(elem);

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
      kidsTutorial.currentKey = nextKey || "drawArea";
      if (nextKey) {
        showCurrentStep();
      } else {
        endTutorial();
      }
    };
  }
  if (highlightClickHandler) {
    elem.addEventListener("click", highlightClickHandler);
  }

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

    if (originalStyles) {
      // Move the element back to its original place in the DOM
      if (originalStyles.parent) {
        originalStyles.parent.insertBefore(currentHighlightElem, originalStyles.nextSibling);
      }

      currentHighlightElem.style.position = originalStyles.position || "";
      currentHighlightElem.style.top = originalStyles.top || "";
      currentHighlightElem.style.left = originalStyles.left || "";
      currentHighlightElem.style.width = originalStyles.width || "";
      currentHighlightElem.style.height = originalStyles.height || "";
      currentHighlightElem.style.pointerEvents = originalStyles.pointerEvents || "";

      if (originalStyles.placeholder) {
        originalStyles.placeholder.remove();
      }
    }

    currentHighlightElem = null;
    originalStyles = null;
  }
  if (currentHoleElem) {
    currentHoleElem.remove();
    currentHoleElem = null;
  }
}

function clearTutorialUI() {
  clearHighlight();
  hideOverlay();
}

function endTutorial() {
  clearTutorialUI();
  socket.emit("kidsMode:set", false);
  kidsTutorial.currentKey = "intro";
}

window.endTutorial = endTutorial;

if (window.kidsMode) {
  showCurrentStep();
}