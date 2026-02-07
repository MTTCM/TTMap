// app.js
// Map + shared data load + minimal list rendering (no framework) + Favorites w/ localStorage
// + Global Filters (diet tags + favorites-only + search) shared across Map/List with persistence

// Manchester, NH center
const map = L.map("map").setView([42.9956, -71.4548], 14);

// expose for ui.js (so we can invalidateSize() after tab switching)
window.__mttMap = map;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// ---------------------------
// Filters (single source of truth + persistence)
// ---------------------------
const FILTERS_KEY = "ttmap:filters:v1";
const ALLOWED_DIET_TAGS = new Set(["gf", "vegetarian", "vegan"]);
const DEFAULT_FILTERS = {
  dietTags: [], // array of strings: gf/vegetarian/vegan
  favoritesOnly: false, // boolean
  search: "", // string
};

// Bottom detail card elements
const card = document.getElementById("card");
const cardName = document.getElementById("card-name");
const cardAddress = document.getElementById("card-address");
const cardTags = document.getElementById("card-tags");
const cardFavBtn = document.getElementById("card-fav");

// List container
const listEl = document.getElementById("list");

// ---------------------------
// Favorites (single source of truth)
// ---------------------------
const FAVORITES_KEY = "ttmap:favorites:v1";
let favoriteIds = loadFavorites(); // Set<string>
let currentCardStopId = null;

// Data + markers (needed for filtering both views)
let allStops = [];
const markersById = new Map(); // id -> Leaflet marker

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

function loadFilters() {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return { ...DEFAULT_FILTERS };

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_FILTERS };

    const dietTagsRaw = Array.isArray(parsed.dietTags) ? parsed.dietTags : [];
    const dietTags = dietTagsRaw
      .filter((t) => typeof t === "string")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => ALLOWED_DIET_TAGS.has(t));

    const favoritesOnly = !!parsed.favoritesOnly;
    const search = typeof parsed.search === "string" ? parsed.search : "";

    return { dietTags, favoritesOnly, search };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

let filterState = loadFilters();

function saveFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filterState));
  } catch {
    // ignore (storage disabled/quota/etc.)
  }
}

