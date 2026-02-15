// app.js
// Map + shared data load + minimal list rendering (no framework) + Favorites w/ localStorage
// + Global Filters (diet tags + favorites-only + search) shared across Map/List with persistence
// + Selection sync across Map/List + selected marker icon swap + bring-to-front zIndex (marker_bowl)

//
// Manchester, NH center
//
const map = L.map("map").setView([42.9956, -71.4548], 14);

// expose for ui.js (so we can invalidateSize() after tab switching)
window.__mttMap = map;

// ---------------------------
// Locate Me (one-time geolocation; Map tab only)
// ---------------------------
let userLocationMarker = null;
let mapToastTimer = null;

function showMapToast(message) {
  const el = document.getElementById("map-toast");
  if (!el) return;

  el.textContent = message || "";
  el.classList.add("is-visible");

  if (mapToastTimer) clearTimeout(mapToastTimer);
  mapToastTimer = setTimeout(() => {
    el.classList.remove("is-visible");
  }, 2500);
}

function setUserLocationDot(lat, lng) {
  const ll = [lat, lng];

  if (!userLocationMarker) {
    // Single dot only (no accuracy ring)
    userLocationMarker = L.circleMarker(ll, {
      radius: 6,
      stroke: false,
      fill: true,
      fillOpacity: 1,
    }).addTo(map);
  } else {
    userLocationMarker.setLatLng(ll);
  }
}

function locateOnce() {
  const btn = document.getElementById("btn-locate");

  if (!navigator.geolocation) {
    showMapToast("Location is not supported on this device/browser.");
    return;
  }

  if (btn) btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      setUserLocationDot(lat, lng);

      // Center + zoom to user position (one-time)
      map.setView([lat, lng], 16);

      if (btn) btn.disabled = false;
    },
    (err) => {
      let msg = "Unable to get your location.";
      if (err && typeof err.code === "number") {
        if (err.code === 1) msg = "Location permission denied.";
        else if (err.code === 2) msg = "Location unavailable.";
        else if (err.code === 3) msg = "Location request timed out.";
      }

      showMapToast(msg);
      if (btn) btn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function initLocateUI() {
  const btn = document.getElementById("btn-locate");
  if (!btn) return;

  // Prevent map tap handlers from firing
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    locateOnce();
  });
}

initLocateUI();

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 20,
  }
).addTo(map);

// ---------------------------
// Filters (single source of truth + persistence)
// ---------------------------
const FILTERS_KEY = "ttmap:filters:v1";
const ALLOWED_DIET_TAGS = new Set(["gf", "vegetarian", "vegan"]);
const DEFAULT_FILTERS = {
  dietTags: [],
  favoritesOnly: false,
  search: "",
};

// Map detail card elements
const card = document.getElementById("card");
const cardName = document.getElementById("card-name");
const cardTags = document.getElementById("card-tags");
const cardDesc = document.getElementById("card-desc");
const cardFavBtn = document.getElementById("card-fav");
const cardCloseBtn = document.getElementById("card-close");

// List container
const listEl = document.getElementById("list");

// ---------------------------
// Favorites (single source of truth)
// ---------------------------
const FAVORITES_KEY = "ttmap:favorites:v1";
let favoriteIds = loadFavorites(); // Set<string>

// ---------------------------
// Selection (single source of truth)
// ---------------------------
let selectedStopId = null; // string | null

// Data + markers (needed for filtering both views)
let allStops = [];
const markersById = new Map(); // id -> Leaflet marker

// z-index offsets for bring-to-front behavior
const DEFAULT_Z_INDEX_OFFSET = 0;
const SELECTED_Z_INDEX_OFFSET = 1000;

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
    // ignore
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
    // ignore
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

function triggerFavPop(btn) {
  if (!btn) return;
  btn.classList.remove("fav-pop");
  void btn.offsetWidth;
  btn.classList.add("fav-pop");
  window.setTimeout(() => btn.classList.remove("fav-pop"), 160);
}

function updateFavoriteUI(id) {
  const on = isFavorite(id);

  if (listEl) {
    const q = `.fav-btn[data-stop-id="${safeEscape(id)}"]`;
    const listBtn = listEl.querySelector(q);
    setFavButtonState(listBtn, on);
  }

  if (selectedStopId === id) {
    setFavButtonState(cardFavBtn, on);
  }
}

