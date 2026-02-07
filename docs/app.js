o// Manchester, NH center
const map = L.map("map").setView([42.9956, -71.4548], 14);

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

fetch("./stops.json")
  .then((r) => r.json())
  .then((stops) => {
    stops.forEach((stop) => {
      const marker = L.marker([stop.lat, stop.lng]).addTo(map);
      marker.on("click", (e) => {
  L.DomEvent.stopPropagation(e);
  showCard(stop);
});
    });
  })
  .catch((err) => {
    console.error("Could not load stops.json", err);
  });
