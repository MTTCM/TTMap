(function () {
  const tabMap = document.getElementById("tab-map");
  const tabList = document.getElementById("tab-list");

  const viewMap = document.getElementById("view-map");
  const viewList = document.getElementById("view-list");

  const btnFilters = document.getElementById("btn-filters");
  const btnAbout = document.getElementById("btn-about");

  const filtersOverlay = document.getElementById("filters-overlay");
  const aboutOverlay = document.getElementById("about-overlay");

  const btnAboutClose = document.getElementById("btn-about-close");

  let activeView = "map";
  let viewBeforeAbout = "map";

  function setActiveTab(next) {
    activeView = next;

    const isMap = next === "map";

    tabMap.classList.toggle("is-active", isMap);
    tabList.classList.toggle("is-active", !isMap);

    tabMap.setAttribute("aria-selected", String(isMap));
    tabList.setAttribute("aria-selected", String(!isMap));

    // Show/hide panels
    viewMap.hidden = !isMap;
    viewList.hidden = isMap;

    viewMap.classList.toggle("is-active", isMap);
    viewList.classList.toggle("is-active", !isMap);

    // If returning to map, Leaflet usually needs a size invalidate after being unhidden
    if (isMap && window.__mttMap && typeof window.__mttMap.invalidateSize === "function") {
      setTimeout(() => window.__mttMap.invalidateSize(), 0);
    }
  }

  function openFilters() {
    filtersOverlay.hidden = false;
  }

  function closeFilters() {
    filtersOverlay.hidden = true;
  }

  function openAbout() {
    viewBeforeAbout = activeView; // return to the previously active tab without resetting state
    aboutOverlay.hidden = false;
  }

  function closeAbout() {
    aboutOverlay.hidden = true;
    // return to previous tab (state preserved; nothing is reset)
    setActiveTab(viewBeforeAbout);
  }

  // Tab clicks
  tabMap.addEventListener("click", () => setActiveTab("map"));
  tabList.addEventListener("click", () => setActiveTab("list"));

  // Filters
  btnFilters.addEventListener("click", openFilters);

  // About
  btnAbout.addEventListener("click", openAbout);
  btnAboutClose.addEventListener("click", closeAbout);

  // Click-to-close for overlays (backdrop and [data-close])
  document.addEventListener("click", (e) => {
    const target = e.target;

    if (!(target instanceof HTMLElement)) return;

    const closeType = target.getAttribute("data-close");

    if (closeType === "filters") closeFilters();
    if (closeType === "about") closeAbout();
  });

  // Escape key closes whichever overlay is open (nice on desktop)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (!filtersOverlay.hidden) closeFilters();
    else if (!aboutOverlay.hidden) closeAbout();
  });
})();