function normalizeSearchTerms(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchesFilters(stop) {
  // AND across categories
  // Diet tags: OR within diet tags
  if (filterState.dietTags.length) {
    const stopTags = Array.isArray(stop.tags) ? stop.tags : [];
    const stopTagSet = new Set(stopTags.map((t) => String(t).toLowerCase()));

    const anyMatch = filterState.dietTags.some((t) => stopTagSet.has(t));
    if (!anyMatch) return false;
  }

  if (filterState.favoritesOnly) {
    if (!stop.id || !favoriteIds.has(stop.id)) return false;
  }

  const terms = normalizeSearchTerms(filterState.search);
  if (terms.length) {
    const haystack = `${stop.name || ""} ${stop.description || ""} ${
      stop.address || ""
    }`.toLowerCase();

    const allTermsPresent = terms.every((term) => haystack.includes(term));
    if (!allTermsPresent) return false;
  }

  return true;
}

function getVisibleStops() {
  return allStops.filter(matchesFilters);
}

function setDietTagSelected(tag, on) {
  const t = String(tag).toLowerCase();
  const set = new Set(filterState.dietTags);

  if (on) set.add(t);
  else set.delete(t);

  filterState.dietTags = [...set].filter((x) => ALLOWED_DIET_TAGS.has(x));
}

function toggleFavorite(id) {
  if (!id) return;

  if (favoriteIds.has(id)) favoriteIds.delete(id);
  else favoriteIds.add(id);

  saveFavorites();

  // Always update hearts immediately
  updateFavoriteUI(id);

  // If favorites-only is ON, toggling a heart changes visibility
  if (filterState.favoritesOnly) {
    applyFilters();
  }
}

function safeEscape(sel) {
  if (window.CSS && typeof window.CSS.escape === "function")
    return window.CSS.escape(sel);
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
// Apply filters to BOTH views (map + list)
// ---------------------------
function applyFilters() {
  const visibleStops = getVisibleStops();

  // Update list
  renderList(visibleStops);

  // Update markers
  const visibleIds = new Set(visibleStops.map((s) => s.id));
  for (const [id, marker] of markersById.entries()) {
    if (!id || !marker) continue;

    const shouldBeVisible = visibleIds.has(id);
    const isOnMap = map.hasLayer(marker);

    if (shouldBeVisible && !isOnMap) marker.addTo(map);
    if (!shouldBeVisible && isOnMap) marker.removeFrom(map);
  }

  // If the selected stop is now filtered out, close the card (simplest behavior)
  if (currentCardStopId && !visibleIds.has(currentCardStopId)) {
    hideCard();
  }
}

// ---------------------------
// List rendering
// ---------------------------
function renderList(stops) {
  if (!listEl) return;

  listEl.innerHTML = "";

  // Optional: sort by name for readability
  const sorted = [...stops].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "")
  );

  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "16px 4px";
    empty.textContent = "No stops match your filters.";
    listEl.appendChild(empty);
    return;
  }

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
// Filter panel wiring
// ---------------------------
function initFiltersUI() {
  const searchEl = document.getElementById("filter-search");
  const favOnlyEl = document.getElementById("filter-favorites-only");

  const gfEl = document.getElementById("filter-tag-gf");
  const vegEl = document.getElementById("filter-tag-vegetarian");
  const veganEl = document.getElementById("filter-tag-vegan");

  const resetBtn = document.getElementById("filters-reset");
  const openBtn = document.getElementById("btn-filters"); // sync state when opening

  function syncControlsFromState() {
    if (searchEl) searchEl.value = filterState.search || "";
    if (favOnlyEl) favOnlyEl.checked = !!filterState.favoritesOnly;

    const set = new Set(filterState.dietTags);
    if (gfEl) gfEl.checked = set.has("gf");
    if (vegEl) vegEl.checked = set.has("vegetarian");
    if (veganEl) veganEl.checked = set.has("vegan");
  }

  function commitAndApply() {
    saveFilters();
    applyFilters();
  }

  // Diet tags
  if (gfEl)
    gfEl.addEventListener("change", () => {
      setDietTagSelected("gf", gfEl.checked);
      commitAndApply();
    });

  if (vegEl)
    vegEl.addEventListener("change", () => {
      setDietTagSelected("vegetarian", vegEl.checked);
      commitAndApply();
    });

  if (veganEl)
    veganEl.addEventListener("change", () => {
      setDietTagSelected("vegan", veganEl.checked);
      commitAndApply();
    });

  // Favorites-only
  if (favOnlyEl)
    favOnlyEl.addEventListener("change", () => {
      filterState.favoritesOnly = !!favOnlyEl.checked;
      commitAndApply();
    });

  // Search (debounced)
  let searchTimer = null;
  if (searchEl)
    searchEl.addEventListener("input", () => {
      filterState.search = searchEl.value || "";
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(commitAndApply, 150);
    });

  // Reset/Clear
  if (resetBtn)
    resetBtn.addEventListener("click", () => {
      filterState = { ...DEFAULT_FILTERS };
      syncControlsFromState();
      commitAndApply();
    });

  // When opening filters, sync the UI to persisted state
  if (openBtn) openBtn.addEventListener("click", syncControlsFromState);

  // Initial sync
  syncControlsFromState();
}

// ---------------------------
// Data load + map markers
// ---------------------------
fetch("./stops.json")
  .then((r) => r.json())
  .then((stops) => {
    allStops = Array.isArray(stops) ? stops : [];

    // Create markers (but do NOT add them all immediately; applyFilters() will decide)
    allStops.forEach((stop) => {
      if (stop.lat == null || stop.lng == null) return;

      const marker = L.marker([stop.lat, stop.lng]);

      if (stop.id) {
        markersById.set(stop.id, marker);
      } else {
        // If no id, just add it to map; we can't filter it reliably
        marker.addTo(map);
      }

      marker.on("click", (e) => {
        // Prevent the marker tap from also dismissing via the map/container handler
        if (e && e.originalEvent) e.originalEvent.stopPropagation();
        showCard(stop);
      });
    });

    // Wire filter panel controls, then apply persisted filters
    initFiltersUI();
    applyFilters();
  })
  .catch((err) => {
    console.error("Could not load stops.json", err);
  });