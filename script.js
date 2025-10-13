/***************************************************
 * backdoorurbanism — script.js
 ***************************************************/

/*---------------------------------------
  1) BOUTON : TOGGLE LÉGENDE
---------------------------------------*/
document.getElementById("toggle-legend-btn").addEventListener("click", () => {
  const legend = document.getElementById("criteria-legend");
  legend.style.display =
    legend.style.display === "none" || legend.style.display === ""
      ? "block"
      : "none";
});

/*---------------------------------------
  2) CONSTANTES / ÉTAT GLOBAL / DOM
---------------------------------------*/
let currentView = "map"; // vue active globale
const montreuilView = [48.871, 2.433];
const montreuilZoom = 15;
const toulouseView = [43.5675824, 1.4000176];
const toulouseZoom = 15;
let currentLocation = "montreuil"; // localisation initiale
let patternThreshold = 5; // nb de critères communs pour former un pattern
let activePatternFilter = null;

// Références DOM fréquentes
const proxemicView = document.getElementById("proxemic-view");
const SAVED_PATTERNS_KEY = "savedPatternsV1";

// État de données
let allLayers = []; // toutes couches cliquables (fragments & discours)
let dataGeojson = []; // fragments Montreuil
let datamGeojson = []; // fragments Mirail
let patterns = {}; // { P1: {name,elements[],criteria{}}, ... }
let patternNames = {}; // { P1:'P1', ... } (alias si besoin)
let discoursLayer = null; // couche de points "discours" (pane dédié)
let combinedFeatures = []; // concat Montreuil + Mirail (utile patterns-map)

// Panne "discours" au-dessus
let map = L.map("map").setView(montreuilView, montreuilZoom);
map.createPane("pane-discours");
map.getPane("pane-discours").style.zIndex = 650; // > autres couches

// Fond de carte (dark)
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors, © CartoDB",
}).addTo(map);

/*---------------------------------------
ÉTAT CRÉATION D’UNITÉ (patterns-map)
---------------------------------------*/
let unitCreation = {
  active: false,
  mouseMoveHandler: null,
};
let unitMap = null; // carte dédiée "Unité de projet" (Partie 2)
let unitLayerGroup = null; // toutes les unités dessinées
let unitContextGroup = null; // contexte (contours, base grise, etc.)

/* ------------ Helpers images : nettoyage & création d'<img> ------------- */
function cleanPhotoUrl(u) {
  if (!u) return null;
  // trim + force https
  let s = String(u)
    .trim()
    .replace(/^http:\/\//i, "https://");
  // garde uniquement l'URL (si du HTML a été collé)
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

function normalizePhotos(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (typeof p === "string") {
    // accepte séparateur virgule ou point-virgule
    return p.split(/[;,]\s*/).filter(Boolean);
  }
  return [];
}

function makeImg(src, alt = "photo", { priority = "low", lazy = true } = {}) {
  const url = cleanPhotoUrl(src);
  if (!url) return null;

  const img = document.createElement("img");
  img.alt = alt;
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    img.style.display = "none";
  };

  // priorité réseau (Chrome/Edge/Opera + Safari récents)
  img.setAttribute("fetchpriority", priority);
  img.fetchPriority = priority;

  if (lazy) img.loading = "lazy";

  if (lazy && "IntersectionObserver" in window) {
    // tiny placeholder pour déclencher la mise en page instantanément
    img.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    img.dataset.src = url;
    ensureImgObserver().observe(img);
  } else {
    // images prioritaires / peu nombreuses : on charge tout de suite
    img.src = url;
  }
  return img;
}

let __imgObserver = null;
function ensureImgObserver() {
  if (__imgObserver) return __imgObserver;
  __imgObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const real = img.dataset.src;
        if (real) {
          img.src = real;
          img.removeAttribute("data-src");
        }
        obs.unobserve(img);
      });
    },
    { rootMargin: "800px 0px", threshold: 0.01 }
  ); // précharge ~800px avant
  return __imgObserver;
}

/*---------------------------------------
  CARTE PRINCIPALE (Fragments)
  (déjà initialisée ci-dessus)
---------------------------------------*/

/*---------------------------------------
  BASCULE TOULOUSE / MONTREUIL
---------------------------------------*/
function toggleLocation() {
  const locationButton = document.getElementById("toggle-location-btn");

  // Choisir/initialiser la carte cible selon la vue courante
  let targetMap = map; // défaut: carte "Fragments"

  if (currentView === "patterns-map") {
    // S'assure que la carte patterns existe
    initPatternMapOnce?.();
    if (patternMap) targetMap = patternMap; // << plus de window.
  } else if (currentView === "unit" || currentView === "unit-view") {
    // S'assure que la carte unité existe
    ensureUnitMap?.();
    if (unitMap) targetMap = unitMap; // << plus de window.
  }

  // Bascule de localisation
  if (currentLocation === "montreuil") {
    targetMap.setView([43.5675824, 1.4000176], 15); // Toulouse
    if (locationButton) locationButton.textContent = "Voir Montreuil";
    currentLocation = "toulouse";
  } else {
    targetMap.setView([48.871, 2.433], 15); // Montreuil
    if (locationButton) locationButton.textContent = "Voir Toulouse";
    currentLocation = "montreuil";
  }
}

/*---------------------------------------
 SIDEBARS CLASSIQUES (spatial/discours)
  (les panneaux riches sont gérés par les onglets — Partie 2)
---------------------------------------*/
function openSidebar(el) {
  if (!el) return;
  el.style.display = "block";
  el.style.position = "fixed";
  el.style.top = "90px";
  el.style.right = "10px";
  el.style.maxHeight = "calc(100vh - 120px)";
  el.style.overflowY = "auto";
  el.style.zIndex = "4001"; // au-dessus du footer & panes
}

// Helper central qui route vers les bons panneaux (Partie 2)
function showDetails(props) {
  clearAllTabbedTabs(); // exclusif : 1 clic = 1 set d’infos (fonction en Partie 2)

  if (props.isPattern) {
    const key = props.patternKey || "Pattern";
    openTab({
      // openTab / renderPatternPanel en Partie 2
      id: `pattern-${key}`,
      title: key,
      kind: "pattern",
      render: (panel) =>
        renderPatternPanel(panel, key, {
          criteria: props.criteria || {},
          elements: props.elements || [],
        }),
    });
  } else if (props.isDiscourse) {
    openTab({
      // renderDiscoursePanel en Partie 2
      id: `disc-${props.id || Math.random().toString(36).slice(2)}`,
      title: props.id || "Discours",
      kind: "discourse",
      render: (panel) => renderDiscoursePanel(panel, props),
    });
  } else {
    const fid = props.id || Math.random().toString(36).slice(2);
    openTab({
      // renderFragmentPanel en Partie 2
      id: `frag-${fid}`,
      title: props.id || "Fragment",
      kind: "fragment",
      render: (panel) => renderFragmentPanel(panel, props),
    });
  }

  // masque les anciennes sidebars (sécurité)
  const sb1 = document.getElementById("spatial-sidebar");
  const sb2 = document.getElementById("discourse-sidebar");
  if (sb1) sb1.style.display = "none";
  if (sb2) sb2.style.display = "none";
}

function closeSidebars() {
  const sb1 = document.getElementById("spatial-sidebar");
  const sb2 = document.getElementById("discourse-sidebar");
  if (sb1) sb1.style.display = "none";
  if (sb2) sb2.style.display = "none";
  clearAllTabbedTabs(); // (Partie 2)
}

/*---------------------------------------
  8) FILTRES + RECALCUL PATTERNS
---------------------------------------*/
function applyFilters() {
  const showDiscourses = true; // aujourd’hui: on affiche tjs les discours
  const activeZones = Array.from(
    document.querySelectorAll(".filter-zone:checked")
  ).map((cb) => cb.value);

  allLayers.forEach((layer) => {
    const props = layer.feature.properties;
    const isDiscourse = props.isDiscourse;

    const showLayer = isDiscourse
      ? showDiscourses
      : activeZones.includes(layer.zone);
    if (showLayer) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  });

  // recalcul patterns sur les éléments visibles (hors discours)
  const visibleFeatures = allLayers
    .filter((layer) => map.hasLayer(layer))
    .map((layer) => layer.feature)
    .filter((f) => !f.properties.isDiscourse);

  patterns = identifyPatterns(visibleFeatures);

  // rafraîchit autres vues selon currentView (les fonctions sont en Partie 2)
  if (
    currentView === "proxemic" ||
    currentView === "gallery" ||
    currentView === "gallery-compose"
  ) {
    const visibleFeatures = allLayers
      .filter((layer) => map.hasLayer(layer))
      .map((layer) => layer.feature);
    patterns = identifyPatterns(visibleFeatures);
    if (currentView === "gallery") showGalleryView();
    else if (currentView === "proxemic") showProxemicView();
    else if (currentView === "gallery-compose") showGalleryComposeView();
  }
}

// écoute modifications des checkboxes de zones
document.querySelectorAll(".filter-zone").forEach((cb) => {
  cb.addEventListener("change", () => {
    applyFilters();

    if (currentView === "proxemic" || currentView === "gallery") {
      const visibleFeatures = allLayers
        .filter((layer) => map.hasLayer(layer))
        .map((layer) => layer.feature);
      patterns = identifyPatterns(visibleFeatures);
      if (currentView === "gallery") showGalleryView();
      else if (currentView === "proxemic") showProxemicView();
    } else if (currentView === "critical") {
      showCriticalView(); // (Partie 2)
    }

    if (currentView === "patterns-map") {
      renderPatternBaseGrey(); // (Partie 2)
      const visible = [...dataGeojson, ...datamGeojson].filter(
        (f) => isFeatureInActiveZones(f) && !f.properties.isDiscourse
      );
      patterns = identifyPatterns(visible);
      clearSticky();
      refreshPatternsMap(); // (Partie 2)
    }
  });
});

/*---------------------------------------
  9) BITMASKS CRITÈRES (perf + utils)
---------------------------------------*/

const CRITERIA_KEYS = [
  "frequence_usage_aucun",
  "frequence_usage_ponctuel",
  "frequence_usage_regulier",
  "frequence_usage_quotidien",
  "mode_usage_prevu",
  "mode_usage_detourne",
  "mode_usage_creatif",
  "intensite_usage_aucun",
  "intensite_usage_faible",
  "intensite_usage_moyenne",
  "intensite_usage_forte",
  "intensite_usage_saturee",
  "echelle_micro",
  "echelle_meso",
  "echelle_macro",
  "origine_forme_institutionnelle",
  "origine_forme_singuliere",
  "origine_forme_collective",
  "accessibilite_libre",
  "accessibilite_semi_ouverte",
  "accessibilite_fermee",
  "visibilite_cachee",
  "visibilite_visible",
  "visibilite_exposee",
  "acteurs_visibles_habitant",
  "acteurs_visibles_institution",
  "acteurs_visibles_collectif",
  "acteurs_visibles_invisible",
  "rapport_affectif_symbolique",
];

function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function maskToCriteriaDict(mask) {
  const o = {};
  CRITERIA_KEYS.forEach((key, idx) => {
    if (mask & (1 << idx)) o[key] = true;
  });
  return o;
}

function criteriaDictToMask(dict) {
  let mask = 0;
  CRITERIA_KEYS.forEach((key, idx) => {
    if (dict && dict[key]) mask |= 1 << idx;
  });
  return mask;
}

function diffCriteria(patternMask, fragMask) {
  const shared = patternMask & fragMask; // communs
  const different = fragMask & ~patternMask; // dans fragment mais pas pattern
  return { shared, different };
}

function badgesFromMask(mask, className) {
  const frag = document.createDocumentFragment();
  let hasAny = false;
  CRITERIA_KEYS.forEach((key, idx) => {
    if (mask & (1 << idx)) {
      hasAny = true;
      const span = document.createElement("span");
      span.className = `crit-badge ${className}`;
      span.textContent = key.replace(/_/g, " ");
      frag.appendChild(span);
    }
  });
  if (!hasAny) {
    const span = document.createElement("span");
    span.className = "crit-empty";
    span.textContent = "—";
    frag.appendChild(span);
  }
  return frag;
}

/*---------------------------------------
  9-bis) DIMENSIONS ACTIVABLES (UI → masque)
---------------------------------------*/

// 1) Définir quelles clés appartiennent à chaque dimension
const DIM_TO_KEYS = {
  frequence_usage: [
    "frequence_usage_ponctuel",
    "frequence_usage_regulier",
    "frequence_usage_quotidien",
  ],
  mode_usage: ["mode_usage_prevu", "mode_usage_detourne", "mode_usage_creatif"],
  intensite_usage: [
    // on ne met PAS "intensite_usage_aucun" (clé technique éventuelle)
    "intensite_usage_faible",
    "intensite_usage_moyenne",
    "intensite_usage_forte",
    "intensite_usage_saturee",
  ],
  echelle: ["echelle_micro", "echelle_meso", "echelle_macro"],
  origine_forme: [
    "origine_forme_institutionnelle",
    "origine_forme_singuliere",
    "origine_forme_collective",
  ],
  accessibilite: [
    "accessibilite_libre",
    "accessibilite_semi_ouverte",
    "accessibilite_fermee",
  ],
  visibilite: ["visibilite_cachee", "visibilite_visible", "visibilite_exposee"],
  acteurs_visibles: [
    "acteurs_visibles_habitant",
    "acteurs_visibles_institution",
    "acteurs_visibles_collectif",
    "acteurs_visibles_invisible",
  ],
  rapport_affectif_symbolique: ["rapport_affectif_symbolique"],
};

// 2) Pré-calcul : bitmask par dimension (pour aller vite)
const DIM_MASK = {};
Object.entries(DIM_TO_KEYS).forEach(([dim, keys]) => {
  let m = 0;
  keys.forEach((k) => {
    const idx = CRITERIA_KEYS.indexOf(k);
    if (idx >= 0) m |= 1 << idx;
  });
  DIM_MASK[dim] = m;
});

// 3) Par défaut : toutes les dimensions sont actives ⇒ masque = union de toutes
let criteriaEnabledMask = Object.values(DIM_MASK).reduce(
  (acc, m) => acc | m,
  0
);

// 4) Base mask (par fragment) calculé une seule fois, puis "fenêtré" par le masque actif
const BASE_MASK_BY_ID = new Map();
function buildBaseMaskFor(feature) {
  const id = feature.properties.id;
  if (BASE_MASK_BY_ID.has(id)) return BASE_MASK_BY_ID.get(id);
  let mask = 0;
  CRITERIA_KEYS.forEach((key, idx) => {
    if (feature.properties[key] === true) mask |= 1 << idx;
  });
  BASE_MASK_BY_ID.set(id, mask);
  return mask;
}

// ⇨ remplacer l’ancien buildMaskFor(...) par cette fonction d’accès
function getActiveMaskFor(feature) {
  const base = buildBaseMaskFor(feature);
  return base & criteriaEnabledMask;
}

/*---------------------------------------
  9-ter) LISTENERS UI des dimensions
---------------------------------------*/
function rebuildCriteriaEnabledMaskFromUI() {
  let m = 0;
  document.querySelectorAll("#criteria-legend .crit-dim").forEach((cb) => {
    const dim = cb.getAttribute("data-dim");
    if (cb.checked && DIM_MASK[dim] !== undefined) {
      m |= DIM_MASK[dim];
    }
  });
  criteriaEnabledMask = m;
}

function recomputePatternsAndRefreshViews() {
  // Recalcule la liste des features visibles selon la vue
  const visible = [...(dataGeojson || []), ...(datamGeojson || [])]
    .filter((f) => (isFeatureInActiveZones ? isFeatureInActiveZones(f) : true))
    .filter((f) => !f.properties?.isDiscourse);

  patterns = identifyPatterns(visible);

  // Rafraîchit la vue courante
  if (currentView === "gallery") showGalleryView();
  else if (currentView === "proxemic") showProxemicView();
  else if (currentView === "patterns-map") {
    renderPatternBaseGrey();
    refreshPatternsMap();
  } else if (currentView === "gallery-compose") showGalleryComposeView();
}

function hookLegendCheckboxes() {
  document.querySelectorAll("#criteria-legend .crit-dim").forEach((cb) => {
    cb.addEventListener("change", () => {
      rebuildCriteriaEnabledMaskFromUI();
      recomputePatternsAndRefreshViews();
    });
  });
}

// Quand le DOM est prêt, on accroche les listeners
document.addEventListener("DOMContentLoaded", () => {
  hookLegendCheckboxes();
  rebuildCriteriaEnabledMaskFromUI(); // init (tout coché)
});

