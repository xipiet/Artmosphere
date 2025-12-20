// QR-Code generieren
window.onload = function() {
    var qrcode = new QRCode(document.getElementById("qrcode"), {
        text: "http://ordner.artmosphere.duckdns.org",
        width: 128,
        height: 128,
        colorDark: "#000000",
        colorLight: "#ffffff",
    });
};
