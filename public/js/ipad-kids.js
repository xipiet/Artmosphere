const socket = io(); 

let initialized = false; 
const frame = document.getElementById("kidsFrame"); 
const toggleBtn = document.getElementById("kidsToggle");

// Kids Mode – Server Push 
socket.on("kidsMode:update", (d) => {
    const newMode = d.kidsMode; 
    
    if (!initialized) { 
        initialized = true; 
        return; 
    }
    
    // Kids Mode OFF → zurück zum normalen iPad 
    if (!newMode) { 
        window.location.href = "/ipad"; 
    }
});

// User toggles Kids Mode Off 
toggleBtn.addEventListener("click", () => { 
    socket.emit("kidsMode:set", false); 
});

// --- KIDS MODE TUTORIAL POPUP --- //
window.addEventListener("DOMContentLoaded", () => {
    const popup = document.getElementById("kidsTutorial");
    const closeBtn = document.getElementById("kidsPopupClose");

    popup.classList.remove("hidden");

    closeBtn.addEventListener("click", () => {
        popup.classList.add("hidden");
    });
});