/*---------------------------------------
 10) DÉTECTION DES PATTERNS (similarité)
---------------------------------------*/
function identifyPatterns(features) {
  const used = new Set();
  const groups = [];
  let groupIndex = 1;

  for (let i = 0; i < features.length; i++) {
    const f1 = features[i],
      id1 = f1.properties.id;
    if (used.has(id1)) continue;
    const m1 = getActiveMaskFor(f1);

    for (let j = i + 1; j < features.length; j++) {
      const f2 = features[j],
        id2 = f2.properties.id;
      if (used.has(id2)) continue;
      const m2 = getActiveMaskFor(f2);

      const sharedMask = m1 & m2;
      const sharedCount = popcount32(sharedMask);
      if (sharedCount !== patternThreshold) continue;

      const group = {
        name: `P${groupIndex++}`,
        elements: [id1, id2],
        criteria: maskToCriteriaDict(sharedMask),
      };

      // Ajoute tous les f_k qui incluent strictement ces critères partagés
      for (let k = 0; k < features.length; k++) {
        const f3 = features[k],
          id3 = f3.properties.id;
        if (group.elements.includes(id3)) continue;
        const m3 = getActiveMaskFor(f3);
        if ((m3 & sharedMask) === sharedMask) group.elements.push(id3);
      }

      group.elements.forEach((id) => used.add(id));
      groups.push(group);
    }
  }

  const result = {};
  patternNames = {};
  groups.forEach((g) => {
    result[g.name] = g;
    patternNames[g.name] = g.name;
  });
  return result;
}

/*---------------------------------------
 11) CHARGEMENT DES DONNÉES GEOJSON
---------------------------------------*/
// Contours (non interactifs)
fetch("data/contour.geojson")
  .then((r) => r.json())
  .then((data) => {
    L.geoJSON(data, {
      style: { color: "#919090", weight: 2, opacity: 0.8, fillOpacity: 0 },
      interactive: false,
    }).addTo(map);
  });

// Fragments Montreuil + Mirail
Promise.all([
  fetch("data/data.geojson").then((r) => r.json()),
  fetch("data/datam.geojson").then((r) => r.json()),
]).then(([data, dataM]) => {
  dataGeojson = data.features;
  datamGeojson = dataM.features;

  // Montreuil
  L.geoJSON(
    { type: "FeatureCollection", features: dataGeojson },
    {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 4,
          color: "red",
          weight: 1,
          opacity: 1,
          fillColor: "red",
          fillOpacity: 0.8,
        }),
      style: () => ({ color: "red", weight: 0.9, fillOpacity: 0.3 }),
      onEachFeature: (feature, layer) => {
        layer.zone = "montreuil";
        allLayers.push(layer);
        layer.on("click", () => showDetails(feature.properties));
      },
    }
  ).addTo(map);

  // Mirail
  L.geoJSON(
    { type: "FeatureCollection", features: datamGeojson },
    {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 4,
          color: "blue",
          weight: 1,
          opacity: 1,
          fillColor: "blue",
          fillOpacity: 0.8,
        }),
      style: () => ({ color: "blue", weight: 0.9, fillOpacity: 0.3 }),
      onEachFeature: (feature, layer) => {
        layer.zone = "mirail";
        allLayers.push(layer);
        layer.on("click", () => showDetails(feature.properties));
      },
    }
  ).addTo(map);

  // Calcul initial des patterns (toutes zones)
  const allSpatialFeatures = [...dataGeojson, ...datamGeojson].filter(
    (f) => !f.properties.isDiscourse
  );
  patterns = identifyPatterns(allSpatialFeatures);
  combinedFeatures = [...dataGeojson, ...datamGeojson];

  // Si la carte patterns est déjà affichée, force un 1er rendu (Partie 2)
  if (currentView === "patterns-map") {
    initPatternMapOnce();
    renderPatternBaseGrey();
    refreshPatternsMap();
  }
});

// Discours (pane dédié + grande zone cliquable transparente)
fetch("data/discours.geojson")
  .then((res) => res.json())
  .then((data) => {
    discoursLayer = L.geoJSON(data, {
      pane: "pane-discours",
      pointToLayer: (feature, latlng) => {
        const visible = L.circleMarker(latlng, {
          radius: 5,
          fillColor: "white",
          color: "white",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8,
          pane: "pane-discours",
        });
        const clickableArea = L.circle(latlng, {
          radius: 30,
          color: "transparent",
          fillColor: "transparent",
          weight: 0,
          fillOpacity: 0,
          pane: "pane-discours",
        });
        clickableArea.on("click", () => showDetails(feature.properties));
        visible.on("click", () => showDetails(feature.properties));
        return L.layerGroup([clickableArea, visible]);
      },
      onEachFeature: (feature, layerGroup) => {
        allLayers.push(layerGroup);
        layerGroup.feature = feature;
      },
    });

    discoursLayer.addTo(map);
    applyFilters(); // pour respecter l’état des checkboxes
  });

/*==================================================
=                SIDEBAR À ONGLETS                 =
==================================================*/
const Tabbed = {
  el: null,
  tabsBar: null,
  content: null,
  openTabs: new Map(), // id -> {btn, panel, kind}
  activeId: null,
};

function ensureTabbedSidebar() {
  if (Tabbed.el) return;
  Tabbed.el = document.getElementById("tabbed-sidebar");
  Tabbed.tabsBar = document.getElementById("tabbed-sidebar-tabs");
  Tabbed.content = document.getElementById("tabbed-sidebar-content");
}

function showTabbedSidebar() {
  ensureTabbedSidebar();
  Tabbed.el.style.display = "block";
}
function hideTabbedSidebarIfEmpty() {
  if (Tabbed.openTabs.size === 0) {
    Tabbed.el.style.display = "none";
    Tabbed.activeId = null;
  }
}

function clearAllTabbedTabs() {
  ensureTabbedSidebar();
  Array.from(Tabbed.openTabs.keys()).forEach((id) => closeTab(id));
  Tabbed.tabsBar.innerHTML = "";
  Tabbed.content.innerHTML = "";
  Tabbed.activeId = null;
  Tabbed.el.style.display = "none";

  // +++ reset du filtre pattern
  activePatternFilter = null;
}

function focusTab(id) {
  if (!Tabbed.openTabs.has(id)) return;

  Tabbed.activeId = id;
  Tabbed.openTabs.forEach((rec, key) => {
    rec.btn.style.background = key === id ? "#222" : "#000";
    rec.btn.style.color = "#fff";
    rec.panel.style.display = key === id ? "block" : "none";
  });

  // === NOUVEAU : met à jour le filtre par pattern selon l'onglet actif ===
  const rec = Tabbed.openTabs.get(id);
  if (rec?.kind === "pattern") {
    // id de forme "pattern-P7" → récupère "P7"
    const m = /^pattern-(.+)$/i.exec(id);
    activePatternFilter = m ? m[1] : null;
  } else if (rec?.kind === "fragment") {
    activePatternFilter = null; // fragment = toutes les lignes
  } else {
    // autres onglets (discours, saved, etc.) → pas de filtre
    activePatternFilter = null;
  }

  // Si on est sur la sous-vue patterns-map et qu'un fragment est sticky, on rafraîchit les traits
  if (currentView === "patterns-map" && _stickyFragId) {
    drawLinksForFragment(_stickyFragId); // utilisera activePatternFilter
    // Mise à jour du dimming en tenant compte du filtre
    if (activePatternFilter) {
      dimUnrelated(_stickyFragId, [activePatternFilter]);
    } else {
      dimUnrelated(_stickyFragId, null);
    }
  }
}

function closeTab(id) {
  const rec = Tabbed.openTabs.get(id);
  if (!rec) return;
  rec.btn.remove();
  rec.panel.remove();
  Tabbed.openTabs.delete(id);
  if (Tabbed.activeId === id) {
    const last = Array.from(Tabbed.openTabs.keys()).pop();
    if (last) focusTab(last);
  }
  hideTabbedSidebarIfEmpty();
}

function makeTabButton(title, id) {
  const btn = document.createElement("button");
  btn.textContent = title;
  btn.title = title;
  btn.style.cssText =
    "border:1px solid #333; background:#000; color:#fff; padding:6px 8px; cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:6px; border-radius:4px;";
  btn.addEventListener("click", () => focusTab(id));

  const x = document.createElement("span");
  x.textContent = "×";
  x.style.cssText =
    "display:inline-block; padding:0 4px; border-left:1px solid #333; cursor:pointer; opacity:.85;";
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(id);
  });
  btn.appendChild(x);

  return btn;
}

function makePanelContainer(id) {
  const panel = document.createElement("div");
  panel.id = `panel-${id}`;
  panel.style.display = "none";
  return panel;
}

function openTab({ id, title, kind, render, autoFocus = true }) {
  ensureTabbedSidebar();
  if (Tabbed.openTabs.has(id)) {
    focusTab(id);
    return;
  }

  const btn = makeTabButton(title, id);
  const panel = makePanelContainer(id);

  // ➜ D'abord attacher au DOM
  Tabbed.tabsBar.appendChild(btn);
  Tabbed.content.appendChild(panel);

  // ➜ Ensuite rendre le contenu (les IDs existent dans le document)
  render(panel);

  Tabbed.openTabs.set(id, { btn, panel, kind });
  showTabbedSidebar();
  if (autoFocus) focusTab(id); // ← au lieu d’appeler focusTab à tous les coups
}

/*==================================================
=    MÉTADONNÉES LOCALES PAR FRAGMENT (usage+discours) (texte)      =
==================================================*/
function getFragMetaKey(id) {
  return `fragmeta:${id}`;
}
function loadFragmentMeta(fragmentId) {
  try {
    return (
      JSON.parse(
        localStorage.getItem(getFragMetaKey(fragmentId)) || "null"
      ) || { usages: [], discours: [] }
    );
  } catch (e) {
    return { usages: [], discours: [] };
  }
}
function saveFragmentMeta(fragmentId, meta) {
  localStorage.setItem(getFragMetaKey(fragmentId), JSON.stringify(meta));
  window.dispatchEvent(
    new CustomEvent("fragmeta:updated", { detail: { fragmentId, meta } })
  );
}
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/*==================================================
=                PANNEAU FRAGMENT                  =
==================================================*/
function renderFragmentPanel(panel, props) {
  panel.innerHTML = "";

  const fragId = props.id || "—";
  const h2 = document.createElement("h2");
  h2.textContent = props.name || fragId || "Fragment";
  const pId = document.createElement("p");
  pId.innerHTML = `<strong>ID :</strong> ${fragId}`;
  const pDesc = document.createElement("p");
  pDesc.textContent = props.description || "";
  const photos = document.createElement("div");
  const photoList = normalizePhotos(props.photos);
  if (photoList.length) {
    photoList.forEach((src) => {
      const img = makeImg(src, props.name || fragId || "photo");
      if (img) {
        img.style.width = "100%";
        img.style.marginBottom = "8px";
        photos.appendChild(img);
      }
    });
  }
  panel.append(h2, pId, pDesc, photos);

  // Actions 3D
  const actions = document.createElement("div");
  actions.className = "btn-row";
  const btnOpen3D = document.createElement("button");
  btnOpen3D.className = "tab-btn btn-sm primary";
  btnOpen3D.textContent = hasFragment3D(fragId) ? "Voir la 3D" : "Importer 3D";
  btnOpen3D.addEventListener("click", () => openThreeModalForFragment(fragId));
  actions.append(btnOpen3D);
  if (hasFragment3D(fragId)) {
    const btnImport3D = document.createElement("button");
    btnImport3D.className = "tab-btn btn-sm";
    btnImport3D.textContent = "Remplacer 3D";
    btnImport3D.addEventListener("click", () =>
      promptImport3DForFragment(fragId, true)
    );
    actions.append(btnImport3D);
  }
  panel.append(actions);

  // Blocs Usages / Discours
  const meta = loadFragmentMeta(fragId);
  function makeEditorBlock(title, listKey, placeholder) {
    const box = document.createElement("div");
    box.className = "meta-box";
    const head = document.createElement("div");
    head.className = "meta-head";
    head.innerHTML = `<strong>${title}</strong>`;
    box.appendChild(head);
    const addRow = document.createElement("div");
    addRow.className = "meta-add-row";
    const ta = document.createElement("textarea");
    ta.className = "meta-ta";
    ta.rows = 3;
    ta.placeholder = placeholder;
    const addBtn = document.createElement("button");
    addBtn.className = "tab-btn btn-sm";
    addBtn.textContent = "Ajouter";
    addBtn.addEventListener("click", () => {
      const txt = ta.value.trim();
      if (!txt) return;
      meta[listKey].push({ id: uid(), text: txt });
      saveFragmentMeta(fragId, meta);
      ta.value = "";
      renderList();
    });
    addRow.append(ta, addBtn);
    box.appendChild(addRow);
    const list = document.createElement("div");
    list.className = "meta-list";
    box.appendChild(list);

    function renderList() {
      list.innerHTML = "";
      meta[listKey].forEach((item) => {
        const row = document.createElement("div");
        row.className = "meta-item";
        const left = document.createElement("div");
        left.className = "meta-item-left";
        const txt = document.createElement("div");
        txt.className = "meta-item-text";
        txt.textContent = item.text;
        txt.title = "Cliquer pour éditer";
        txt.addEventListener("click", () => {
          if (row.querySelector("textarea")) return;
          const editor = document.createElement("textarea");
          editor.className = "meta-edit";
          editor.value = item.text;
          editor.rows = Math.max(2, Math.ceil(item.text.length / 60));
          const saveBtn = document.createElement("button");
          saveBtn.className = "tab-btn btn-xs primary";
          saveBtn.textContent = "OK";
          const cancelBtn = document.createElement("button");
          cancelBtn.className = "tab-btn btn-xs";
          cancelBtn.textContent = "Annuler";
          const editRow = document.createElement("div");
          editRow.className = "meta-edit-row";
          editRow.append(editor, saveBtn, cancelBtn);
          left.replaceChild(editRow, txt);
          saveBtn.addEventListener("click", () => {
            const newTxt = editor.value.trim();
            if (newTxt) {
              item.text = newTxt;
              saveFragmentMeta(fragId, meta);
            }
            renderList();
          });
          cancelBtn.addEventListener("click", renderList);
        });
        left.appendChild(txt);
        const right = document.createElement("div");
        right.className = "meta-item-right";
        const delBtn = document.createElement("button");
        delBtn.className = "tab-btn btn-xs danger";
        delBtn.textContent = "Suppr.";
        delBtn.title = "Supprimer";
        delBtn.addEventListener("click", () => {
          meta[listKey] = meta[listKey].filter((x) => x.id !== item.id);
          saveFragmentMeta(fragId, meta);
          renderList();
        });
        right.appendChild(delBtn);
        row.append(left, right);
        list.appendChild(row);
      });
      if (!meta[listKey].length) {
        const empty = document.createElement("div");
        empty.className = "meta-empty";
        empty.textContent = "— Aucun élément pour le moment.";
        list.appendChild(empty);
      }
    }
    renderList();
    return box;
  }
  const usagesBlock = makeEditorBlock(
    "Usages",
    "usages",
    "Ex : « Lieu de réunion… »"
  );
  const discoursBlock = makeEditorBlock(
    "Discours",
    "discours",
    "Ex : « L’institution prévoit… »"
  );
  panel.append(usagesBlock, discoursBlock);
}