function toggleFavorite(id, sourceBtn = null) {
  if (!id) return;

  if (favoriteIds.has(id)) favoriteIds.delete(id);
  else favoriteIds.add(id);

  saveFavorites();
  updateFavoriteUI(id);

  if (sourceBtn) triggerFavPop(sourceBtn);

  if (filterState.favoritesOnly) {
    applyFilters();
  }
}

// ---------------------------
// Tag chip rendering (Map card + List cards)
// ---------------------------
function formatTagLabel(tag) {
  const raw = String(tag || "").trim();
  const t = raw.toLowerCase();

  if (t === "gf" || t === "gluten-free" || t === "glutenfree") return "GF";
  if (t === "vegetarian" || t === "veg") return "V";
  if (t === "vegan") return "VE";

  return raw.toUpperCase();
}

function renderTagChips(container, tags) {
  if (!container) return;
  container.innerHTML = "";

  if (!Array.isArray(tags) || !tags.length) return;

  for (const t of tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = formatTagLabel(t);
    container.appendChild(chip);
  }
}

// ---------------------------
// Card show/hide (driven by selectedStopId)
// ---------------------------
let cardSuppressedByTab = false;

function setCardSuppressed(on) {
  cardSuppressedByTab = !!on;
  if (!card) return;

  if (cardSuppressedByTab) {
    card.style.display = "none";
  } else {
    if (selectedStopId) card.style.display = "block";
  }
}

function showCard(stop) {
  if (!stop || !stop.id) return;

  if (cardName) cardName.textContent = stop.name || "";
  renderTagChips(cardTags, stop.tags || []);

  if (cardDesc) cardDesc.textContent = stop.description || "";

  setFavButtonState(cardFavBtn, isFavorite(stop.id));

  if (card) card.style.display = cardSuppressedByTab ? "none" : "block";
}

function hideCard() {
  if (card) card.style.display = "none";
}

function initTabCardSuppression() {
  const tabMap = document.getElementById("tab-map");
  const tabList = document.getElementById("tab-list");
  if (!tabMap || !tabList) return;

  const onMap = () => setCardSuppressed(false);
  const onList = () => setCardSuppressed(true);

  tabMap.addEventListener("click", onMap, true);
  tabList.addEventListener("click", onList, true);

  const mo = new MutationObserver(() => {
    const mapSelected = tabMap.getAttribute("aria-selected") === "true";
    setCardSuppressed(!mapSelected);
  });
  mo.observe(tabMap, { attributes: true, attributeFilter: ["aria-selected"] });
}

initTabCardSuppression();

// Prevent taps inside the card from bubbling
if (card) {
  card.addEventListener("pointerdown", (e) => e.stopPropagation());
  card.addEventListener("click", (e) => e.stopPropagation());
}

// Close button clears selection (explicit)
if (cardCloseBtn) {
  cardCloseBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  cardCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSelectedStop(null, "card-close");
  });
}

// Card heart click
if (cardFavBtn) {
  cardFavBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  cardFavBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(selectedStopId, cardFavBtn);
  });
}

// ---------------------------
// Marker icons (default + selected)
// ---------------------------
function buildDefaultTacoSvg() {
  return `
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M 4 20 A 12 12 0 0 1 28 20 Z"
            fill="#F2B84B"
            stroke="#2B1B10"
            stroke-width="0.5"
            stroke-linejoin="round"/>
      <circle cx="11" cy="14.8" r="4.5" fill="#7A4A2A"/>
      <circle cx="12.6" cy="13.4" r="4.05" fill="#C0392B"/>
      <circle cx="14.2" cy="12.0" r="3.645" fill="#4CAF50"/>
      <path d="M 4 20 A 12 12 0 0 1 28 20 Z"
            transform="translate(4 0)"
            fill="#F2B84B"
            stroke="#2B1B10"
            stroke-width="0.5"
            stroke-linejoin="round"/>
    </svg>
  `;
}

