// app.js
// Map + shared data load + minimal list rendering (no framework)

// Manchester, NH center
const map = L.map("map").setView([42.9956, -71.4548], 14);

// expose for ui.js (so we can invalidateSize() after tab switching)
window.__mttMap = map;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Bottom detail card elements
const card = document.getElementById("card");
const cardName = document.getElementById("card-name");
const cardAddress = document.getElementById("card-address");
const cardTags = document.getElementById("card-tags");

// List container (added in index.html as <div id="list" class="list"></div>)
const listEl = document.getElementById("list");

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

// Basic list rendering (no filtering logic here yet)
function renderList(stops) {
  if (!listEl) return;

  listEl.innerHTML = "";

  // Optional: sort by name for readability
  const sorted = [...stops].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "")
  );

  for (const stop of sorted) {
    const item = document.createElement("div");
    item.className = "list-item";

    const title = document.createElement("div");
    title.className = "list-item-title";
    title.textContent = stop.name || "(Unnamed stop)";

    const desc = document.createElement("div");
    desc.className = "list-item-desc";
    desc.textContent = stop.description || "";

    const meta = document.createElement("div");
    meta.className = "list-item-meta";

    if (stop.address) {
      const addr = document.createElement("span");
      addr.textContent = stop.address;
      meta.appendChild(addr);
    }

    if (Array.isArray(stop.tags) && stop.tags.length) {
      for (const t of stop.tags) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = t;
        meta.appendChild(tag);
      }
    }

    item.appendChild(title);
    if (desc.textContent) item.appendChild(desc);
    if (meta.childNodes.length) item.appendChild(meta);

    listEl.appendChild(item);
  }
}

fetch("./stops.json")
  .then((r) => r.json())
  .then((stops) => {
    // Render list view immediately
    renderList(stops);

    // Add map markers (skip entries with missing coords)
    stops.forEach((stop) => {
      if (stop.lat == null || stop.lng == null) return;

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