/*==================================================
=                PANNEAU PATTERN                   =
==================================================*/
function renderPatternPanel(panel, patternKey, patternData) {
  panel.innerHTML = "";

  const h2 = document.createElement("h2");
  h2.textContent = `${patternKey} — Pattern`;

  const crits = Object.keys(patternData.criteria || {})
    .map((c) => c.replace(/_/g, " "))
    .join(", ");
  const pCrit = document.createElement("p");
  pCrit.innerHTML = `<strong>Critères communs du pattern :</strong> ${crits || "—"}`;

  const legend = document.createElement("div");
  legend.className = "crit-legend";
  legend.innerHTML = `
    <span class="crit-badge badge-shared">partagés</span>
    <span class="crit-badge badge-different">différents</span>
  `;

  // ✅ créer les actions AVANT de faire panel.append(...)
  const actions = document.createElement("div");
  actions.className = "btn-row";
  const btnSavePattern = document.createElement("button");
  btnSavePattern.className = "tab-btn btn-sm primary";
  btnSavePattern.textContent = "Enregistrer ce pattern";
  btnSavePattern.title =
    "Sauvegarder nom, description et fragments (instantané local)";
  btnSavePattern.addEventListener("click", () =>
    openSavePatternModal(patternKey, patternData)
  );
  actions.appendChild(btnSavePattern);

  // liste des membres
  const list = document.createElement("div");
  list.className = "pattern-members";

  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map((f) => [f.properties.id, f]));
  const patternMask = criteriaDictToMask(patternData.criteria || {});

  (patternData.elements || []).forEach((id) => {
    const f = byId.get(id);
    const row = document.createElement("div");
    row.className = "member-row";

    const thumb = document.createElement("div");
    thumb.className = "member-thumb";
    const first = cleanPhotoUrl(normalizePhotos(f?.properties?.photos)[0]);
    if (first) thumb.style.backgroundImage = `url("${first}")`;

    const title = document.createElement("div");
    title.className = "member-title";
    title.textContent = f?.properties?.name || id;

    const why = document.createElement("div");
    why.className = "member-why";
    const fragMask = f ? getActiveMaskFor(f) : 0;
    const { shared, different } = diffCriteria(patternMask, fragMask);

    const rowShared = document.createElement("div");
    rowShared.className = "crit-row";
    rowShared.innerHTML = `<span class="crit-label">Partagés</span>`;
    rowShared.appendChild(badgesFromMask(shared, "badge-shared"));

    const rowDifferent = document.createElement("div");
    rowDifferent.className = "crit-row";
    rowDifferent.innerHTML = `<span class="crit-label">Différents</span>`;
    rowDifferent.appendChild(badgesFromMask(different, "badge-different"));

    row.addEventListener("click", () => showDetails(f?.properties || { id }));

    why.append(rowShared, rowDifferent);
    const right = document.createElement("div");
    right.className = "member-right";
    right.append(title, why);

    row.append(thumb, right);
    list.appendChild(row);
  });

  // tout ajouter au panel
  panel.append(h2, pCrit, legend, actions, list);
}

/*==================================================
=                PANNEAU DISCOURS                  =
==================================================*/
function renderDiscoursePanel(panel, props) {
  panel.innerHTML = "";
  const h2 = document.createElement("h2");
  h2.textContent = props.id || "Discours";
  const pA = document.createElement("p");
  pA.innerHTML = `<strong>Auteur :</strong> ${props.auteur || ""}`;
  const pD = document.createElement("p");
  pD.innerHTML = `<strong>Date :</strong> ${props.date || ""}`;
  const pS = document.createElement("p");
  const src = props.source || "";
  pS.innerHTML = `<strong>Source :</strong> ${src && String(src).startsWith("http") ? `<a href="${src}" target="_blank">${src}</a>` : src}`;
  const pT = document.createElement("p");
  pT.textContent = props.contenu || "";
  panel.append(h2, pA, pD, pS, pT);
}

/*==================================================
=                    VUE GALERIE                   =
==================================================*/
function showGalleryView() {
  const gallery = document.getElementById("gallery-view");
  gallery.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "gallery-wrapper";
  gallery.appendChild(wrapper);

  Object.entries(patterns).forEach(([key, pattern]) => {
    const block = document.createElement("section");
    block.className = "pattern-block";
    const title = document.createElement("h3");
    const crits = Object.keys(pattern.criteria)
      .map((c) => c.replace(/_/g, " "))
      .join(", ");
    title.className = "pattern-title";
    title.textContent = `${key} — Critères : ${crits}`;
    const grid = document.createElement("div");
    grid.className = "photo-grid";
    [...dataGeojson, ...datamGeojson].forEach((feature) => {
      if (
        pattern.elements.includes(feature.properties.id) &&
        feature.properties.photos?.length
      ) {
        feature.properties.photos.forEach((photo) => {
          const cell = document.createElement("div");
          cell.className = "photo-cell";
          const img = makeImg(
            photo,
            feature.properties.name || feature.properties.id || "photo"
          );
          if (img) {
            img.onclick = () => showDetails(feature.properties);
            cell.appendChild(img);
            grid.appendChild(cell);
          }
        });
      }
    });
    block.append(title, grid);
    wrapper.appendChild(block);
  });
}

/*==================================================
=                  VUE PROXÉMIQUE                  =
==================================================*/
function showProxemicView() {
  // Nettoie la vue
  proxemicView.innerHTML = "";

  // Dimensions de la surface
  const viewWidth = proxemicView.clientWidth || window.innerWidth;
  const viewHeight = proxemicView.clientHeight || window.innerHeight;

  // --- Paramètres visuels (resserrés, sans bordures)
  const TILE_W = 60; // largeur d’une vignette (px)
  const TILE_H = 45; // hauteur d’une vignette (px) => format 4:3
  const GAP = 2; // espace entre vignettes (px)
  const PAD = 2; // marge intérieure du cluster (px)
  const COLLIDE_PAD = 2; // marge collision (px) => clusters plus proches

  // Catégories (mêmes clés qu'avant)
  const categories = {
    percu: [
      "frequence_usage_ponctuel",
      "frequence_usage_regulier",
      "frequence_usage_quotidien",
      "mode_usage_prevu",
      "mode_usage_detourne",
      "mode_usage_creatif",
      "intensite_usage_faible",
      "intensite_usage_moyenne",
      "intensite_usage_forte",
      "intensite_usage_saturee",
    ],
    concu: [
      "echelle_micro",
      "echelle_meso",
      "echelle_macro",
      "origine_forme_institutionnelle",
      "origine_forme_singuliere",
      "origine_forme_collective",
      "accessibilite_libre",
      "accessibilite_semi_ouverte",
      "accessibilite_fermee",
      "visibilite_cachee",
      "visibilite_visible",
      "visibilite_exposee",
    ],
    vecu: [
      "acteurs_visibles_habitant",
      "acteurs_visibles_institution",
      "acteurs_visibles_collectif",
      "acteurs_visibles_invisible",
      "rapport_affectif_symbolique",
    ],
  };
  function getDominantCategory(criteria) {
    const counts = { percu: 0, concu: 0, vecu: 0 };
    for (const key of Object.keys(criteria || {})) {
      if (categories.percu.includes(key)) counts.percu++;
      if (categories.concu.includes(key)) counts.concu++;
      if (categories.vecu.includes(key)) counts.vecu++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Positions cibles des 3 pôles
  const positions = {
    percu: { x: viewWidth * 0.25, y: viewHeight * 0.35 },
    concu: { x: viewWidth * 0.75, y: viewHeight * 0.35 },
    vecu: { x: viewWidth * 0.5, y: viewHeight * 0.8 },
  };

  // Accès rapide aux features par id (pour récupérer la 1re photo)
  const allFeatures = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(allFeatures.map((f) => [f.properties.id, f]));

  function firstPhotoSrc(fragmentId) {
    const f = byId.get(fragmentId);
    const list = normalizePhotos(f?.properties?.photos);
    return cleanPhotoUrl(list[0] || "");
  }

  // Calcule une grille compacte (cols ~ sqrt(n))
  function gridDims(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }

  // Prépare les "nodes" (1 node = 1 pattern) avec dimensions du cluster
  const nodes = Object.entries(patterns || {}).map(([key, pattern]) => {
    const n = (pattern.elements || []).length;
    const { cols, rows } = gridDims(Math.max(n, 1));
    const w = cols * TILE_W + (cols - 1) * GAP;
    const h = rows * TILE_H + (rows - 1) * GAP;
    const category = getDominantCategory(pattern.criteria);
    return {
      id: key,
      criteria: pattern.criteria || {},
      elements: pattern.elements || [],
      category,
      cols,
      rows,
      w,
      h,
      x: positions[category].x + (Math.random() - 0.5) * 20,
      y: positions[category].y + (Math.random() - 0.5) * 20,
    };
  });

  // Surface zoomable
  const svgWidth = viewWidth * 2.2;
  const svgHeight = viewHeight * 2.2;

  const svg = d3
    .select("#proxemic-view")
    .append("svg")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
    .call(
      d3.zoom().on("zoom", (event) => {
        root.attr("transform", event.transform);
      })
    );

  const root = svg.append("g");

  // Simulation : clusters plus resserrés (forces plus fortes, faible padding)
  const collideRadius = (d) =>
    0.5 * Math.hypot(d.w + 2 * PAD, d.h + 2 * PAD) + COLLIDE_PAD;
  const simulation = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((d) => positions[d.category].x).strength(0.45))
    .force("y", d3.forceY((d) => positions[d.category].y).strength(0.45))
    .force("collide", d3.forceCollide(collideRadius).iterations(2))
    .stop();

  for (let i = 0; i < 160; ++i) simulation.tick();

  // Couches : clusters + overlay UI pour les étiquettes pôles (au-dessus)
  const clustersLayer = root.append("g").attr("class", "clusters");
  const labelsLayer = root
    .append("g")
    .attr("class", "ui-overlay")
    .style("pointer-events", "none");

  // Groupes "cluster" (1 par pattern)
  const clusters = clustersLayer
    .selectAll(".pattern-node")
    .data(nodes)
    .join("g")
    .attr("class", "pattern-node")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (_ev, d) => {
      showDetails({
        isPattern: true,
        patternKey: d.id,
        elements: d.elements,
        criteria: d.criteria,
      });
    });

  // Fond du cluster — sans bordure
  clusters
    .append("rect")
    .attr("x", (d) => -(d.w / 2) - PAD)
    .attr("y", (d) => -(d.h / 2) - PAD)
    .attr("width", (d) => d.w + 2 * PAD)
    .attr("height", (d) => d.h + 2 * PAD)
    .attr("fill", "#0f0f0f")
    .attr("stroke", "none");

  // Grille d’images (SVG <image>) + cases grises sans image
  clusters.each(function (d) {
    const g = d3
      .select(this)
      .append("g")
      .attr("transform", `translate(${-d.w / 2},${-d.h / 2})`);

    const tiles = d.elements.map((id, i) => ({
      id,
      col: i % d.cols,
      row: Math.floor(i / d.cols),
      src: firstPhotoSrc(id),
    }));

    // Cases sans image : carré gris (aucune bordure)
    g.selectAll("rect.tile-bg")
      .data(tiles)
      .join("rect")
      .attr("class", "tile-bg")
      .attr("x", (t) => t.col * (TILE_W + GAP))
      .attr("y", (t) => t.row * (TILE_H + GAP))
      .attr("width", TILE_W)
      .attr("height", TILE_H)
      .attr("fill", "#2a2a2a")
      .attr("stroke", "none");

    // Images (aucune bordure non plus)
    g.selectAll("image.tile-img")
      .data(tiles.filter((t) => t.src))
      .join("image")
      .attr("class", "tile-img")
      .attr("x", (t) => t.col * (TILE_W + GAP))
      .attr("y", (t) => t.row * (TILE_H + GAP))
      .attr("width", TILE_W)
      .attr("height", TILE_H)
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("href", (t) => t.src);
  });


  // Étiquettes des 3 pôles — placées en OVERLAY (toujours devant)
  function addLabelWithBackground(layer, x, y, textContent) {
    const group = layer.append("g").attr("transform", `translate(${x}, ${y})`);
    const text = group
      .append("text")
      .text(textContent)
      .attr("x", 0)
      .attr("y", 0)
      .style("fill", "#fff")
      .style("font-size", "16px")
      .style("font-weight", "800")
      .style("text-anchor", "middle")
      .attr("dominant-baseline", "middle");
    const bbox = text.node().getBBox();
    group
      .insert("rect", "text")
      .attr("x", bbox.x - 8)
      .attr("y", bbox.y - 4)
      .attr("width", bbox.width + 16)
      .attr("height", bbox.height + 8)
      .attr("fill", "rgba(0,0,0,0.85)")
      .attr("rx", 4)
      .attr("ry", 4);
  }
  addLabelWithBackground(
    labelsLayer,
    positions.percu.x,
    positions.percu.y - 80,
    "Espace perçu"
  );
  addLabelWithBackground(
    labelsLayer,
    positions.concu.x,
    positions.concu.y - 80,
    "Espace conçu"
  );
  addLabelWithBackground(
    labelsLayer,
    positions.vecu.x,
    positions.vecu.y + 80,
    "Espace vécu"
  );

  labelsLayer.raise();
}

/*==================================================
=               GESTION DES VUES (UI)              =
==================================================*/
function setView(viewId) {
  currentView = viewId;
  const views = {
    map: document.getElementById("map"),
    proxemic: document.getElementById("proxemic-view"),
    gallery: document.getElementById("gallery-view"),
    critical: document.getElementById("critical-view"),
  };
  Object.entries(views).forEach(([key, el]) => {
    el.style.display = key === viewId ? "block" : "none";
  });
  if (viewId === "proxemic") showProxemicView();
  if (viewId === "gallery") showGalleryView();
  if (viewId === "critical") showCriticalView();
  updateInterfaceElements(viewId);
}

function updateInterfaceElements(viewId) {
  const legendBtn = document.getElementById("toggle-legend-btn");
  const locationBtn = document.getElementById("toggle-location-btn");
  const similarityControls = document.getElementById("similarity-controls");

  // La légende est utile pour ces vues (mais pas pour Analogies)
  const wantsLegend =
    viewId === "proxemic" ||
    viewId === "gallery" ||
    viewId === "gallery-compose" ||
    viewId === "patterns-map";

  if (legendBtn) legendBtn.style.display = wantsLegend ? "block" : "none";
  if (locationBtn)
    locationBtn.style.display =
      viewId === "map" || viewId === "patterns-map" || viewId === "unit"
        ? "block"
        : "none";

// Le slider de similarité n’apparaît PAS sur Analogies ni sur Composition
if (similarityControls) {
  similarityControls.style.display =
    (viewId === "analogies" || viewId === "gallery-compose")
      ? "none"
      : wantsLegend
        ? "block"
        : similarityControls.style.display;
}
}

const topTabs = document.querySelectorAll(".top-tab");
const subnav = document.getElementById("subnav-patterns");
const subTabs = document.querySelectorAll(".sub-tab");

const VIEWS = {
  fragments: "map",
  unit: "unit-view",
  sub: {
    "patterns-map": "patterns-map",
    proxemic: "proxemic-view",
    gallery: "gallery-view",
    "gallery-compose": "gallery-compose-view",
    analogies: "analogies-view",
  },
};

function showView(viewId) {
  document.querySelectorAll(".view").forEach((v) => {
    if (!v) return;
    v.style.display = v.id === viewId ? "block" : "none";
  });
  if (viewId === "map" && map?.invalidateSize)
    setTimeout(() => map.invalidateSize(), 0);
  if (viewId === "unit-view" && unitMap?.invalidateSize)
    setTimeout(() => unitMap.invalidateSize(), 0);
}

function setTopTab(name) {
  topTabs.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.top === name)
  );
  if (name === "patterns") {
    subnav.classList.remove("subnav--inactive");
    const currentActiveSub =
      document.querySelector(".sub-tab.active")?.dataset.sub || "proxemic";
    setSubTab(currentActiveSub);
  } else {
    subnav.classList.add("subnav--inactive");
    subTabs.forEach((btn) => btn.classList.remove("active"));
    if (name === "fragments") {
      currentView = "map";
      showView(VIEWS.fragments);
    }
    if (name === "unit") {
      currentView = "unit";
      showView(VIEWS.unit);
      ensureUnitMap();
      renderAllUnits();
    }
    updateInterfaceElements(currentView);
  }
  if (unitCreation.active && name !== "patterns") stopUnitCreation();

  const similarityControls = document.getElementById("similarity-controls");
  similarityControls.style.display = name === "patterns" ? "block" : "none";
}

function setSubTab(subName) {
  if (unitCreation.active && subName !== "patterns-map") stopUnitCreation();

  if (subName === "proxemic") currentView = "proxemic";
  else if (subName === "gallery") currentView = "gallery";
  else if (subName === "patterns-map") currentView = "patterns-map";
  else if (subName === "gallery-compose") currentView = "gallery-compose";
  else if (subName === "analogies") currentView = "analogies";

  subTabs.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.sub === subName)
  );
  const viewId = VIEWS.sub[subName];
  showView(viewId);

  // --- rendu de la sous-vue ---
  if (subName === "patterns-map") {
    initPatternMapOnce();
    setTimeout(() => patternMap.invalidateSize(), 0);
    clearSticky();
    renderPatternBaseGrey();
    refreshPatternsMap();
  } else if (subName === "proxemic") {
    showProxemicView();
  } else if (subName === "gallery") {
    showGalleryView();
  } else if (subName === "gallery-compose") {
    showGalleryComposeView();
  } else if (subName === "analogies") {
    initAnalogiesOnce();
    showAnalogiesView();
  }

  // --- 🔎 slider de similarité : pas sur "Composition" ---
  const similarityControls = document.getElementById("similarity-controls");
  similarityControls.style.display =
    subName === "gallery-compose" ? "none" : "block";

  updateInterfaceElements(currentView);
}

