// app.js
// Map + shared data load + minimal list rendering (no framework) + Favorites w/ localStorage

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
const cardFavBtn = document.getElementById("card-fav");

// List container (added in index.html as <div id="list" class="list"></div>)
const listEl = document.getElementById("list");

// ---------------------------
// Favorites (single source of truth)
// ---------------------------
const FAVORITES_KEY = "ttmap:favorites:v1";
let favoriteIds = loadFavorites(); // Set<string>
let currentCardStopId = null;

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((x) => typeof x === "string" && x.length));
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds]));
  } catch {
    // ignore (storage disabled/quota/etc.)
  }
}

function isFavorite(id) {
  return favoriteIds.has(id);
}

function toggleFavorite(id) {
  if (!id) return;

  if (favoriteIds.has(id)) favoriteIds.delete(id);
  else favoriteIds.add(id);

  saveFavorites();
  updateFavoriteUI(id);
}

function safeEscape(sel) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(sel);
  return String(sel).replace(/["\\]/g, "\\$&");
}

function setFavButtonState(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-fav", !!on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function updateFavoriteUI(id) {
  const on = isFavorite(id);

  // Update list row heart
  if (listEl) {
    const q = `.fav-btn[data-stop-id="${safeEscape(id)}"]`;
    const listBtn = listEl.querySelector(q);
    setFavButtonState(listBtn, on);
  }

  // Update card heart if this stop is currently shown
  if (currentCardStopId === id) {
    setFavButtonState(cardFavBtn, on);
  }
}

// Card heart click (do not bubble to map/container)
if (cardFavBtn) {
  cardFavBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(currentCardStopId);
  });
  cardFavBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
}

// ---------------------------
// Card show/hide
// ---------------------------
function showCard(stop) {
  currentCardStopId = stop.id || null;

  cardName.textContent = stop.name || "";
  cardAddress.textContent = stop.address || "";
  cardTags.textContent = (stop.tags || []).join(" • ");

  if (currentCardStopId) {
    setFavButtonState(cardFavBtn, isFavorite(currentCardStopId));
  } else {
    setFavButtonState(cardFavBtn, false);
  }

  card.style.display = "block";
}

function hideCard() {
  currentCardStopId = null;
  card.style.display = "none";
}

// Dismiss when tapping the map (Leaflet event)
map.on("click", hideCard);

// Dismiss on mobile taps reliably (DOM event)
map.getContainer().addEventListener("pointerdown", hideCard);

// ---------------------------
// List rendering
// ---------------------------
function renderList(stops) {
  if (!listEl) return;

  listEl.innerHTML = "";

  // Optional: sort by name for readability
  const sorted = [...stops].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const stop of sorted) {
    const item = document.createElement("div");
    item.className = "list-item";

    // Header row: title + favorite button
    const header = document.createElement("div");
    header.className = "list-item-header";

    const title = document.createElement("div");
    title.className = "list-item-title";
    title.textContent = stop.name || "(Unnamed stop)";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "icon-btn fav-btn";
    fav.setAttribute("aria-label", "Favorite");
    fav.title = "Favorite";
    fav.dataset.stopId = stop.id || "";
    setFavButtonState(fav, !!(stop.id && isFavorite(stop.id)));

    fav.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 21s-7.2-4.6-9.6-8.7C.7 9.2 2.1 6.2 5.2 5.3c1.8-.5 3.6.1 4.8 1.4 1.2-1.3 3-1.9 4.8-1.4 3.1.9 4.5 3.9 2.8 7-2.4 4.1-9.6 8.7-9.6 8.7z"
          fill="currentColor"
        />
      </svg>
    `;

    // Heart click should NOT trigger row selection/navigation
    fav.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(stop.id);
    });
    fav.addEventListener("pointerdown", (e) => e.stopPropagation());

    header.appendChild(title);
    header.appendChild(fav);
    item.appendChild(header);

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

    if (desc.textContent) item.appendChild(desc);
    if (meta.childNodes.length) item.appendChild(meta);

    listEl.appendChild(item);
  }
}

// ---------------------------
// Data load + map markers
// ---------------------------
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