function buildSelectedBowlSvg() {
  // Uses the exact SVG you provided (kept as-is), only adding aria-hidden.
  // NOTE: Leaflet divIcon will size this via iconSize; the SVG uses viewBox 0 0 400 150.
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" aria-hidden="true">
  <defs>
    <path id="trayShape"
          d="M 30 40
             Q 200 92 370 40
             L 310 110
             L 90 110
             Z" />

    <clipPath id="trayClip">
      <use href="#trayShape" />
    </clipPath>

    <pattern id="redLattice"
             patternUnits="userSpaceOnUse"
             width="56"
             height="56"
             patternTransform="rotate(45)">
      <line x1="0"  y1="-200" x2="0"  y2="200"
            stroke="#d32f2f" stroke-width="12"/>
      <line x1="28" y1="-200" x2="28" y2="200"
            stroke="#d32f2f" stroke-width="3"/>
      <line x1="-200" y1="0"  x2="200" y2="0"
            stroke="#d32f2f" stroke-width="12"/>
      <line x1="-200" y1="28" x2="200" y2="28"
            stroke="#d32f2f" stroke-width="3"/>
    </pattern>
  </defs>

  <g transform="translate(60 -60) scale(8)">
    <path d="M 4 20 A 12 12 0 0 1 28 20 Z"
          fill="#F2B84B"
          stroke="#2B1B10"
          stroke-width="0.5"/>

    <circle cx="11" cy="14.8" r="4.5" fill="#7A4A2A"/>
    <circle cx="12.6" cy="13.4" r="4.05" fill="#C0392B"/>
    <circle cx="14.2" cy="12.0" r="3.645" fill="#4CAF50"/>

    <path d="M 4 20 A 12 12 0 0 1 28 20 Z"
          transform="translate(4 0)"
          fill="#F2B84B"
          stroke="#2B1B10"
          stroke-width="0.5"/>
  </g>

  <use href="#trayShape"
       fill="#ffffff"
       stroke="#000000"
       stroke-width="3.5"
       stroke-linejoin="round"/>

  <g clip-path="url(#trayClip)">
    <rect x="0" y="0" width="400" height="150"
          fill="url(#redLattice)"/>
  </g>
</svg>
  `;
}

const defaultTacoIcon = L.divIcon({
  className: "taco-marker",
  html: buildDefaultTacoSvg(),
  iconSize: [60, 60],
  iconAnchor: [24, 30],
});

const selectedTacoIcon = L.divIcon({
  className: "taco-marker taco-marker--selected",
  html: buildSelectedBowlSvg(),
  // Slightly wider than default, but not a size explosion.
  iconSize: [72, 32],
  // anchor near bottom-middle of the tray
  iconAnchor: [36, 28],
});

// ---------------------------
// Selection: central setter (single source of truth)
// ---------------------------
function findStopById(id) {
  if (!id) return null;
  return allStops.find((s) => s && s.id === id) || null;
}

function updateListSelectionHighlight() {
  if (!listEl) return;

  listEl
    .querySelectorAll(".list-item.is-selected")
    .forEach((el) => el.classList.remove("is-selected"));

  if (!selectedStopId) return;

  const q = `.list-item[data-stop-id="${safeEscape(selectedStopId)}"]`;
  const row = listEl.querySelector(q);
  if (row) row.classList.add("is-selected");
}

function setMarkerSelectedVisual(id, isSelected) {
  const marker = markersById.get(id);
  if (!marker) return;

  marker.setIcon(isSelected ? selectedTacoIcon : defaultTacoIcon);
  marker.setZIndexOffset(
    isSelected ? SELECTED_Z_INDEX_OFFSET : DEFAULT_Z_INDEX_OFFSET
  );
}

function setSelectedStop(stopId, source = "unknown") {
  const nextId = stopId ? String(stopId) : null;
  const prevId = selectedStopId;

  if (prevId === nextId) {
    updateListSelectionHighlight();
    if (selectedStopId) {
      const stop = findStopById(selectedStopId);
      if (stop) showCard(stop);
    } else {
      hideCard();
    }
    return;
  }

  selectedStopId = nextId;

  if (prevId) setMarkerSelectedVisual(prevId, false);
  if (selectedStopId) setMarkerSelectedVisual(selectedStopId, true);

  updateListSelectionHighlight();

  if (!selectedStopId) {
    hideCard();
  } else {
    const stop = findStopById(selectedStopId);
    if (stop) showCard(stop);
    else hideCard();
  }
}

// IMPORTANT CHANGE:
// Tapping the map should NOT clear selected stop.
// So we do NOT attach map click/pointerdown handlers that call setSelectedStop(null).

// ---------------------------
// Apply filters to BOTH views (map + list)
// ---------------------------
function applyFilters() {
  const visibleStops = getVisibleStops();

  renderList(visibleStops);

  const visibleIds = new Set(visibleStops.map((s) => s.id));
  for (const [id, marker] of markersById.entries()) {
    if (!id || !marker) continue;

    const shouldBeVisible = visibleIds.has(id);
    const isOnMap = map.hasLayer(marker);

    if (shouldBeVisible && !isOnMap) marker.addTo(map);
    if (!shouldBeVisible && isOnMap) marker.removeFrom(map);
  }

  if (selectedStopId && !visibleIds.has(selectedStopId)) {
    setSelectedStop(null, "filters");
  } else {
    updateListSelectionHighlight();
  }
}

// ---------------------------
// List rendering
// ---------------------------
function renderList(stops) {
  if (!listEl) return;

  listEl.innerHTML = "";

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
    const outer = document.createElement("div");
    outer.className = "list-item";
    outer.dataset.stopId = stop.id || "";

    outer.addEventListener("click", () => {
      if (!stop.id) return;
      setSelectedStop(stop.id, "list");
    });

    const cardEl = document.createElement("div");
    cardEl.className = "vendor-card";

    const row = document.createElement("div");
    row.className = "vendor-row";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "icon-btn fav-btn";
    fav.setAttribute("aria-label", "Favorite");
    fav.title = "Favorite";
    fav.dataset.stopId = stop.id || "";
    setFavButtonState(fav, !!(stop.id && isFavorite(stop.id)));

    fav.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-7.2-4.6-9.6-8.7C.7 9.2 2.1 6.2 5.2 5.3c1.8-.5 3.6.1 4.8 1.4 1.2-1.3 3-1.9 4.8-1.4 3.1.9 4.5 3.9 2.8 7-2.4 4.1-9.6 8.7-9.6 8.7z" />
      </svg>
    `;

    fav.addEventListener("pointerdown", (e) => e.stopPropagation());
    fav.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(stop.id, fav);
    });

    const content = document.createElement("div");
    content.className = "vendor-content";

    const line = document.createElement("div");
    line.className = "vendor-line";

    const name = document.createElement("div");
    name.className = "vendor-name";
    name.textContent = stop.name || "(Unnamed stop)";

    const tags = document.createElement("div");
    tags.className = "vendor-tags";
    renderTagChips(tags, stop.tags || []);

    line.appendChild(name);
    line.appendChild(tags);

    const desc = document.createElement("div");
    desc.className = "vendor-desc";
    desc.textContent = stop.description || "";

    content.appendChild(line);
    if (desc.textContent) content.appendChild(desc);

    row.appendChild(fav);
    row.appendChild(content);

    cardEl.appendChild(row);
    outer.appendChild(cardEl);
    listEl.appendChild(outer);
  }

  updateListSelectionHighlight();
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
  const openBtn = document.getElementById("btn-filters");

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

  if (favOnlyEl)
    favOnlyEl.addEventListener("change", () => {
      filterState.favoritesOnly = !!favOnlyEl.checked;
      commitAndApply();
    });

  let searchTimer = null;
  if (searchEl)
    searchEl.addEventListener("input", () => {
      filterState.search = searchEl.value || "";
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(commitAndApply, 150);
    });

  if (resetBtn)
    resetBtn.addEventListener("click", () => {
      filterState = { ...DEFAULT_FILTERS };
      syncControlsFromState();
      commitAndApply();
    });

  if (openBtn) openBtn.addEventListener("click", syncControlsFromState);

  syncControlsFromState();
}

// ---------------------------
// Data load + map markers
// ---------------------------
fetch("./stops.json")
  .then((r) => r.json())
  .then((stops) => {
    allStops = Array.isArray(stops) ? stops : [];

    allStops.forEach((stop) => {
      if (stop.lat == null || stop.lng == null) return;

      const marker = L.marker([stop.lat, stop.lng], { icon: defaultTacoIcon });

      if (stop.id) {
        markersById.set(stop.id, marker);
      } else {
        marker.addTo(map);
      }

      marker.on("click", (e) => {
        // Keep this so Leaflet doesn't treat it as a map click, even though map click no longer clears selection.
        if (e && e.originalEvent) e.originalEvent.stopPropagation();
        if (stop.id) setSelectedStop(stop.id, "marker");
      });
    });

    initFiltersUI();
    applyFilters();
  })
  .catch((err) => {
    console.error("Could not load stops.json", err);
  });