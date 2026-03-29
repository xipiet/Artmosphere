const checkbox = document.querySelector("#button-1 .checkbox");

checkbox.addEventListener("change", () => {
    const kidsMode = checkbox.checked;
    socket.emit("kidsMode:set", kidsMode);
});

// Checkbox-State mit Server-State synchron halten
// (falls z.B. Admin den KidsMode von außen setzt)
socket.on("kidsMode:update", (d) => {
    checkbox.checked = d.kidsMode;
});