function maybeHideTabbedOnViewChange() {
  if (currentView !== "patterns-map" && Tabbed?.el) {
    Tabbed.openTabs?.forEach((_rec, id) => closeTab(id));
    Tabbed.el.style.display = "none";
  }
}

// Listeners onglets
topTabs.forEach((btn) =>
  btn.addEventListener("click", () => setTopTab(btn.dataset.top))
);
subTabs.forEach((btn) =>
  btn.addEventListener("click", () => setSubTab(btn.dataset.sub))
);

// État initial
setTopTab("fragments");
currentView = "map";
updateInterfaceElements("map");

/*==================================================
=                  ABOUT (Info)                    =
==================================================*/
document.addEventListener("DOMContentLoaded", () => {
  const infoBtn = document.getElementById("info-btn");
  const aboutBox = document.getElementById("about");
  function toggleAbout() {
    const isOpen = aboutBox.style.display === "block";
    aboutBox.style.display = isOpen ? "none" : "block";
    if (infoBtn)
      infoBtn.setAttribute("aria-expanded", isOpen ? "false" : "true");
  }
  if (infoBtn) infoBtn.addEventListener("click", toggleAbout);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && aboutBox.style.display === "block") toggleAbout();
  });
});

/*==================================================
=          SLIDER SEUIL DE SIMILARITÉ              =
==================================================*/
function debounce(fn, delay = 160) {
  let t;
  return function (...args) {
    const ctx = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), delay);
  };
}
const sliderEl = document.getElementById("similarity-slider");
sliderEl.addEventListener(
  "input",
  debounce(function (e) {
    const value = parseInt(e.target.value, 10);
    patternThreshold = value;
    document.getElementById("slider-value").textContent = value;
    const visible = [...(dataGeojson || []), ...(datamGeojson || [])]
      .filter((f) =>
        isFeatureInActiveZones ? isFeatureInActiveZones(f) : true
      )
      .filter((f) => !f.properties?.isDiscourse);
    patterns = identifyPatterns(visible);
    if (currentView === "gallery") showGalleryView();
    else if (currentView === "proxemic") showProxemicView();
    else if (currentView === "patterns-map") {
      renderPatternBaseGrey();
      clearSticky();
      refreshPatternsMap();
    }
  }, 160)
);

/*==================================================
=        CARTE PATTERNS : INIT + COULEURS          =
==================================================*/
let patternMap = null;
let patternBaseLayer = null; // fragments gris

/* ===== Images + liens (vue Patterns-Map) ===== */
let patternImageLayer = null; // vignettes image (fragments dans au moins un pattern)
let patternLinkLayer = null; // traits fins colorés "fragment ⇄ autres du même pattern"
let _fragCenterCache = new Map(); // id -> L.LatLng (perf)
let _stickyFragId = null; // "clic pour stabiliser"

const PATTERN_COLORS = Object.fromEntries(
  Array.from({ length: 120 }, (_, i) => {
    const hue = Math.round((i * 137.508) % 360); // répartition uniforme
    const sat = 88; // saturation fixe
    const lit = 62; // luminance fixe (lisible sur fond sombre)
    return [`P${i + 1}`, `hsl(${hue}, ${sat}%, ${lit}%)`];
  })
);

