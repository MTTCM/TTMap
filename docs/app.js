// Manchester, NH center
const map = L.map("map").setView([42.9956, -71.4548], 14);

// expose for ui.js (so we can invalidateSize() after tab switching)
window.__mttMap = map;


L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const card = document.getElementById("card");
const cardName = document.getElementById("card-name");
const cardAddress = document.getElementById("card-address");
const cardTags = document.getElementById("card-tags");

function showCard(stop) {
  cardName.textContent = stop.name || "";
  cardAddress.textContent = stop.address || "";
  cardTags.textContent = (stop.tags || []).join(" • ");
  card.style.display = "block";
}

function hideCard() {
  card.style.display = "none";
}

// Dismiss when tapping the map (Leaflet event)
map.on("click", hideCard);

// Dismiss on mobile taps reliably (DOM event)
map.getContainer().addEventListener("pointerdown", hideCard);

fetch("./stops.json")
  .then((r) => r.json())
  .then((stops) => {
    stops.forEach((stop) => {
      const marker = L.marker([stop.lat, stop.lng]).addTo(map);

      marker.on("click", (e) => {
        // Prevent the marker tap from also dismissing via the map/container handler
        if (e && e.originalEvent) e.originalEvent.stopPropagation();
        showCard(stop);
      });
    });
  })
  .catch((err) => {
    console.error("Could not load stops.json", err);
  });