function colorForPattern(pName) {
  if (PATTERN_COLORS[pName]) return PATTERN_COLORS[pName];
  const n = parseInt(String(pName).replace(/^P/i, ""), 10);
  if (Number.isFinite(n)) {
    const idx = ((n - 1) % 100) + 1;
    return PATTERN_COLORS[`P${idx}`];
  }
  let h = 0;
  for (const c of String(pName)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 90%, 55%)`;
}
window.colorForPattern = colorForPattern;

function getActiveZones() {
  return Array.from(document.querySelectorAll(".filter-zone:checked")).map(
    (cb) => cb.value
  );
}
function isFeatureInActiveZones(f) {
  const zones = getActiveZones();
  const id = f.properties?.id || "";
  const isN = id.startsWith("N");
  const isM = id.startsWith("M");
  return (
    (isN && zones.includes("montreuil")) || (isM && zones.includes("mirail"))
  );
}
function getPatternsForFragment(fragmentId) {
  const result = [];
  Object.entries(patterns || {}).forEach(([pName, pData]) => {
    if ((pData.elements || []).includes(fragmentId)) result.push(pName);
  });
  result.sort(
    (a, b) => parseInt(a.replace("P", "")) - parseInt(b.replace("P", ""))
  );
  return result;
}

function initPatternMapOnce() {
  if (patternMap) return;
  patternMap = L.map("patterns-map", {
    zoomControl: true,
    attributionControl: true,
  }).setView(montreuilView, montreuilZoom);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors, © CartoDB",
  }).addTo(patternMap);
  patternBaseLayer = L.layerGroup().addTo(patternMap);

  fetch("data/contour.geojson")
    .then((r) => r.json())
    .then((contour) => {
      L.geoJSON(contour, {
        style: { color: "#919090", weight: 2, opacity: 0.8, fillOpacity: 0 },
      }).addTo(patternMap);
    });
  patternImageLayer = L.layerGroup().addTo(patternMap);
  patternLinkLayer = L.layerGroup().addTo(patternMap);

  patternMap.createPane("pane-links");
  patternMap.getPane("pane-links").style.zIndex = 800; // > markerPane (600) et > tooltips (650)

  patternMap.on("zoomend moveend", () => {
    if (_stickyFragId) drawLinksForFragment(_stickyFragId);
  });

  // clic "extérieur" = revient au mode initial
  patternMap.on("click", (e) => {
    // si on a cliqué sur le fond (pas sur un marker), on désactive le sticky
    if (!e.originalEvent?.target?.closest(".frag-thumb")) {
      clearSticky();
    }
  });

  // touche ESC pour annuler le sticky
  document.addEventListener("keydown", (ev) => {
    if (currentView === "patterns-map" && ev.key === "Escape") clearSticky();
  });
}

function getFeatureCenter(feature) {
  if (feature.geometry?.type === "Point") {
    const c = feature.geometry.coordinates;
    return L.latLng(c[1], c[0]);
  }
  const tmp = L.geoJSON(feature);
  try {
    return tmp.getBounds().getCenter();
  } catch (e) {
    const c = (feature.geometry &&
      feature.geometry.coordinates &&
      feature.geometry.coordinates[0]) || [0, 0];
    return L.latLng(c[1] || 0, c[0] || 0);
  }
}

function firstPhotoForFeature(f) {
  const list = normalizePhotos(f?.properties?.photos);
  return cleanPhotoUrl(list[0] || null);
}
function centerForFragmentId(id) {
  if (_fragCenterCache.has(id)) return _fragCenterCache.get(id);
  const feat = [...(dataGeojson || []), ...(datamGeojson || [])].find(
    (ff) => ff?.properties?.id === id
  );
  if (!feat) return null;
  const c = getFeatureCenter(feat);
  _fragCenterCache.set(id, c);
  return c;
}
function clearPatternLinks() {
  if (patternLinkLayer) patternLinkLayer.clearLayers();
}
function clearSticky() {
  _stickyFragId = null;
  clearPatternLinks();
  if (!patternImageLayer) return;
  patternImageLayer.eachLayer((m) => {
    const el = m.getElement?.()?.querySelector?.(".frag-thumb");
    if (el) el.classList.remove("--active");
  });
  undimAll();
}

function undimAll() {
  if (!patternImageLayer) return;
  patternImageLayer.eachLayer((m) => {
    const el = m.getElement?.()?.querySelector?.(".frag-thumb");
    if (el) el.classList.remove("dim");
  });
}

function dimUnrelated(srcFragId, allowedPatterns = null) {
  if (!patternImageLayer) return;

  const related = new Set([srcFragId]);
  let pList =
    allowedPatterns && allowedPatterns.length
      ? allowedPatterns.slice()
      : getPatternsForFragment(srcFragId) || [];

  pList.forEach((pName) => {
    (patterns[pName]?.elements || []).forEach((id) => related.add(id));
  });

  patternImageLayer.eachLayer((m) => {
    const id = m._fragId;
    const el = m.getElement?.()?.querySelector?.(".frag-thumb");
    if (!el) return;
    if (!related.has(id)) el.classList.add("dim");
    else el.classList.remove("dim");
  });
}

function renderPatternBaseGrey() {
  if (!patternMap) return;
  patternBaseLayer.clearLayers();
  const baseStyle = {
    color: "#777",
    weight: 1,
    opacity: 1,
    fillColor: "#777",
    fillOpacity: 0.25,
  };
  const filterActiveZones = (feat) =>
    isFeatureInActiveZones(feat) && !feat.properties.isDiscourse;

  if (dataGeojson?.length) {
    L.geoJSON(
      { type: "FeatureCollection", features: dataGeojson },
      {
        filter: filterActiveZones,
        pointToLayer: (f, latlng) =>
          L.circleMarker(latlng, { ...baseStyle, radius: 4 }),
        style: () => baseStyle,
        onEachFeature: (feature, layer) => {
          layer.on("click", () => onPatternsMapFragmentClick(feature));
        },
      }
    ).addTo(patternBaseLayer);
  }
  if (datamGeojson?.length) {
    L.geoJSON(
      { type: "FeatureCollection", features: datamGeojson },
      {
        filter: filterActiveZones,
        pointToLayer: (f, latlng) =>
          L.circleMarker(latlng, { ...baseStyle, radius: 4 }),
        style: () => baseStyle,
        onEachFeature: (feature, layer) => {
          layer.on("click", () => onPatternsMapFragmentClick(feature));
        },
      }
    ).addTo(patternBaseLayer);
  }
}

function refreshPatternsMap() {
  if (!patternMap) return;
  if (!combinedFeatures.length)
    combinedFeatures = [...(dataGeojson || []), ...(datamGeojson || [])];

  patternImageLayer.clearLayers();
  patternLinkLayer.clearLayers();
  _fragCenterCache.clear();

  // index rapide
  const byId = new Map(combinedFeatures.map((f) => [f.properties.id, f]));

  // 1) lister les fragments concernés (au moins un pattern & zone active & une photo)
  const eligible = [];
  Object.entries(patterns || {}).forEach(([pName, pData]) => {
    (pData.elements || []).forEach((id) => {
      const feat = byId.get(id);
      if (!feat || feat.properties.isDiscourse) return;
      if (!isFeatureInActiveZones(feat)) return;
      eligible.push(id);
    });
  });
  const uniqEligible = Array.from(new Set(eligible));

  // 2) dessiner chaque fragment en vignette image (DivIcon)
  uniqEligible.forEach((fragId) => {
    const feat = byId.get(fragId);
    const photo = firstPhotoForFeature(feat);
    const center = getFeatureCenter(feat);
    if (!photo || !center) return;

    let html;
    if (photo) {
      html = `<img class="frag-thumb" src="${photo}" alt="${feat.properties.name || fragId}">`;
    } else {
      html = `<div class="frag-thumb --placeholder" aria-hidden="true"></div>`;
    }
    const icon = L.divIcon({
      className: "frag-thumb-ic",
      html,
      iconSize: [64, 48],
      iconAnchor: [32, 24], // centre optique
    });

    const marker = L.marker(center, { icon, riseOnHover: true });
    marker._fragId = fragId;

    // Survol : montrer les liens (si pas "sticky")
    marker.on("mouseover", () => {
      if (_stickyFragId) return;
      drawLinksForFragment(fragId);
      if (activePatternFilter) dimUnrelated(fragId, [activePatternFilter]);
      else dimUnrelated(fragId, null);
    });

    marker.on("mouseout", () => {
      if (_stickyFragId) return;
      clearPatternLinks();
      undimAll();
    });

    // Clic : stabilise + ouvre la sidebar comme avant
    marker.on("click", (ev) => {
      const el = marker.getElement()?.querySelector(".frag-thumb");
      clearSticky();
      _stickyFragId = fragId;
      if (el) el.classList.add("--active");

      drawLinksForFragment(fragId);
      if (activePatternFilter) dimUnrelated(fragId, [activePatternFilter]);
      else dimUnrelated(fragId, null);

      const feature = byId.get(fragId);
      if (feature) onPatternsMapFragmentClick(feature);
      ev.originalEvent?.stopPropagation?.();
    });

    marker.addTo(patternImageLayer);
  });
}

// --- petit helper : décale le segment AB de 'offsetPx' pixels perpendiculairement
function offsetLineLatLngs(aLatLng, bLatLng, offsetPx) {
  const p1 = patternMap.latLngToLayerPoint(aLatLng);
  const p2 = patternMap.latLngToLayerPoint(bLatLng);
  const dx = p2.x - p1.x,
    dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  // vecteur normal (droite du segment)
  const nx = -dy / len,
    ny = dx / len;
  const ox = nx * offsetPx,
    oy = ny * offsetPx;
  const p1o = L.point(p1.x + ox, p1.y + oy);
  const p2o = L.point(p2.x + ox, p2.y + oy);
  return [
    patternMap.layerPointToLatLng(p1o),
    patternMap.layerPointToLatLng(p2o),
  ];
}

function drawLinksForFragment(srcFragId) {
  clearPatternLinks();

  // (A) liste des patterns pour ce fragment
  let pList = getPatternsForFragment(srcFragId);
  if (!pList.length) return;

  // (B) applique le filtre d'onglet si présent (ex: 'P7' -> on ne garde que P7)
  if (activePatternFilter) {
    pList = pList.filter((p) => p === activePatternFilter);
    if (!pList.length) return; // rien à dessiner pour ce filtre
  }

  const srcCenter = centerForFragmentId(srcFragId);
  if (!srcCenter) return;

  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map((f) => [f.properties.id, f]));

  // 1) regroupe par destination -> [liste des patterns]
  const destToPatterns = new Map();

  pList.forEach((pName) => {
    const members = patterns[pName]?.elements || [];
    members.forEach((dstId) => {
      if (dstId === srcFragId) return;
      const dst = byId.get(dstId);
      if (!dst || !isFeatureInActiveZones(dst)) return;
      const arr = destToPatterns.get(dstId) || [];
      arr.push(pName);
      destToPatterns.set(dstId, arr);
    });
  });

  // ... (le reste inchangé : calcul des offsets et L.polyline)
  const SPACING = 4;
  destToPatterns.forEach((pNames, dstId) => {
    const dstCenter = centerForFragmentId(dstId);
    if (!dstCenter) return;

    pNames = pNames
      .slice()
      .sort(
        (a, b) => parseInt(a.replace("P", "")) - parseInt(b.replace("P", ""))
      );

    const n = pNames.length;
    for (let k = 0; k < n; k++) {
      const centeredIndex = k - (n - 1) / 2;
      const offsetPx = centeredIndex * SPACING;
      const [aOff, bOff] = offsetLineLatLngs(srcCenter, dstCenter, offsetPx);
      const color = colorForPattern(pNames[k]);

      L.polyline([aOff, bOff], {
        pane: "pane-links",
        color,
        weight: 2,
        opacity: 0.95,
        lineCap: "round",
        smoothFactor: 0,
      }).addTo(patternLinkLayer);
    }
  });
}

// Clic sur fragment (carte patterns)
function onPatternsMapFragmentClick(feature) {
  if (unitCreation.active) {
    handleUnitSelection(feature);
    return;
  }
  if (currentView !== "patterns-map") {
    return showDetails(feature.properties);
  }
  clearAllTabbedTabs();
  closeSidebars();
  const fProps = feature.properties || {};
  const fragId = fProps.id || Math.random().toString(36).slice(2);
  openTab({
    id: `frag-${fragId}`,
    title: fProps.id || "Fragment",
    kind: "fragment",
    render: (panel) => renderFragmentPanel(panel, fProps),
    autoFocus: true,
  });
  const pList = getPatternsForFragment(fragId);
  pList.forEach((pName) => {
    const pData = patterns[pName];
    if (!pData) return;
    openTab({
      id: `pattern-${pName}`,
      title: pName,
      kind: "pattern",
      render: (panel) => renderPatternPanel(panel, pName, pData),
      autoFocus: false,
    });
  });
}

/*==================================================
=             MODE CRÉATION D’UNITÉ (UP)           =
==================================================*/
function startUnitCreation() {
  setTopTab("patterns");
  setSubTab("patterns-map");
  initPatternMapOnce();
  if (unitCreation.active) return;
  unitCreation.active = true;

  const btn = document.getElementById("create-unit-btn");
  if (btn) {
    btn.textContent = "Annuler la création";
    btn.classList.add("is-armed");
    btn.setAttribute("aria-pressed", "true");
  }
  const cont = patternMap.getContainer();
  cont.classList.add("patterns-creating");
  const hint = document.getElementById("unit-hint");
  hint.style.display = "block";
  unitCreation.mouseMoveHandler = (e) => {
    hint.style.left = e.clientX + "px";
    hint.style.top = e.clientY + "px";
  };
  window.addEventListener("mousemove", unitCreation.mouseMoveHandler);
}
function stopUnitCreation() {
  if (!unitCreation.active) return;
  unitCreation.active = false;

  const btn = document.getElementById("create-unit-btn");
  if (btn) {
    btn.textContent = "Créer une Unité de Projet";
    btn.classList.remove("is-armed");
    btn.setAttribute("aria-pressed", "false");
  }
  const cont = patternMap.getContainer();
  cont.classList.remove("patterns-creating");
  const hint = document.getElementById("unit-hint");
  hint.style.display = "none";
  if (unitCreation.mouseMoveHandler) {
    window.removeEventListener("mousemove", unitCreation.mouseMoveHandler);
    unitCreation.mouseMoveHandler = null;
  }
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && unitCreation.active) stopUnitCreation();
});

// Bouton toggle création UP
const createUnitBtn = document.getElementById("create-unit-btn");
if (createUnitBtn)
  createUnitBtn.addEventListener("click", () => {
    unitCreation.active ? stopUnitCreation() : startUnitCreation();
  });

// Sélection d’un fragment ⇒ création UP locale
function handleUnitSelection(feature) {
  stopUnitCreation();

  // ➜ on récupère le code du fragment (ex: "M12…" ou "N07…")
  const srcId = feature?.properties?.id || "UNK";
  let unitId = `UP-${srcId}`;

  // (optionnel) si une unité avec le même ID existe déjà, on différencie
  const exists = loadUnitsLocal().some((u) => u.id === unitId);
  if (exists) unitId = `UP-${srcId}-${Date.now().toString().slice(-4)}`;

  const unit = {
    id: unitId,
    sourceFragmentId: srcId,
    geometry: feature.geometry,
    // ➜ le "nom" affiché partout = l'ID voulu
    props: { name: unitId },
    createdAt: new Date().toISOString(),
  };

  saveUnitLocal(unit);
  setTopTab("unit");
  showView("unit-view");
  setTimeout(() => {
    renderAllUnits();
    zoomToUnit(unit);
  }, 0);
}

function saveUnitLocal(unit) {
  try {
    const key = "units";
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    arr.push(unit);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.warn("Impossible d’enregistrer localement l’unité :", e);
  }
}
function loadUnitsLocal() {
  try {
    return JSON.parse(localStorage.getItem("units") || "[]");
  } catch (e) {
    return [];
  }
}

function ensureUnitMap() {
  if (unitMap) {
    setTimeout(() => unitMap.invalidateSize(), 0);
    return unitMap;
  }

  unitMap = L.map("unit-view", {
    zoomControl: true,
    attributionControl: true,
  }).setView(montreuilView, montreuilZoom);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors, © CartoDB",
  }).addTo(unitMap);

  unitContextGroup = L.layerGroup().addTo(unitMap);
  unitLayerGroup = L.layerGroup().addTo(unitMap);

  // ⬇️ ICI : contour non interactif + au fond
  fetch("data/contour.geojson")
    .then((r) => r.json())
    .then((contour) => {
      const contourLayer = L.geoJSON(contour, {
        style: { color: "#919090", weight: 2, opacity: 0.8, fillOpacity: 0 },
        interactive: false, // ✅ ne capte plus les clics
      }).addTo(unitContextGroup);
      contourLayer.bringToBack(); // ✅ passe sous les unités
    });

  return unitMap;
}

function renderAllUnits() {
  const mapU = ensureUnitMap();
  unitLayerGroup.clearLayers();
  const whiteStyle = {
    color: "#fff",
    weight: 2,
    opacity: 1,
    fillColor: "#fff",
    fillOpacity: 0.25,
  };
  const units = loadUnitsLocal();
  let unionBounds = null;

  units.forEach((u) => {
    const gj = L.geoJSON(
      { type: "Feature", geometry: u.geometry, properties: u.props },
      {
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, { ...whiteStyle, radius: 6 }),
        style: () => whiteStyle,
      }
    ).addTo(unitLayerGroup);

    // >>> clic fiable sur chaque géométrie de l'unité
    gj.eachLayer((layer) => {
      layer.on("click", () => {
        openUnitModal(u); // ✨ nouvelle modale au lieu du panneau
      });
    });

    if (gj.getBounds) {
      const b = gj.getBounds();
      unionBounds = unionBounds ? unionBounds.extend(b) : b;
    }
  });

  if (unionBounds && unionBounds.isValid && unionBounds.isValid())
    mapU.fitBounds(unionBounds.pad(0.3));
}

function zoomToUnit(unit) {
  const mapU = ensureUnitMap();
  try {
    const tmp = L.geoJSON({ type: "Feature", geometry: unit.geometry });
    const b = tmp.getBounds?.();
    if (b && b.isValid && b.isValid()) {
      mapU.fitBounds(b.pad(0.3));
      return;
    }
  } catch (e) {}
  const center = getFeatureCenter({ geometry: unit.geometry });
  if (center) mapU.setView(center, 17);
}
function showUnitOnMap(unit) {
  const mapU = ensureUnitMap();
  const whiteStyle = {
    color: "#fff",
    weight: 2,
    opacity: 1,
    fillColor: "#fff",
    fillOpacity: 0.25,
  };
  const layer = L.geoJSON(
    { type: "Feature", geometry: unit.geometry, properties: unit.props },
    {
      pointToLayer: (_f, latlng) =>
        L.circleMarker(latlng, { ...whiteStyle, radius: 6 }),
      style: () => whiteStyle,
    }
  ).addTo(unitLayerGroup);
  try {
    const b = layer.getBounds?.();
    if (b && b.isValid && b.isValid()) mapU.fitBounds(b.pad(0.3));
    else {
      const center = getFeatureCenter({ geometry: unit.geometry });
      if (center) mapU.setView(center, 17);
    }
  } catch (e) {
    console.warn("Fit bounds unité :", e);
  }
}

/*==================================================
=     INSPECTEUR D’UNITÉ : V1 / V2 / COMPARER      =
==================================================*/

/* ========== MODALE UNITÉ (plein écran) ========== */
let unitModalState = {
  unit: null,
  singleViewer: null,
  v1Viewer: null,
  v2Viewer: null,
};

function openUnitModal(unit) {
  unitModalState.unit = unit;

  const modal = document.getElementById("unit-modal");
  const titleEl = document.getElementById("unit-title");
  const btnV1 = document.getElementById("unit-btn-v1");
  const btnV2 = document.getElementById("unit-btn-v2");
  const btnCmp = document.getElementById("unit-btn-compare");
  const btnX = document.getElementById("unit-close");

  // titre = ID de l'unité
  titleEl.textContent = unit.props?.name || unit.id;

  // fragment source de l'unité (là où vit la V1)
  const fragId = unit.sourceFragmentId || null;
  const hasV1 = fragId ? hasFragment3D(fragId) : false;

  // --- Bouton V1 : soit "V1" (affiche), soit "Importer V1" (ouvre le file picker)
  if (hasV1) {
    btnV1.textContent = "V1";
    btnV1.onclick = async () => {
      disposeUnitCompare();
      showUnitSingle();
      await renderUnitV1Into(document.getElementById("unit-single-host"));
    };
  } else {
    btnV1.textContent = "Importer V1";
    btnV1.onclick = () => {
      promptImportV1ForSourceFragment(fragId, async () => {
        // une fois importée : on passe le bouton en "V1" et on affiche
        btnV1.textContent = "V1";
        disposeUnitCompare();
        showUnitSingle();
        await renderUnitV1Into(document.getElementById("unit-single-host"));
      });
    };
  }

  // --- Bouton V2 : inchangé (import si pas encore là)
  btnV2.textContent = hasUnit3D(unit.id) ? "V2" : "Importer V2";
  btnV2.onclick = async () => {
    if (!hasUnit3D(unit.id)) {
      promptImport3DForUnit(unit.id, async () => {
        btnV2.textContent = "V2";
        disposeUnitCompare();
        showUnitSingle();
        await renderUnitV2Into(document.getElementById("unit-single-host"));
      });
      return;
    }
    disposeUnitCompare();
    showUnitSingle();
    await renderUnitV2Into(document.getElementById("unit-single-host"));
  };

  // --- Bouton Comparer : inchangé (demande une V2, la V1 est lue sur le fragment)
  btnCmp.onclick = async () => {
    if (!hasUnit3D(unit.id)) {
      promptImport3DForUnit(unit.id, async () => {
        btnV2.textContent = "V2";
        await doUnitCompare();
      });
    } else {
      await doUnitCompare();
    }
  };

  // fermeture
  document.getElementById("unit-backdrop").onclick = closeUnitModal;
  btnX.onclick = closeUnitModal;

  // on écoute les MAJ des métadonnées du fragment (labels 3D)
  function onMetaUpdated(e) {
    if (e.detail?.fragmentId !== fragId) return;
    const meta = e.detail.meta || { usages: [], discours: [] };
    unitModalState.singleViewer?.setLabelsFromMeta?.(meta);
    unitModalState.v1Viewer?.setLabelsFromMeta?.(meta);
    unitModalState.v2Viewer?.setLabelsFromMeta?.(meta);
  }
  window.addEventListener("fragmeta:updated", onMetaUpdated);
  modal.__cleanupMetaListener = onMetaUpdated;

  // afficher la modale
  modal.style.display = "block";

  // Démarrage :
  // - si V1 existe déjà → on l’affiche
  // - sinon → on reste en vue simple, en attendant que l’utilisateur clique "Importer V1"
  showUnitSingle();
  if (hasV1) btnV1.click();
}

function closeUnitModal() {
  const modal = document.getElementById("unit-modal");
  modal.style.display = "none";

  disposeUnitSingle();
  disposeUnitCompare();

  // nettoie l'écouteur meta
  if (modal.__cleanupMetaListener) {
    window.removeEventListener("fragmeta:updated", modal.__cleanupMetaListener);
    modal.__cleanupMetaListener = null;
  }

  unitModalState.unit = null;
}

function showUnitSingle() {
  document.getElementById("unit-single-host").style.display = "block";
  document.getElementById("unit-compare-host").style.display = "none";
}

function showUnitCompare() {
  document.getElementById("unit-single-host").style.display = "none";
  document.getElementById("unit-compare-host").style.display = "flex";
}

function disposeUnitSingle() {
  if (unitModalState.singleViewer) {
    unitModalState.singleViewer.dispose?.();
    unitModalState.singleViewer = null;
  }
}

function disposeUnitCompare() {
  if (unitModalState.v1Viewer) {
    unitModalState.v1Viewer.dispose?.();
    unitModalState.v1Viewer = null;
  }
  if (unitModalState.v2Viewer) {
    unitModalState.v2Viewer.dispose?.();
    unitModalState.v2Viewer = null;
  }
}

/* Renderers (réutilisent la logique existante) */
async function renderUnitV1Into(container) {
  if (!window.__ThreeFactory__) {
    console.error("Viewer 3D non chargé.");
    return null;
  }
  container.innerHTML = "";
  const { unit } = unitModalState;
  const fragId = unit.sourceFragmentId || null;

  const viewer = window.__ThreeFactory__.createThreeViewer(container);
  const rec = fragId ? loadFragment3D(fragId) : null;
  if (rec?.dataUrl) {
    const blob = dataURLtoBlob(rec.dataUrl);
    await viewer.showBlob(blob);
  }
  const meta = fragId ? loadFragmentMeta(fragId) : { usages: [], discours: [] };
  viewer.setLabelsFromMeta?.(meta);

  unitModalState.singleViewer = viewer;
  return viewer;
}

async function renderUnitV2Into(container) {
  if (!window.__ThreeFactory__) {
    console.error("Viewer 3D non chargé.");
    return null;
  }
  container.innerHTML = "";
  const { unit } = unitModalState;

  const viewer = window.__ThreeFactory__.createThreeViewer(container);
  const rec = loadUnit3D(unit.id);
  if (rec?.dataUrl) {
    const blob = dataURLtoBlob(rec.dataUrl);
    await viewer.showBlob(blob);
  }
  const meta = unit.sourceFragmentId
    ? loadFragmentMeta(unit.sourceFragmentId)
    : { usages: [], discours: [] };
  viewer.setLabelsFromMeta?.(meta);

  unitModalState.singleViewer = viewer;
  return viewer;
}

async function doUnitCompare() {
  disposeUnitSingle();
  showUnitCompare();

  const v1 = await (async () => {
    const c = document.getElementById("unit-v1-host");
    if (!window.__ThreeFactory__) return null;
    const v = window.__ThreeFactory__.createThreeViewer(c);
    const fragId = unitModalState.unit.sourceFragmentId || null;
    const rec = fragId ? loadFragment3D(fragId) : null;
    if (rec?.dataUrl) await v.showBlob(dataURLtoBlob(rec.dataUrl));
    const meta = fragId
      ? loadFragmentMeta(fragId)
      : { usages: [], discours: [] };
    v.setLabelsFromMeta?.(meta);
    return v;
  })();

  const v2 = await (async () => {
    const c = document.getElementById("unit-v2-host");
    if (!window.__ThreeFactory__) return null;
    const v = window.__ThreeFactory__.createThreeViewer(c);
    const rec = loadUnit3D(unitModalState.unit.id);
    if (rec?.dataUrl) await v.showBlob(dataURLtoBlob(rec.dataUrl));
    const meta = unitModalState.unit.sourceFragmentId
      ? loadFragmentMeta(unitModalState.unit.sourceFragmentId)
      : { usages: [], discours: [] };
    v.setLabelsFromMeta?.(meta);
    return v;
  })();

  unitModalState.v1Viewer = v1;
  unitModalState.v2Viewer = v2;
}

/*---------------------------------------
VUE DE COMPOSIITON
---------------------------------------*/

// --- Fragments spatiaux actuellement visibles selon zones + pas discours
function getCurrentlyVisibleSpatialFeatures() {
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  return all.filter(
    (f) => isFeatureInActiveZones(f) && !f.properties?.isDiscourse
  );
}

// --- Toutes les photos normalisées d’un feature (tableau de strings propres)
function allPhotosForFeature(f) {
  const list = normalizePhotos(f?.properties?.photos);
  return list.map(cleanPhotoUrl).filter(Boolean);
}

// --- Intersection de critères (masques) sur une liste d’IDs
function intersectCriteriaMasks(fragmentIds) {
  if (!fragmentIds.length) return 0;
  const byId = new Map(
    [...(dataGeojson || []), ...(datamGeojson || [])].map((f) => [
      f.properties.id,
      f,
    ])
  );
  let inter = null;
  fragmentIds.forEach((id) => {
    const f = byId.get(id);
    if (!f) return;
    const m = getActiveMaskFor(f); // tient compte des dimensions (légende) actives
    inter = inter === null ? m : inter & m;
  });
  return inter || 0;
}

// --- Prochain nom de pattern disponible (P{n}) pour affichage par défaut
function nextPatternName() {
  // on prend max sur patterns existants; si aucun => P1
  const nums = Object.keys(patterns || {})
    .map((k) => parseInt(String(k).replace(/^P/i, ""), 10))
    .filter((n) => Number.isFinite(n));
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return `P${n}`;
}

function showGalleryComposeView() {
  const host = document.getElementById("gallery-compose-view");
  host.innerHTML = "";

  /* --- marge interne haute/basse directement sur le host --- */
  host.style.boxSizing = "border-box";
  host.style.overflow = "hidden"; // on scrolle dans les boîtes, pas le host
  host.style.paddingTop = "12px"; // ↑ air en haut
  host.style.paddingBottom = "28px"; // ↓ air en bas pour ne pas toucher le bord

  // cacher le slider sur cette vue
  const sliderBox = document.getElementById("similarity-controls");
  if (sliderBox) sliderBox.style.display = "none";

  /* ===== Layout : [barre] [sources] [composition] ===== */
  const wrap = document.createElement("div");
  wrap.style.cssText = [
    "display:grid",
    "grid-template-rows:auto 1fr 1fr",
    "gap:8px",
    "height:100%",
    "min-height:0",
    "box-sizing:border-box",
    // on soustrait un petit offset pour respecter le padding-bottom du host
    "height:calc(100% - 10px)",
  ].join(";");

  /* ---------- (1) BARRE D’INFOS ---------- */
  const infoBar = document.createElement("div");
  infoBar.style.cssText = [
    "display:flex",
    "justify-content:space-between",
    "align-items:center",
    "padding:4px 8px",
    "line-height:1.2",
    "min-height:20px",
    "max-height:30px",
    "overflow:hidden",
  ].join(";");

  const leftInfo = document.createElement("div");
  leftInfo.style.cssText =
    "font-size:12px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  const rightInfo = document.createElement("div");
  rightInfo.style.cssText = "display:flex;gap:8px;";
  infoBar.append(leftInfo, rightInfo);

  /* ---------- (2) SOURCES ---------- */
  const sourceShell = document.createElement("div");
  sourceShell.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "border:1px solid #000",
    "background:#fcfcfc",
    "padding:8px",
    "min-height:0",
    "box-sizing:border-box",
    "overflow:hidden",
  ].join(";");

  const sourceScroll = document.createElement("div");
  sourceScroll.style.cssText =
    "flex:1 1 0; min-height:0; overflow:auto; box-sizing:border-box;";
  const sourceGrid = document.createElement("div");
  sourceGrid.style.cssText =
    "display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px;";
  sourceScroll.appendChild(sourceGrid);
  sourceShell.appendChild(sourceScroll);

  /* ---------- (3) COMPOSITION ---------- */
  const composeRow = document.createElement("div");
  composeRow.style.cssText = [
    "display:grid",
    "grid-template-columns:minmax(0,1fr) 220px",
    "gap:12px",
    "height:75%",
    "min-height:0",
    "overflow:hidden",
    "margin-bottom: 10px", // petit air avant le bas du host
  ].join(";");

  const dropShell = document.createElement("div");
  dropShell.style.cssText =
    "display:flex; flex-direction:column; min-height:0;";

  const dropScroll = document.createElement("div");
  dropScroll.id = "pattern-dropzone";
  dropScroll.style.cssText = [
    "flex:1 1 0",
    "min-height:0",
    "overflow:auto",
    "border:1px dashed #000000ff",
    "background:#fff",
    "padding:10px",
    "box-sizing:border-box",
  ].join(";");

  const dropGrid = document.createElement("div");
  dropGrid.style.cssText = "display:flex; flex-wrap:wrap; gap:8px;";
  dropScroll.appendChild(dropGrid);
  dropShell.appendChild(dropScroll);

  const actionsCol = document.createElement("div");
  actionsCol.style.cssText =
    "display:flex; flex-direction:column; gap:8px; align-self:start; position:sticky; top:0;";

  // Boutons
  const btnSave = document.createElement("button");
  btnSave.className = "tab-btn";
  btnSave.textContent = "Enregistrer ce pattern";
  btnSave.style.cssText =
    "background:#000;color:#fff;padding:8px;border:1px solid #000;cursor:pointer;border-radius:0;";

  const btnClear = document.createElement("button");
  btnClear.className = "tab-btn";
  btnClear.textContent = "Vider la composition";
  btnClear.style.cssText =
    "padding:8px;border:1px solid #000;cursor:pointer;background:#000;border-radius:0;";

  actionsCol.append(btnSave, btnClear);
  composeRow.append(dropShell, actionsCol);

  // montage
  wrap.append(infoBar, sourceShell, composeRow);
  host.appendChild(wrap);

  /* ===== Logique ===== */
  const composition = [];
  const uniqueFragmentIds = () =>
    Array.from(new Set(composition.map((x) => x.id)));

  function refreshInfoBar() {
    const ids = uniqueFragmentIds();
    const mask = intersectCriteriaMasks(ids);
    const sharedCount = popcount32(mask);
    leftInfo.textContent = ids.length
      ? `Fragments : ${ids.length} - Critères communs : ${sharedCount}`
      : `Glisse des images ci-dessous pour composer.`;
  }

  function renderDropGrid() {
    dropGrid.innerHTML = "";
    composition.forEach((item, idx) => {
      const card = document.createElement("div");
      card.style.cssText =
        "position:relative;width:120px;height:90px;border:1px solid #ddd;overflow:hidden;background:#eee;";
      const img = document.createElement("img");
      img.src = item.photo;
      img.alt = item.id;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;";
      const del = document.createElement("button");
      del.textContent = "×";
      del.title = "Retirer";
      del.style.cssText =
        "position:absolute;top:2px;right:2px;background:#000;color:#fff;border:none;width:22px;height:22px;cursor:pointer;border-radius:0;";
      del.onclick = () => {
        composition.splice(idx, 1);
        renderDropGrid();
        refreshInfoBar();
      };
      card.append(img, del);
      dropGrid.appendChild(card);
    });
  }

  dropScroll.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropScroll.style.borderColor = "#000";
  });
  dropScroll.addEventListener("dragleave", () => {
    dropScroll.style.borderColor = "#bdbdbd";
  });
  dropScroll.addEventListener("drop", (e) => {
    e.preventDefault();
    dropScroll.style.borderColor = "#bdbdbd";
    try {
      const payload = JSON.parse(e.dataTransfer.getData("application/json"));
      if (payload?.id && payload?.photo) {
        composition.push({ id: payload.id, photo: payload.photo });
        renderDropGrid();
        refreshInfoBar();
      }
    } catch (_) {}
  });

  function populateSourceGrid() {
    sourceGrid.innerHTML = "";
    const visibles = getCurrentlyVisibleSpatialFeatures();
    visibles.forEach((f) => {
      const fid = f.properties.id;
      const photos = allPhotosForFeature(f);
      photos.forEach((photo) => {
        const cell = document.createElement("div");
        cell.style.cssText =
          "border:none;overflow:hidden;background:transparent;";
        const img = document.createElement("img");
        img.src = photo;
        img.alt = f.properties.name || fid || "fragment";
        img.draggable = true;
        img.style.cssText =
          "display:block;width:100%;aspect-ratio:4/3;object-fit:cover;cursor:grab;";
        img.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData(
            "application/json",
            JSON.stringify({ id: fid, photo })
          );
          e.dataTransfer.effectAllowed = "copy";
        });
        img.addEventListener("click", () => showDetails(f.properties));
        cell.appendChild(img);
        sourceGrid.appendChild(cell);
      });
    });
  }

  btnClear.onclick = () => {
    composition.splice(0, composition.length);
    renderDropGrid();
    refreshInfoBar();
  };
  btnSave.onclick = () => {
    const ids = uniqueFragmentIds();
    if (!ids.length) {
      alert(
        "Ajoute au moins un fragment dans la composition avant d'enregistrer."
      );
      return;
    }
    const sharedMask = intersectCriteriaMasks(ids);
    const criteria = maskToCriteriaDict(sharedMask);
    const pKey = nextPatternName();
    openPatternEditor({
      mode: "create",
      patternKey: pKey,
      elements: ids,
      criteria,
      name: pKey,
      description: "",
      onSave: (payload) => {
        const rec = {
          uid:
            "sp_" +
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 7),
          ...payload,
          savedAt: new Date().toISOString(),
        };
        addSavedPattern(rec);
        openSavedPatternPanel(rec.uid);
      },
      headerText: "Enregistrer ce pattern (composition)",
      saveText: "Enregistrer",
    });
  };

  populateSourceGrid();
  renderDropGrid();
  refreshInfoBar();

  document.querySelectorAll(".filter-zone").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (currentView === "gallery-compose") populateSourceGrid();
    });
  });
  document.querySelectorAll("#criteria-legend .crit-dim").forEach((cb) => {
    cb.addEventListener("change", () => {
      rebuildCriteriaEnabledMaskFromUI();
      if (currentView === "gallery-compose") {
        populateSourceGrid();
        refreshInfoBar();
      }
    });
  });
}

/*---------------------------------------
STOCKAGE LOCAL 3D (helpers)
  (appelé par la modale 3D)
---------------------------------------*/
function saveFragment3D(fragmentId, fileName, mime, dataUrl) {
  localStorage.setItem(
    `frag3d:${fragmentId}`,
    JSON.stringify({ fileName, mime, dataUrl, savedAt: Date.now() })
  );
}
function loadFragment3D(fragmentId) {
  try {
    return JSON.parse(localStorage.getItem(`frag3d:${fragmentId}`) || "null");
  } catch (e) {
    return null;
  }
}
function hasFragment3D(fragmentId) {
  return !!localStorage.getItem(`frag3d:${fragmentId}`);
}

/*==================================================
=       STOCKAGE LOCAL 3D — V2 (par Unité)         =
==================================================*/
function saveUnit3D(unitId, fileName, mime, dataUrl) {
  localStorage.setItem(
    `unit3dV2:${unitId}`,
    JSON.stringify({
      fileName,
      mime,
      dataUrl,
      savedAt: Date.now(),
    })
  );
}
function loadUnit3D(unitId) {
  try {
    return JSON.parse(localStorage.getItem(`unit3dV2:${unitId}`) || "null");
  } catch (e) {
    return null;
  }
}
function hasUnit3D(unitId) {
  return !!localStorage.getItem(`unit3dV2:${unitId}`);
}

function promptImport3DForUnit(unitId, onLoaded) {
  const input = document.getElementById("three-file-input");
  input.value = "";
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    saveUnit3D(unitId, file.name, file.type || "model/gltf-binary", dataUrl);
    if (typeof onLoaded === "function") onLoaded(dataUrl);
  };
  input.click();
}

// Importer une V1 pour le fragment source d'une unité (depuis la modale Unité)
function promptImportV1ForSourceFragment(fragmentId, onLoaded) {
  if (!fragmentId) return;
  const input = document.getElementById("three-file-input");
  input.value = "";
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    // ⬇️ on enregistre la V1 sur le fragment (même clé que la carte Fragments)
    saveFragment3D(
      fragmentId,
      file.name,
      file.type || "model/gltf-binary",
      dataUrl
    );

    // Broadcast (si tu veux réagir ailleurs)
    window.dispatchEvent(
      new CustomEvent("frag3d:updated", { detail: { fragmentId } })
    );

    // callback local (pour recharger la vue dans la modale)
    if (typeof onLoaded === "function") onLoaded(dataUrl);
  };
  input.click();
}

/*==================================================
=                 MODALE 3D (Three)                =
==================================================*/
let activeViewer = null;
let activeFragmentId = null;

function openThreeModalForFragment(fragmentId) {
  if (!window.__ThreeFactory__) {
    console.error("Viewer 3D non chargé.");
    return;
  }
  activeFragmentId = fragmentId;
  const modal = document.getElementById("three-modal");
  const host = document.getElementById("three-canvas-host");
  const btnClose = document.getElementById("three-close");
  const btnLoad = document.getElementById("three-load-btn");

  modal.style.display = "block";
  activeViewer = window.__ThreeFactory__?.createThreeViewer(host);

  const rec = loadFragment3D(fragmentId);
  if (rec?.dataUrl) {
    const blob = dataURLtoBlob(rec.dataUrl);
    activeViewer.showBlob(blob).then(() => {
      const meta = loadFragmentMeta(fragmentId);
      activeViewer.setLabelsFromMeta?.(meta);
    });
  } else {
    const meta = loadFragmentMeta(fragmentId);
    activeViewer.setLabelsFromMeta?.(meta);
  }

  document.getElementById("three-backdrop").onclick = closeThreeModal;
  btnClose.onclick = closeThreeModal;
  btnLoad.onclick = () => promptImport3DForFragment(fragmentId, true);

  function onMetaUpdated(e) {
    if (e.detail?.fragmentId === activeFragmentId && activeViewer) {
      activeViewer.setLabelsFromMeta?.(e.detail.meta);
    }
  }
  window.addEventListener("fragmeta:updated", onMetaUpdated);
  function escCloseThreeOnce(e) {
    if (e.key === "Escape") closeThreeModal();
  }
  document.addEventListener("keydown", escCloseThreeOnce);
  modal.__cleanupMetaListener = onMetaUpdated;
  modal.__escHandler = escCloseThreeOnce;
}

function closeThreeModal() {
  const modal = document.getElementById("three-modal");
  modal.style.display = "none";
  if (modal.__escHandler) {
    document.removeEventListener("keydown", modal.__escHandler);
    modal.__escHandler = null;
  }
  if (modal.__cleanupMetaListener) {
    window.removeEventListener("fragmeta:updated", modal.__cleanupMetaListener);
    modal.__cleanupMetaListener = null;
  }
  if (activeViewer) {
    activeViewer.dispose?.();
    activeViewer = null;
  }
  activeFragmentId = null;
}

function dataURLtoBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime =
    (meta.match(/data:(.*?);base64/) || [])[1] || "application/octet-stream";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function promptImport3DForFragment(fragmentId, reloadIfOpen = false) {
  const input = document.getElementById("three-file-input");
  input.value = "";
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    saveFragment3D(
      fragmentId,
      file.name,
      file.type || "model/gltf-binary",
      dataUrl
    );
    if (reloadIfOpen && activeViewer) {
      await activeViewer.showBlob(dataURLtoBlob(dataUrl));
      const meta = loadFragmentMeta(fragmentId);
      activeViewer.setLabelsFromMeta?.(meta); // évite la double ligne inutile
    }
  };
  input.click();
}

/*==================================================
=           SAVED PATTERNS (localStorage)          =
==================================================*/

function loadSavedPatterns() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_PATTERNS_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
function saveSavedPatterns(arr) {
  localStorage.setItem(SAVED_PATTERNS_KEY, JSON.stringify(arr));
}
function addSavedPattern(rec) {
  const arr = loadSavedPatterns();
  arr.push(rec);
  saveSavedPatterns(arr);
}
function updateSavedPattern(uid, patch) {
  const arr = loadSavedPatterns();
  const i = arr.findIndex((x) => x.uid === uid);
  if (i >= 0) {
    arr[i] = { ...arr[i], ...patch, updatedAt: new Date().toISOString() };
    saveSavedPatterns(arr);
  }
}
function deleteSavedPattern(uid) {
  saveSavedPatterns(loadSavedPatterns().filter((x) => x.uid !== uid));
}
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (e) {
    return iso || "";
  }
}

/*==================================================
=   ÉDITEUR DE PATTERN (création ET modification)  =
==================================================*/

/**
 * Ouvre la même fenêtre modale que la création, mais en mode:
 *  - "create"  : on enregistre un NOUVEAU snapshot (addSavedPattern)
 *  - "edit"    : on modifie un snapshot existant (updateSavedPattern)
 *
 * options = {
 *   mode: 'create' | 'edit',
 *   patternKey,                // string (clé P1, P7…)
 *   elements: string[],        // ids des membres
 *   criteria: object,          // critères du snapshot
 *   name: string,              // nom initial (pré-rempli)
 *   description: string,       // desc initiale (pré-remplie)
 *   onSave: (payload) => void, // callback appelé quand on confirme
 *   headerText?: string,       // (facultatif) titre personnalisé
 *   saveText?: string          // (facultatif) libellé bouton
 * }
 */
function openPatternEditor(options) {
  const {
    mode = "create",
    patternKey = "",
    elements = [],
    criteria = {},
    name = patternKey,
    description = "",
    onSave = () => {},
    headerText,
    saveText,
  } = options || {};

  const modal = document.getElementById("save-pattern-modal");
  // Toujours au-dessus de la liste + dernier dans le DOM (même z-index)
  modal.style.zIndex = "6000";
  document.body.appendChild(modal);
  const keyEl = document.getElementById("sp-key");
  const nameEl = document.getElementById("sp-name");
  const descEl = document.getElementById("sp-desc");
  const listEl = document.getElementById("sp-fragments");
  const countEl = document.getElementById("sp-frag-count");
  const btnSave = document.getElementById("sp-save");
  const btnCancel = document.getElementById("sp-cancel");

  // Titre et libellés
  const headTitle = modal.querySelector(".modal__head strong");
  headTitle.textContent =
    headerText ||
    (mode === "edit" ? "Modifier ce pattern" : "Enregistrer ce pattern");
  btnSave.textContent =
    saveText ||
    (mode === "edit" ? "Enregistrer les modifications" : "Enregistrer");

  // Remplissage des champs
  keyEl.value = patternKey;
  nameEl.value = (name || patternKey).trim();
  descEl.value = description || "";

  // Remplir la liste des fragments
  countEl.textContent = String(elements.length);
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map((f) => [f.properties.id, f]));
  listEl.innerHTML = "";
  elements.forEach((id) => {
    const f = byId.get(id);
    const line = document.createElement("div");
    line.textContent = `${id}${f?.properties?.name ? " — " + f.properties.name : ""}`;
    listEl.appendChild(line);
  });

  // Ouverture + handlers
  function close() {
    modal.style.display = "none";
    cleanup();
  }
  function cleanup() {
    document.querySelector("#save-pattern-modal .modal__backdrop").onclick =
      null;
    btnCancel.onclick = null;
    btnSave.onclick = null;
  }
  document.querySelector("#save-pattern-modal .modal__backdrop").onclick =
    close;
  btnCancel.onclick = close;
  btnSave.onclick = () => {
    const payload = {
      patternKey,
      name: (nameEl.value || patternKey).trim(),
      description: (descEl.value || "").trim(),
      elements: elements.slice(),
      criteria: criteria,
    };
    onSave(payload);
    close();
  };

  modal.style.display = "block";
}

/* --- Création : garde le même nom de fonction publique --- */
function openSavePatternModal(patternKey, patternData) {
  const els = (patternData?.elements || []).slice();
  openPatternEditor({
    mode: "create",
    patternKey,
    elements: els,
    criteria: patternData?.criteria || {},
    name: patternNames?.[patternKey] || patternKey,
    description: "",
    onSave: (payload) => {
      const rec = {
        uid:
          "sp_" +
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 7),
        ...payload,
        savedAt: new Date().toISOString(),
      };
      addSavedPattern(rec);
      // Ouvre directement la fiche
      openSavedPatternPanel(rec.uid);
    },
  });
}

/* --- Édition d’un pattern SAUVEGARDÉ (par UID) --- */
function openEditSavedPatternModal(uid) {
  const items = loadSavedPatterns();
  const rec = items.find((x) => x.uid === uid);
  if (!rec) return;

  openPatternEditor({
    mode: "edit",
    patternKey: rec.patternKey,
    elements: rec.elements || [],
    criteria: rec.criteria || {},
    name: rec.name || rec.patternKey,
    description: rec.description || "",
    onSave: (payload) => {
      updateSavedPattern(uid, {
        name: payload.name,
        description: payload.description,
      });

      // rafraîchir la fiche ouverte si elle existe
      const tabId = `saved-${uid}`;
      const updated = loadSavedPatterns().find((x) => x.uid === uid);
      if (Tabbed?.openTabs?.has(tabId)) {
        const panel = Tabbed.openTabs.get(tabId).panel;
        renderSavedPatternPanel(panel, updated);
        // mettre à jour le titre de l'onglet
        Tabbed.openTabs.get(tabId).btn.firstChild.nodeValue =
          updated.name || updated.patternKey;
      }

      // si la liste est à l’écran, on la rafraîchit
      const listModal = document.getElementById("saved-patterns-list-modal");
      if (listModal && listModal.style.display === "block") {
        openSavedPatternsListModal();
      }
    },
  });
}

function openSavedPatternsListModal() {
  const modal = document.getElementById("saved-patterns-list-modal");
  if (!modal) {
    console.warn("[saved list] modal introuvable (#saved-patterns-list-modal)");
    return;
  }

  // Toujours tout en haut et tout à la fin du body (évite d’être “sous” les onglets)
  modal.style.zIndex = "6000";
  document.body.appendChild(modal);

  const body = modal.querySelector("#splist-body");
  const closeBtn = modal.querySelector("#splist-close");
  const backdrop = modal.querySelector(".modal__backdrop");

  if (!body) {
    console.warn("[saved list] #splist-body introuvable");
    return;
  }
  if (!closeBtn) {
    console.warn("[saved list] #splist-close introuvable");
  }
  // backdrop peut être absent selon ton HTML ; on protège.

  body.innerHTML = "";
  const items = loadSavedPatterns()
    .slice()
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  if (!items.length) {
    body.innerHTML =
      '<div style="color:#aaa">Aucun pattern enregistré pour le moment.</div>';
  } else {
    items.forEach((rec) => {
      const card = document.createElement("div");
      card.className = "saved-item";

      const h = document.createElement("h4");
      h.textContent = `${rec.name || rec.patternKey}  (${rec.patternKey})`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `Enregistré: ${fmtDate(rec.savedAt)} • Fragments: ${rec.elements?.length || 0}`;

      const row = document.createElement("div");
      row.className = "row";

      const bOpen = document.createElement("button");
      bOpen.className = "tab-btn btn-sm primary";
      bOpen.textContent = "Consulter";
      bOpen.onclick = () => {
        modal.style.display = "none";
        openSavedPatternPanel(rec.uid);
      };

      const bEdit = document.createElement("button");
      bEdit.className = "tab-btn btn-sm";
      bEdit.textContent = "Modifier";
      bEdit.onclick = () => openEditSavedPatternModal(rec.uid);

      const bDel = document.createElement("button");
      bDel.className = "tab-btn btn-sm danger";
      bDel.textContent = "Supprimer";
      bDel.onclick = () => {
        deleteSavedPattern(rec.uid);
        openSavedPatternsListModal();
      };

      row.append(bOpen, bEdit, bDel);

      const p = document.createElement("div");
      p.style.cssText = "margin-top:6px;color:#ccc;white-space:pre-wrap";
      p.textContent = rec.description || "—";

      card.append(h, meta, row, p);
      body.appendChild(card);
    });
  }

  function close() {
    modal.style.display = "none";
    cleanup();
  }
  function cleanup() {
    if (backdrop) backdrop.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
  }
  if (backdrop) backdrop.onclick = close;
  if (closeBtn) closeBtn.onclick = close;

  modal.style.display = "block";
}

// 1) expose la fonction pour l’appel console (tu l’as déjà)
window.openSavedPatternsListModal = openSavedPatternsListModal;

// place ceci UNE SEULE FOIS dans ton script (après que le DOM existe)
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("saved-patterns-list-btn");
  if (!btn) return;

  // on coupe toute propagation pour éviter qu’un handler externe “mange” le clic
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSavedPatternsListModal();
  });
});

function openSavedPatternPanel(uid) {
  const items = loadSavedPatterns();
  const rec = items.find((x) => x.uid === uid);
  if (!rec) return;

  openTab({
    id: `saved-${uid}`,
    title: rec.name || rec.patternKey,
    kind: "saved-pattern",
    render: (panel) => renderSavedPatternPanel(panel, rec),
  });
}

function renderSavedPatternPanel(panel, rec) {
  panel.innerHTML = "";

  const h2 = document.createElement("h2");
  h2.textContent = `${rec.name || rec.patternKey} — (enregistré)`;
  const meta = document.createElement("div");
  meta.style.cssText = "color:#aaa;font-size:12px;margin-bottom:8px";
  meta.textContent = `ID: ${rec.patternKey} • Fragments: ${rec.elements?.length || 0} • Sauvé: ${fmtDate(rec.savedAt)}${rec.updatedAt ? " • Modifié: " + fmtDate(rec.updatedAt) : ""}`;

  const desc = document.createElement("p");
  desc.textContent = rec.description || "—";

  // Critères (badges)
  const critsWrap = document.createElement("div");
  critsWrap.style.cssText = "margin:6px 0 12px";
  const critMask = criteriaDictToMask(rec.criteria || {});
  const cTitle = document.createElement("div");
  cTitle.innerHTML = "<strong>Critères du snapshot :</strong>";
  const cBadges = badgesFromMask(critMask, "badge-shared"); // même style "partagés"
  critsWrap.append(cTitle, cBadges);

  // Membres
  const list = document.createElement("div");
  list.className = "pattern-members";

  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map((f) => [f.properties.id, f]));

  (rec.elements || []).forEach((id) => {
    const f = byId.get(id);
    const row = document.createElement("div");
    row.className = "member-row";
    const thumb = document.createElement("div");
    thumb.className = "member-thumb";
    const first = cleanPhotoUrl(normalizePhotos(f?.properties?.photos)[0]);
    if (first) thumb.style.backgroundImage = `url("${first}")`;

    const title = document.createElement("div");
    title.className = "member-title";
    title.textContent = f?.properties?.name
      ? `${id} — ${f.properties.name}`
      : id;

    const why = document.createElement("div");
    why.className = "member-why";
    const fragMask = f ? getActiveMaskFor(f) : 0;
    const { shared, different } = diffCriteria(critMask, fragMask);

    const rowShared = document.createElement("div");
    rowShared.className = "crit-row";
    rowShared.innerHTML = `<span class="crit-label">Partagés</span>`;
    rowShared.appendChild(badgesFromMask(shared, "badge-shared"));
    const rowDifferent = document.createElement("div");
    rowDifferent.className = "crit-row";
    rowDifferent.innerHTML = `<span class="crit-label">Différents</span>`;
    rowDifferent.appendChild(badgesFromMask(different, "badge-different"));

    why.append(rowShared, rowDifferent);
    const right = document.createElement("div");
    right.className = "member-right";
    right.append(title, why);
    row.append(thumb, right);
    row.addEventListener("click", () => {
      if (f) showDetails(f.properties);
    });
    list.appendChild(row);
  });

  // Actions (un seul bouton "Modifier")
  const actions = document.createElement("div");
  actions.className = "btn-row";

  const bEdit = document.createElement("button");
  bEdit.className = "tab-btn btn-sm";
  bEdit.textContent = "Modifier";
  bEdit.onclick = () => openEditSavedPatternModal(rec.uid);

  const bDel = document.createElement("button");
  bDel.className = "tab-btn btn-sm danger";
  bDel.textContent = "Supprimer";
  bDel.onclick = () => {
    // suppression immédiate, sans confirmation
    deleteSavedPattern(rec.uid);
    // fermer l’onglet courant s’il est ouvert
    const id = `saved-${rec.uid}`;
    if (Tabbed?.openTabs?.has(id)) closeTab(id);
  };

  actions.append(bEdit, bDel);

  panel.append(h2, meta, desc, critsWrap, actions, list);
}

/*==================================================
=                    ANALOGIES                     =
==================================================*/

const ANAL_SAVE_KEY = "analogiesV1";
let Anal = {
  inited: false,
  els: {
    view: null,
    railList: null,
    railSearch: null,
    railFilterBtn: null,
    board: null,
    cells: [],
    title: null,
    btnNew: null,
    btnSave: null,
    btnOpen: null,
    btnExport: null,
    fileInput: null,
    savedModal: null,
    savedBody: null,
    savedClose: null,
  },
  state: {
    // 4 cases : { kind:'fragment'|'image'|'note'|null, data:{...}, overlays?:[{id,x,y,text}] }
    cells: [{ kind: null }, { kind: null }, { kind: null }, { kind: null }],
    title: "",
  },
  pendingImportSlot: null,
  dragLabel: {
    active: false,
    slot: null,
    id: null,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  }, // drag des labels
};

function initAnalogiesOnce() {
  if (Anal.inited) return;

  // --- capture DOM
  Anal.els.view = document.getElementById("analogies-view");
  Anal.els.railList = document.getElementById("anal-rail-list");
  Anal.els.railSearch = document.getElementById("anal-rail-search");
  Anal.els.board = document.getElementById("anal-board");
  Anal.els.title = document.getElementById("anal-title-input");
  Anal.els.btnNew = document.getElementById("anal-new-btn");
  Anal.els.btnSave = document.getElementById("anal-save-btn");
  Anal.els.btnOpen = document.getElementById("anal-open-btn");
  Anal.els.btnExport = document.getElementById("anal-export-btn");
  Anal.els.fileInput = document.getElementById("anal-file-input");
  Anal.els.savedModal = document.getElementById("anal-saved-modal");
  Anal.els.savedBody = document.getElementById("anal-saved-body");
  Anal.els.savedClose = document.getElementById("anal-saved-close");

  // --- style cadran 2x2 noir épais, sans arrondis
  if (Anal.els.board) {
    Anal.els.board.style.cssText = [
      "display:grid",
      "grid-template-columns:1fr 1fr",
      "grid-template-rows:1fr 1fr",
      "gap:0",
      "border:4px solid #000",
      "background:#fff", // fonds neutre
      "border-radius:0",
      "overflow:hidden",
    ].join(";");
  }

  // Hauteur du cadran : ajuste si tu veux un autre ratio (ici 4/3 paysage)
  const h = Math.max(420, Math.min(window.innerHeight * 0.7, 720));
  Anal.els.board.style.height = h + "px";
  Anal.els.board.style.width = h * 1.3333 + "px"; // 4/3 = paysage
  Anal.els.board.style.maxWidth = "80vw";
  Anal.els.board.style.margin = "0 auto"; // centre horizontalement

  // 4 cellules
  Anal.els.cells = Array.from(Anal.els.board.querySelectorAll(".anal-cell"));
  // pose les bordures internes épaisses pour un quadrillage net
  Anal.els.cells.forEach((cell, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    cell.style.border = "0"; // reset
    cell.style.borderRadius = "0";
    cell.style.position = "relative";
    cell.style.overflow = "hidden"; // ⇦ empêche l’agrandissement
    cell.style.minHeight = "0"; // important pour les grilles
    cell.style.display = "block"; // pas de layout flex qui pousse
    // traits internes (4px noirs) : bas pour la première rangée, droite pour la première colonne
    if (row === 0) cell.style.borderBottom = "4px solid #000";
    if (col === 0) cell.style.borderRight = "4px solid #000";
  });

  // --- listeners rail
  Anal.els.railSearch.addEventListener(
    "input",
    debounce(renderAnalogiesRail, 120)
  );
  Anal.els.railFilterBtn?.addEventListener("click", () => {
    document.getElementById("toggle-legend-btn")?.click?.();
  });

  // --- listeners board
  Anal.els.cells.forEach((cell) => wireAnalogiesCell(cell));

  // --- toolbar
  Anal.els.btnNew.addEventListener("click", () => {
    if (!confirm("Créer une nouvelle carte et vider les 4 cases ?")) return;
    resetAnalogiesBoard();
  });

  Anal.els.btnSave.addEventListener("click", () => {
    const rec = serializeAnalogy();
    if (!rec.title.trim()) {
      alert("Donne un titre à la carte avant d’enregistrer.");
      Anal.els.title.focus();
      return;
    }
    addSavedAnalogy(rec);
    alert("Carte enregistrée en local.");
  });

  Anal.els.btnOpen.addEventListener("click", openAnalogiesSavedModal);
  Anal.els.btnExport.addEventListener("click", () => {
    const rec = serializeAnalogy();
    const blob = new Blob([JSON.stringify(rec, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (rec.title || "analogie") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // input fichier unique partagé
  Anal.els.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || Anal.pendingImportSlot == null) return;
    const dataUrl = await fileToDataURL(file);
    setCellContent(Anal.pendingImportSlot, {
      kind: "image",
      data: { dataUrl, name: file.name || "image" },
      overlays: [],
    });
    Anal.pendingImportSlot = null;
  });

  // collage (presse-papiers) : si une case a le focus, on la vise; sinon, dernière focale
  Anal.els.view.addEventListener("paste", async (e) => {
    const targetCell = e.target.closest?.(".anal-cell");
    const slot = targetCell
      ? parseInt(targetCell.dataset.slot, 10)
      : findFocusedCellSlot();
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file") {
        const file = it.getAsFile();
        if (!file) continue;
        const dataUrl = await fileToDataURL(file);
        setCellContent(slot ?? 0, {
          kind: "image",
          data: { dataUrl, name: file.name || "pasted" },
          overlays: [],
        });
        e.preventDefault();
        return;
      } else if (it.kind === "string") {
        it.getAsString((txt) => {
          const t = (txt || "").trim();
          if (t) setCellContent(slot ?? 0, { kind: "note", data: { text: t } });
        });
        e.preventDefault();
        return;
      }
    }
  });

  // drag global des labels (pour éviter sélection involontaire)
  window.addEventListener("mousemove", onLabelDragMove);
  window.addEventListener("mouseup", onLabelDragEnd);

  // réagir aux filtres de zones → rail
  document.querySelectorAll(".filter-zone").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (currentView === "analogies") renderAnalogiesRail();
    });
  });

  // init
  renderAnalogiesRail();
  resetAnalogiesBoard();
  Anal.inited = true;
}

function showAnalogiesView() {
  renderAnalogiesRail();
}

/* ------------ RAIL (vignettes de fragments) ------------- */

function renderAnalogiesRail() {
  if (!Anal.els.railList) return;
  Anal.els.railList.innerHTML = "";

  const q = (Anal.els.railSearch.value || "").toLowerCase().trim();
  const all = [...(dataGeojson || []), ...(datamGeojson || [])].filter(
    (f) => isFeatureInActiveZones(f) && !f.properties?.isDiscourse
  );

  all.forEach((f) => {
    const fid = f.properties.id;
    const name = (f.properties.name || "").toLowerCase();
    if (q && !fid.toLowerCase().includes(q) && !name.includes(q)) return;

    const photos = normalizePhotos(f.properties.photos)
      .map(cleanPhotoUrl)
      .filter(Boolean);
    const src = photos[0] || "";
    const card = document.createElement("div");
    card.className = "anal-thumb";
    card.style.cssText =
      "border:1px solid #000;background:#fff;overflow:hidden;border-radius:0;";

    const img = document.createElement("img");
    img.src =
      src ||
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    img.alt = f.properties.name || fid;
    img.loading = "lazy";
    img.style.cssText =
      "display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:0;";

    // drag payload (aucun titre/caption)
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({
          kind: "fragment",
          id: fid,
          photo: src,
          name: f.properties.name || fid,
        })
      );
      e.dataTransfer.effectAllowed = "copy";
    });
    card.addEventListener("click", () => showDetails(f.properties));

    card.append(img);
    Anal.els.railList.appendChild(card);
  });
}

/* ------------ CELLS (drop/import/paste/note + overlay texte) ------------- */

function wireAnalogiesCell(cell) {
  const slot = parseInt(cell.dataset.slot, 10);
  const contentEl = cell.querySelector(".anal-cell-content");
  const dropEl = cell.querySelector(".anal-cell-drop");
  const btnImport = cell.querySelector(".anal-cell-import");
  const btnClear = cell.querySelector(".anal-cell-clear");

  // fond neutre et angles vifs
  cell.style.background = "#fff";
  if (contentEl) {
    contentEl.style.position = "absolute";
    contentEl.style.inset = "0"; // top/right/bottom/left = 0
  }
  if (dropEl) {
    dropEl.style.position = "absolute";
    dropEl.style.inset = "0";
    dropEl.style.display = "flex";
    dropEl.style.alignItems = "center";
    dropEl.style.justifyContent = "center";
  }

  // DnD (toujours sur la case entière)
  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    cell.style.outline = "2px dashed #000";
  });
  cell.addEventListener("dragleave", () => {
    cell.style.outline = "none";
  });
  cell.addEventListener("drop", async (e) => {
    e.preventDefault();
    cell.style.outline = "none";
    const dt = e.dataTransfer;
    let jsonOk = false;
    try {
      const payload = JSON.parse(dt.getData("application/json") || "null");
      if (payload?.kind === "fragment" && payload.id) {
        setCellContent(slot, {
          kind: "fragment",
          data: {
            id: payload.id,
            photo: payload.photo || null,
            name: payload.name || payload.id,
          },
          overlays: [],
        });
        jsonOk = true;
      }
    } catch (_) {}
    if (jsonOk) return;
    if (dt.files && dt.files[0] && dt.files[0].type.startsWith("image/")) {
      const dataUrl = await fileToDataURL(dt.files[0]);
      setCellContent(slot, {
        kind: "image",
        data: { dataUrl, name: dt.files[0].name || "image" },
        overlays: [],
      });
      return;
    }
    const txt = dt.getData("text/plain");
    if (txt && txt.trim())
      setCellContent(slot, { kind: "note", data: { text: txt.trim() } });
  });

  // Import / Clear
  btnImport?.addEventListener("click", () => {
    Anal.pendingImportSlot = slot;
    Anal.els.fileInput.click();
  });
  btnClear?.addEventListener("click", () => clearCell(slot));

  // ⬇️ Double-clic sur TOUTE la case :
  // - image/fragment → ajoute un label à l’endroit cliqué
  // - note → focus texte
  // - vide → bascule en note
  cell.addEventListener("dblclick", (ev) => {
    // évite d’ajouter un label quand on double-clique sur un bouton / input / label existant
    if (
      ev.target.closest(".overlay-label") ||
      ev.target.closest(".tab-btn") ||
      ev.target.tagName === "TEXTAREA" ||
      ev.target.tagName === "INPUT"
    )
      return;

    const cur = Anal.state.cells[slot];

    // position du clic en % de la surface utile (overlay-layer si présent, sinon la case)
    const layer = cell.querySelector(".overlay-layer");
    const refEl = layer || cell;
    const rect = refEl.getBoundingClientRect();
    const xPct = Math.min(
      100,
      Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100)
    );
    const yPct = Math.min(
      100,
      Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100)
    );

    if (cur?.kind === "image" || cur?.kind === "fragment") {
      addOverlayLabel(slot, { x: xPct, y: yPct, text: "Texte" });
    } else if (cur?.kind === "note") {
      const ta = cell.querySelector(".anal-cell-content textarea");
      if (ta) {
        ta.focus();
        ta.select();
      }
    } else {
      setCellContent(slot, { kind: "note", data: { text: "" } });
    }
  });
}

function setCellContent(slot, payload) {
  const cell = Anal.els.cells[slot];
  const contentEl = cell.querySelector(".anal-cell-content");
  const dropEl = cell.querySelector(".anal-cell-drop");
  contentEl.innerHTML = "";
  dropEl.style.display = "none";
  contentEl.style.position = "absolute";
  contentEl.style.inset = "0";

  // toolbar overlay : bouton 'Texte' pour ajouter un label
  function mountOverlayToolbar() {
    const tb = document.createElement("div");
    tb.style.cssText =
      "position:absolute;top:6px;left:6px;display:flex;gap:6px;z-index:5";
    const btnTxt = document.createElement("button");
    btnTxt.textContent = "Texte";
    btnTxt.className = "tab-btn btn-xs";
    btnTxt.style.cssText =
      "padding:3px 6px;border:1px solid #000;background:#fff;color:#000;border-radius:0;cursor:pointer";
    btnTxt.addEventListener("click", () =>
      addOverlayLabel(slot, { x: 50, y: 50, text: "Texte" })
    );
    tb.appendChild(btnTxt);
    contentEl.appendChild(tb);
  }

  // calque overlays
  function mountOverlayLayer() {
    let layer = contentEl.querySelector(".overlay-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "overlay-layer";
      layer.style.cssText = "position:absolute;inset:0;z-index:4";
      contentEl.appendChild(layer);
    }
    return layer;
  }

  Anal.state.cells[slot] = payload;

  if (payload.kind === "fragment" || payload.kind === "image") {
    const src =
      payload.kind === "fragment"
        ? payload.data.photo || ""
        : payload.data.dataUrl;
    const img = document.createElement("img");
    img.src =
      src ||
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    img.alt = payload.data.name || payload.data.id || "image";
    img.style.cssText =
      "display:block;width:100%;height:100%;object-fit:contain;object-position:center center;border:0;border-radius:0;user-select:none;";
    contentEl.appendChild(img);

    mountOverlayToolbar();
    const layer = mountOverlayLayer();
    layer.innerHTML = "";
    (payload.overlays || []).forEach((lbl) =>
      layer.appendChild(buildLabelEl(slot, lbl))
    );
  } else if (payload.kind === "note") {
    const ta = document.createElement("textarea");
    ta.value = payload.data.text || "";
    ta.rows = 8;
    ta.style.cssText =
      "width:100%;height:100%;box-sizing:border-box;resize:vertical;border:none;border-radius:0;padding:8px;";
    ta.addEventListener("input", () => {
      Anal.state.cells[slot].data.text = ta.value;
    });
    contentEl.appendChild(ta);
  } else {
    dropEl.style.display = "flex";
  }
}

/* ---------- Overlays texte (labels) ---------- */

function addOverlayLabel(slot, { x = 50, y = 50, text = "Texte" } = {}) {
  // x,y en pourcentage de la surface (0..100)
  const lbl = {
    id: "lbl_" + Math.random().toString(36).slice(2, 8),
    x,
    y,
    text,
  };
  const cellState = Anal.state.cells[slot];
  if (!cellState.overlays) cellState.overlays = [];
  cellState.overlays.push(lbl);

  const cell = Anal.els.cells[slot];
  const layer =
    cell.querySelector(".overlay-layer") ||
    (() => {
      const l = document.createElement("div");
      l.className = "overlay-layer";
      l.style.cssText = "position:absolute;inset:0;z-index:4";
      cell.querySelector(".anal-cell-content").appendChild(l);
      return l;
    })();
  layer.appendChild(buildLabelEl(slot, lbl));
}

function buildLabelEl(slot, lbl) {
  const el = document.createElement("div");
  el.className = "overlay-label";
  el.dataset.id = lbl.id;
  el.style.cssText = [
    "position:absolute",
    `left:calc(${lbl.x}% )`,
    `top:calc(${lbl.y}% )`,
    "transform:translate(-50%,-50%)",
    "min-width:40px",
    "max-width:80%",
    "padding:4px 8px",
    "border:1px solid #000",
    "background:#fff",
    "color:#000",
    "font-size:12px",
    "line-height:1.2",
    "cursor:move",
    "user-select:none",
    "border-radius:0",
    "box-shadow:none",
  ].join(";");

  const textEl = document.createElement("span");
  textEl.textContent = lbl.text || "Texte";
  textEl.style.display = "inline-block";
  textEl.style.cursor = "text";
  textEl.addEventListener("click", (e) => {
    e.stopPropagation();
    startInlineEdit(slot, lbl.id, textEl);
  });

  const close = document.createElement("button");
  close.textContent = "×";
  close.title = "Supprimer";
  close.style.cssText =
    "margin-left:6px;border:none;background:#fff;color:#000;width:18px;height:18px;line-height:14px;padding:0;cursor:pointer;border-radius:0;";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    removeOverlayLabel(slot, lbl.id);
  });

  // drag
  el.addEventListener("mousedown", (e) => {
    if (e.target === close) return;
    Anal.dragLabel = {
      active: true,
      slot,
      id: lbl.id,
      startX: e.clientX,
      startY: e.clientY,
      baseX: lbl.x,
      baseY: lbl.y,
    };
    e.preventDefault();
  });

  el.append(textEl, close);
  return el;
}

function startInlineEdit(slot, id, spanEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = spanEl.textContent || "";
  input.style.cssText =
    "border:1px solid #000;padding:2px 4px;width:200px;max-width:60vw;border-radius:0;";
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const val = (input.value || "").trim();
    const cell = Anal.state.cells[slot];
    const lbl = (cell.overlays || []).find((o) => o.id === id);
    if (lbl) lbl.text = val || "Texte";
    const newSpan = document.createElement("span");
    newSpan.textContent = lbl ? lbl.text : "";
    newSpan.style.display = "inline-block";
    newSpan.style.cursor = "text";
    newSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      startInlineEdit(slot, id, newSpan);
    });
    input.replaceWith(newSpan);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
  });
}

function removeOverlayLabel(slot, id) {
  const cell = Anal.state.cells[slot];
  cell.overlays = (cell.overlays || []).filter((o) => o.id !== id);
  const layer = Anal.els.cells[slot].querySelector(".overlay-layer");
  layer?.querySelector(`[data-id="${id}"]`)?.remove();
}

function onLabelDragMove(e) {
  const d = Anal.dragLabel;
  if (!d.active) return;
  const cell = Anal.els.cells[d.slot];
  const layer = cell.querySelector(".overlay-layer");
  if (!layer) return;

  const rect = layer.getBoundingClientRect();
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  const newX = Math.min(100, Math.max(0, d.baseX + (dx / rect.width) * 100));
  const newY = Math.min(100, Math.max(0, d.baseY + (dy / rect.height) * 100));

  // maj state
  const cellState = Anal.state.cells[d.slot];
  const lbl = (cellState.overlays || []).find((o) => o.id === d.id);
  if (lbl) {
    lbl.x = newX;
    lbl.y = newY;
  }

  // maj DOM
  const el = layer.querySelector(`[data-id="${d.id}"]`);
  if (el) {
    el.style.left = `${newX}%`;
    el.style.top = `${newY}%`;
  }
}

function onLabelDragEnd() {
  Anal.dragLabel.active = false;
}

/* ------------ gestion vide/reset/clear ------------- */

function clearCell(slot) {
  Anal.state.cells[slot] = { kind: null };
  const cell = Anal.els.cells[slot];
  cell.querySelector(".anal-cell-content").innerHTML = "";
  cell.querySelector(".anal-cell-drop").style.display = "flex";
}

function resetAnalogiesBoard() {
  Anal.els.title.value = "";
  Anal.state.title = "";
  for (let i = 0; i < 4; i++) clearCell(i);
}

/* ------------ Sauvegarde / Ouverture ------------- */

function serializeAnalogy() {
  Anal.state.title = Anal.els.title.value || "";
  // on copie un payload “léger”, y compris les overlays (pour image/fragment)
  const cells = Anal.state.cells.map((c) => {
    if (!c || !c.kind) return { kind: null };
    if (c.kind === "image")
      return {
        kind: "image",
        data: { dataUrl: c.data.dataUrl || "" },
        overlays: c.overlays || [],
      };
    if (c.kind === "fragment")
      return {
        kind: "fragment",
        data: { id: c.data.id, photo: c.data.photo || null },
        overlays: c.overlays || [],
      };
    if (c.kind === "note")
      return { kind: "note", data: { text: c.data.text || "" } };
    return { kind: null };
  });
  return {
    uid:
      "an_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: Anal.state.title,
    cells,
    savedAt: new Date().toISOString(),
  };
}

function addSavedAnalogy(rec) {
  const arr = loadSavedAnalogies();
  arr.push(rec);
  localStorage.setItem(ANAL_SAVE_KEY, JSON.stringify(arr));
}
function loadSavedAnalogies() {
  try {
    return JSON.parse(localStorage.getItem(ANAL_SAVE_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
function deleteSavedAnalogy(uid) {
  const arr = loadSavedAnalogies().filter((x) => x.uid !== uid);
  localStorage.setItem(ANAL_SAVE_KEY, JSON.stringify(arr));
}

function openAnalogiesSavedModal() {
  const m = Anal.els.savedModal;
  const body = Anal.els.savedBody;
  const close = Anal.els.savedClose;
  if (!m || !body) return;

  body.innerHTML = "";
  const items = loadSavedAnalogies()
    .slice()
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  if (!items.length) {
    body.innerHTML =
      '<div style="color:#aaa">Aucune carte d’analogies enregistrée.</div>';
  } else {
    items.forEach((rec) => {
      const card = document.createElement("div");
      card.style.cssText =
        "border:1px solid #000;padding:10px;margin-bottom:8px;color:#000;background:#fff;border-radius:0;";
      const h = document.createElement("div");
      h.style.fontWeight = "700";
      h.textContent = rec.title || "(sans titre)";
      const meta = document.createElement("div");
      meta.style.cssText = "color:#333;font-size:12px;margin:4px 0 8px";
      meta.textContent = `Sauvé le ${fmtDate(rec.savedAt)}`;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
      const bOpen = document.createElement("button");
      bOpen.className = "tab-btn btn-sm primary";
      bOpen.textContent = "Ouvrir";
      bOpen.style.cssText =
        "border:1px solid #000;background:#fff;color:#000;border-radius:0;";
      bOpen.onclick = () => {
        m.style.display = "none";
        loadAnalogyIntoBoard(rec);
      };
      const bDel = document.createElement("button");
      bDel.className = "tab-btn btn-sm danger";
      bDel.textContent = "Supprimer";
      bDel.style.cssText =
        "border:1px solid #000;background:#000;color:#fff;border-radius:0;";
      bDel.onclick = () => {
        deleteSavedAnalogy(rec.uid);
        openAnalogiesSavedModal();
      };
      row.append(bOpen, bDel);
      card.append(h, meta, row);
      body.appendChild(card);
    });
  }

  close.onclick = () => {
    m.style.display = "none";
  };
  m.querySelector(".modal__backdrop")?.addEventListener(
    "click",
    () => (m.style.display = "none")
  );
  m.style.display = "block";
}

function loadAnalogyIntoBoard(rec) {
  resetAnalogiesBoard();
  Anal.els.title.value = rec.title || "";
  Anal.state.title = rec.title || "";
  (rec.cells || []).forEach((c, i) => {
    if (!c || !c.kind) return;
    setCellContent(i, c);
  });
}

/* ------------ Utils ------------- */

function findFocusedCellSlot() {
  const el = document.activeElement;
  const cell = el?.closest?.(".anal-cell");
  return cell ? parseInt(cell.dataset.slot, 10) : null;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
