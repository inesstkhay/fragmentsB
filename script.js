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
let _stickyDiscId = null; // nouvel état sticky pour un discours

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


// --- Mode d'affichage texte sur la carte patterns ---
// 'noms' | 'criteres' | 'usages' | 'discours'
let patternDisplayMode = localStorage.getItem("patternDisplayMode") || "noms";


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
clearSticky();
undimAll();

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
    currentView === "gallery" 
  ) {
    const visibleFeatures = allLayers
      .filter((layer) => map.hasLayer(layer))
      .map((layer) => layer.feature);
    patterns = identifyPatterns(visibleFeatures);
    if (currentView === "gallery") showGalleryView();
    else if (currentView === "proxemic") showProxemicView();
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
  } 
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


/* ===========================
   AGRÉGATION PAR PATTERN
   =========================== */

// normalise une chaîne pour agréger (clé) tout en gardant l'original (label)
function _normKey(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// renvoie { tokens: Array<{key,label,count,family,fragIds:Set<string> }>, maxCount }
function collectAggregatedTokens(elements, mode, byId) {
  const map = new Map(); // key -> { label, count, family, fragIds:Set }

  function addToken(rawLabel, family, fragId) {
    const key = _normKey(rawLabel);
    if (!key) return;
    const rec = map.get(key) || {
      label: rawLabel.trim(),
      count: 0,
      family: family || "autre",
      fragIds: new Set(),
    };
    rec.count += 1;
    if (fragId) rec.fragIds.add(fragId);
    // si plusieurs variantes de casse existent, on garde la + longue (affichage)
    if (rawLabel.length > rec.label.length) rec.label = rawLabel;
    map.set(key, rec);
  }

  // --- remonte le contenu selon le mode ---
  (elements || []).forEach((id) => {
    const f = byId.get(id);
    if (!f || f.properties?.isDiscourse) return;
    if (!isFeatureInActiveZones || !isFeatureInActiveZones(f)) return;

    const fid = f.properties?.id || id;

    if (mode === "noms") {
      const name = f.properties?.name || fid;
      addToken(name, "autre", fid);
    }

    if (mode === "usages") {
      const meta = loadFragmentMeta(fid) || { usages: [] };
      (meta.usages || [])
        .map((u) => (u?.text || "").trim())
        .filter(Boolean)
        .forEach((line) => addToken(line, "usage", fid));
    }

    if (mode === "discours") {
      // 1) discours "proches" (geojson "discours" au même point)
      if (discoursLayer) {
        discoursLayer.eachLayer((grp) => {
          const df = grp.feature;
          if (!df) return;
          const sameSpot =
            f.geometry?.type === "Point" &&
            df.geometry?.type === "Point" &&
            df.geometry.coordinates[0] === f.geometry.coordinates[0] &&
            df.geometry.coordinates[1] === f.geometry.coordinates[1];
          if (!sameSpot) return;
          const auteur = (df.properties?.auteur || "").trim();
          const contenu = (df.properties?.contenu || "").trim();
          if (!auteur && !contenu) return;
          const line = (auteur ? auteur + " : " : "") + contenu;
          addToken(line, "discours", fid);
        });
      }
      // 2) discours saisis côté utilisateur
      const meta = loadFragmentMeta(fid) || { discours: [] };
      (meta.discours || [])
        .map((d) => (d?.text || "").trim())
        .filter(Boolean)
        .forEach((line) => addToken(line, "discours", fid));
    }

    if (mode === "criteres") {
      // on réutilise tes clés actives et familles
      activeCriteriaKeysForFeature(f).forEach((k) => {
        const label = CRITERIA_LABELS[k] || k.replace(/_/g, " ");
        const fam = CRIT_FAMILY(k) || "autre";
        addToken(label, fam, fid);
      });
    }
  });

  // trie par fréquence desc, renvoie un tableau
  const tokens = Array.from(map.values()).sort((a, b) => b.count - a.count);
  const maxCount = tokens[0]?.count || 1;
  return { tokens, maxCount };
}

// échelle de taille de police (pondération “nuage”)
function scaleFont(count, maxCount, { minPx = 12, maxPx = 28, gamma = 0.6 } = {}) {
  if (maxCount <= 1) return minPx;
  const t = Math.max(0, Math.min(1, (count - 1) / (maxCount - 1)));
  const eased = Math.pow(t, gamma); // courbe douce
  return Math.round(minPx + eased * (maxPx - minPx));
}



function showProxemicView() {
  // 0) reset la vue
  proxemicView.innerHTML = "";

  // 1) dimensions de la surface et constantes UI
  const viewWidth  = proxemicView.clientWidth  || window.innerWidth;
  const viewHeight = proxemicView.clientHeight || window.innerHeight;

  // marges “boîte” des clusters (on garde une esthétique resserrée)
  const PAD         = 6;   // padding interne du cluster
  const COLLIDE_PAD = 4;   // padding de collision entre clusters

  // --- Catégories (identiques à ta version) ---
  const categories = {
    percu: [
      "frequence_usage_ponctuel","frequence_usage_regulier","frequence_usage_quotidien",
      "mode_usage_prevu","mode_usage_detourne","mode_usage_creatif",
      "intensite_usage_faible","intensite_usage_moyenne","intensite_usage_forte","intensite_usage_saturee",
    ],
    concu: [
      "echelle_micro","echelle_meso","echelle_macro",
      "origine_forme_institutionnelle","origine_forme_singuliere","origine_forme_collective",
      "accessibilite_libre","accessibilite_semi_ouverte","accessibilite_fermee",
      "visibilite_cachee","visibilite_visible","visibilite_exposee",
    ],
    vecu: [
      "acteurs_visibles_habitant","acteurs_visibles_institution","acteurs_visibles_collectif",
      "acteurs_visibles_invisible","rapport_affectif_symbolique",
    ],
  };
  function getDominantCategory(criteria) {
    const counts = { percu: 0, concu: 0, vecu: 0 };
    for (const key of Object.keys(criteria || {})) {
      if (categories.percu.includes(key)) counts.percu++;
      if (categories.concu.includes(key)) counts.concu++;
      if (categories.vecu.includes(key)) counts.vecu++;
    }
    return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
  }

  // 2) positions des 3 pôles
  const positions = {
    percu: { x: viewWidth * 0.25, y: viewHeight * 0.35 },
    concu: { x: viewWidth * 0.75, y: viewHeight * 0.35 },
    vecu:  { x: viewWidth * 0.50, y: viewHeight * 0.80 },
  };

  // 3) index rapide des features par id
  const allFeatures = [ ...(dataGeojson || []), ...(datamGeojson || []) ];
  const byId = new Map(allFeatures.map(f => [f?.properties?.id, f]));

  // 4) on construit un "node" par pattern, avec une boîte (w,h) qui accueillera le nuage
  //    Heuristique simple : largeur = 320 à 560 selon nb d’éléments, hauteur corrélée
  function boxForCount(n) {
    const w = Math.max(320, Math.min(560, 160 + n * 24));  // largeur cluster
    const h = Math.max(160, Math.min(420, 120 + n * 20));  // hauteur cluster
    return { w, h };
  }

  const nodes = Object.entries(patterns || {}).map(([key, pattern]) => {
    const n = (pattern.elements || []).length;
    const { w, h } = boxForCount(n);
    const category = getDominantCategory(pattern.criteria || {});
    return {
      id: key,
      criteria: pattern.criteria || {},
      elements: pattern.elements || [],
      category,
      w, h,
      x: positions[category].x + (Math.random() - 0.5) * 20,
      y: positions[category].y + (Math.random() - 0.5) * 20,
    };
  });

  // 5) surface SVG zoomable
  const svgWidth  = viewWidth  * 2.2;
  const svgHeight = viewHeight * 2.2;
  const svg = d3.select("#proxemic-view")
    .append("svg")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
    .call(d3.zoom().on("zoom", (event) => { root.attr("transform", event.transform); }));
  const root = svg.append("g");

  // 6) simulation : regroupe les clusters par pôle et évite les chevauchements
  const collideRadius = d => 0.5 * Math.hypot(d.w + 2*PAD, d.h + 2*PAD) + COLLIDE_PAD;
  const simulation = d3.forceSimulation(nodes)
    .force("x", d3.forceX(d => positions[d.category].x).strength(0.45))
    .force("y", d3.forceY(d => positions[d.category].y).strength(0.45))
    .force("collide", d3.forceCollide(collideRadius).iterations(2))
    .stop();
  for (let i = 0; i < 160; ++i) simulation.tick();

  // 7) couches : clusters + overlay des étiquettes “Espace perçu/conçu/vécu”
  const clustersLayer = root.append("g").attr("class", "clusters");
  const labelsLayer   = root.append("g").attr("class", "ui-overlay").style("pointer-events", "none");

  // 8) dessiner chaque cluster
  const clusters = clustersLayer
    .selectAll(".pattern-node")
    .data(nodes)
    .join("g")
    .attr("class", "pattern-node")
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (_ev, d) => {
      // ouvre le panneau latéral existant
      showDetails({ isPattern:true, patternKey:d.id, elements:d.elements, criteria:d.criteria });
    });

  // fond de cluster (boîte sombre sans bordure — cohérent avec ta charte)
  clusters.append("rect")
    .attr("x", d => -(d.w/2) - PAD)
    .attr("y", d => -(d.h/2) - PAD)
    .attr("width",  d => d.w + 2*PAD)
    .attr("height", d => d.h + 2*PAD)
    .attr("fill", "#0f0f0f")
    .attr("stroke", "none");

// 9) CONTENU = WORD-CLOUD AGRÉGÉ : foreignObject avec tokens pondérés
clusters.each(function (d) {
  const g = d3
    .select(this)
    .append("foreignObject")
    .attr("x", -(d.w / 2))
    .attr("y", -(d.h / 2))
    .attr("width", d.w)
    .attr("height", d.h);

  const div = g
    .append("xhtml:div")
    .style("width", d.w + "px")
    .style("height", d.h + "px")
    .style("overflow", "auto")
    .style("padding", "6px")
    .style("display", "flex")
    .style("flex-wrap", "wrap")
    .style("align-content", "flex-start")
    .style("gap", "8px");

  // === AGRÉGATION PAR PATTERN, PONDÉRATION PAR FRÉQUENCE ===
  // index rapide (déjà prêt plus haut)
  const byId = new Map([...(dataGeojson || []), ...(datamGeojson || [])].map(f => [f?.properties?.id, f]));
  const { tokens, maxCount } = collectAggregatedTokens(d.elements, patternDisplayMode, byId);

  // Limite soft du nombre d’items pour éviter l’overload visuel
  // (fonction de la surface du bloc — n’hésite pas à ajuster)
  const area = d.w * d.h;
  const maxItems = Math.max(12, Math.min(80, Math.floor(area / 2600)));
  const subset = tokens.slice(0, maxItems);

  subset.forEach((tok) => {
    // taille selon la fréquence (min/max adaptables)
    const fs = scaleFont(tok.count, maxCount, {
      minPx: (patternDisplayMode === "criteres") ? 12 : 12,
      maxPx: (patternDisplayMode === "criteres") ? 26 : 28,
      gamma: 0.65,
    });

    // Élément HTML
    const span = document.createElement("span");

    if (patternDisplayMode === "criteres") {
  // Critères : texte blanc, sans fond ni bordure
  span.className = `token token--${tok.family || "autre"}`;
  span.style.color = "#fff";
  span.style.background = "transparent";
  span.style.border = "none";
} else {
  // Usages / Discours / Noms : texte blanc, fond transparent
  span.className = "agg-token";
  span.style.color = "#fff";
  span.style.background = "transparent";
  span.style.border = "none";
  span.style.lineHeight = "1.15";
}


    span.textContent = tok.label;
    span.style.fontSize = fs + "px";
    span.style.cursor = "default";
    span.title = `${tok.count} occurrence${tok.count > 1 ? "s" : ""} • ${tok.fragIds.size} fragment${tok.fragIds.size > 1 ? "s" : ""}`;

    // (option) Clic sur le token : ouvre le panneau du pattern (déjà sur clic cluster),
    // ou bien ouvre le 1er fragment contributeur (décommente si tu préfères)
    // span.addEventListener("click", () => {
    //   const firstFragId = Array.from(tok.fragIds)[0];
    //   if (!firstFragId) return;
    //   const feat = byId.get(firstFragId);
    //   if (feat) showDetails(feat.properties);
    // });

    div.node().appendChild(span);
  });
});


  // 10) Titre des 3 pôles (overlay)
  function addLabelWithBackground(layer, x, y, textContent) {
    const group = layer.append("g").attr("transform", `translate(${x}, ${y})`);
    const text = group.append("text")
      .text(textContent)
      .attr("x", 0).attr("y", 0)
      .style("fill", "#fff")
      .style("font-size", "16px")
      .style("font-weight", "800")
      .style("text-anchor", "middle")
      .attr("dominant-baseline", "middle");
    const bbox = text.node().getBBox();
    group.insert("rect", "text")
      .attr("x", bbox.x - 8)
      .attr("y", bbox.y - 4)
      .attr("width", bbox.width + 16)
      .attr("height", bbox.height + 8)
      .attr("fill", "rgba(0,0,0,0.85)")
      .attr("rx", 4).attr("ry", 4);
  }
  addLabelWithBackground(labelsLayer, positions.percu.x, positions.percu.y - 80, "Espace perçu");
  addLabelWithBackground(labelsLayer, positions.concu.x, positions.concu.y - 80, "Espace conçu");
  addLabelWithBackground(labelsLayer, positions.vecu.x,  positions.vecu.y + 80, "Espace vécu");
  labelsLayer.raise();
}


/*==================================================
=               GESTION DES VUES (UI)              =
==================================================*/

function updateInterfaceElements(viewId) {
  const legendBtn = document.getElementById("toggle-legend-btn");
  const locationBtn = document.getElementById("toggle-location-btn");
  const similarityControls = document.getElementById("similarity-controls");

  // La légende est utile pour ces vues 
  const wantsLegend =
    viewId === "proxemic" ||
    viewId === "gallery" ||
    viewId === "patterns-map";

  if (legendBtn) legendBtn.style.display = wantsLegend ? "block" : "none";
  if (locationBtn)
    locationBtn.style.display =
      viewId === "map" || viewId === "patterns-map" || viewId === "unit"
        ? "block"
        : "none";


  updateTextualModeVisibility();
}

// Affiche/masque la box "Affichage : Noms / Critères / Usages / Discours"
function updateTextualModeVisibility() {
  const box = document.getElementById('textual-mode');
  if (!box) return;

  // visible seulement sur Carte (patterns-map) et Proxémie
  const shouldShow = (currentView === 'patterns-map' || currentView === 'proxemic');
  box.style.display = shouldShow ? 'flex' : 'none';
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
  }


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
updateTextualModeVisibility();


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
   const radios = document.querySelectorAll('#textual-mode input[name="pmode"]');
  radios.forEach(r => {
    if (r.value === patternDisplayMode) r.checked = true;
    r.addEventListener("change", () => {
      patternDisplayMode = r.value;
      localStorage.setItem("patternDisplayMode", patternDisplayMode);
      if (currentView === "patterns-map") {
        renderPatternBaseGrey();
        clearSticky();
        refreshPatternsMap();
      } else if (currentView === "proxemic") {
        showProxemicView(); // ← ajoute cette ligne pour que le mode texte s'applique aussi en Proxémie
      }
    });
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


// Échelle de police agressive (petit longtemps, puis grossit vite)
const LABEL_SIZE_CFG = {
  minZoom: 9,
  maxZoom: 20,
  minPx: 1,   // avant 0.75
  maxPx: 26,    // avant 30 → beaucoup moins massif
  gamma: 2.6    // croissance plus douce
};

function applyLabelSize(){
  if (!patternMap) return;
  const {minZoom, maxZoom, minPx, maxPx, gamma} = LABEL_SIZE_CFG;
  const z = Math.max(minZoom, Math.min(maxZoom, patternMap.getZoom()));
  const t = (z - minZoom) / (maxZoom - minZoom || 1);
  const eased = Math.pow(t, gamma);
  const px = Math.max(0.5, Math.round(minPx + eased * (maxPx - minPx)));
  const host = document.getElementById('patterns-map');
  if (host) host.style.setProperty('--fragLabelSize', px + 'px');
}


function initPatternMapOnce() {
  if (patternMap) return;

  patternMap = L.map("patterns-map", {
  zoomControl: true,
  attributionControl: true,
  zoomAnimation: true,         // ⟵ true
  markerZoomAnimation: true    // ⟵ true
}).setView(montreuilView, montreuilZoom);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors, © CartoDB",
  }).addTo(patternMap);

  patternBaseLayer  = L.layerGroup().addTo(patternMap);
  patternImageLayer = L.layerGroup().addTo(patternMap);
  patternLinkLayer  = L.layerGroup().addTo(patternMap);

  patternMap.createPane("pane-links");
  patternMap.getPane("pane-links").style.zIndex = 800;

  patternMap.on("moveend", () => {
    if (_stickyFragId) drawLinksForFragment(_stickyFragId);
  });

  patternMap.on("click", (e) => {
    if (!e.originalEvent?.target?.closest(".frag-thumb, .frag-label")) clearSticky();
  });



  patternMap.on('zoomend', updateFarOpacity);
patternMap.on('moveend', updateFarOpacity);
patternMap.on('movestart', () => { if (!_stickyFragId) undimAll(); });
patternMap.on('zoomstart', () => { if (!_stickyFragId) undimAll(); });
patternMap.on('zoomend',   () => { if (!_stickyFragId) undimAll(); });


  document.addEventListener("keydown", (ev) => {
    if (currentView === "patterns-map" && ev.key === "Escape") clearSticky();
  });

  fetch("data/contour.geojson")
    .then(r => r.json())
    .then(contour => {
      L.geoJSON(contour, { style: { color:"#919090", weight:2, opacity:0.8, fillOpacity:0 }})
       .addTo(patternMap);
    });

  // taille initiale et écouteurs liés au zoom/pan
  applyLabelSize();
  patternMap.on('zoom', applyLabelSize);
  patternMap.on('zoomend', () => {
    applyLabelSize();
    layoutWordCloud();
  });
  patternMap.on('moveend', () => {
  if (_stickyFragId) drawLinksForFragment(_stickyFragId);
 });
}


function _isFar(latlng) {
  const centerPx    = patternMap.latLngToLayerPoint(latlng);
  const mapCenterPx = patternMap.latLngToLayerPoint(patternMap.getCenter());
  const dist = Math.hypot(centerPx.x - mapCenterPx.x, centerPx.y - mapCenterPx.y);
  // seuil adaptable au zoom si tu veux : e.g. 600 * (14 / patternMap.getZoom())
  return dist > 600;
}

function updateFarOpacity() {
  if (!patternMap || !patternImageLayer) return;
  patternImageLayer.eachLayer((m) => {
    const el = m.getElement?.()?.querySelector(".frag-label");
    if (!el) return;
    if (_isFar(m.getLatLng())) el.classList.add("far");
    else el.classList.remove("far");
  });
}


function makeDiscourseHTML(auteur, contenu, discId){
  const author = (auteur || "").trim();
  const full   = (contenu || "").trim();

  // 1 phrase max pour l’aperçu, sinon coupe à ~120 caractères
  const firstDot = full.indexOf(".");
  const rawShort = (firstDot > 40 && firstDot < 140) ? full.slice(0, firstDot+1)
                 : full.slice(0, 120);
  const short = rawShort.replace(/\s+$/,"") + " (…)";  // ← le fameux “(…)”

  // structure : short par défaut, full au hover/open
  return `
    <div class="frag-label mode-discours" data-disc-id="${discId}">
      ${author ? `<span class="disc-author">${author} :</span>` : ""}
      <span class="disc-short">${short}</span>
      <span class="disc-full">${full}</span>
    </div>
  `;
}



// placement interne non-chevauchant pour les mots d'un fragment



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


function _getMarkerIconEl(marker) {
  // renvoie l'élément .frag-label s'il existe, sinon .frag-thumb
  const root = marker.getElement?.();
  if (!root) return null;
  return root.querySelector(".frag-label") || root.querySelector(".frag-thumb");
}



``



function clearSticky() {
  _stickyFragId = null;
  _stickyDiscId = null; // ⟵ add

  clearPatternLinks();
  if (!patternImageLayer) return;

  // fragments
  patternImageLayer.eachLayer((m) => {
    const el = _getMarkerIconEl(m);
    if (el) el.classList.remove("--active");
  });
  undimAll();

  // discours (dans la couche dédiée)
  if (patternDiscourseTextLayer) {
    patternDiscourseTextLayer.eachLayer((m) => {
      const root = m.getElement?.();
      const el = root?.querySelector(".frag-label.mode-discours");
      if (el) {
        el.classList.remove("is-open", "is-hover", "--active");
      }
    });
  }
}



function undimAll() {
  if (!patternImageLayer) return;
  patternImageLayer.eachLayer((m) => {
    const el = _getMarkerIconEl(m);
    if (el) el.classList.remove("dim");
  });
}


function dimUnrelated(srcFragId, allowedPatterns = null) {
  if (!patternImageLayer) return;
  const related = new Set([srcFragId]);

  let pList = allowedPatterns && allowedPatterns.length
    ? allowedPatterns.slice()
    : getPatternsForFragment(srcFragId) || [];

  pList.forEach((pName) => {
    (patterns[pName]?.elements || []).forEach((id) => related.add(id));
  });

  patternImageLayer.eachLayer((m) => {
    const id = m._fragId;
    const el = _getMarkerIconEl(m);
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



function textFromCriteriaMask(mask) {
  const names = Object.keys(maskToCriteriaDict(mask))
    .map(k => k.replace(/_/g, " "));
  return names.length ? names.join(" • ") : "";
}


// 1) "Chapeau" lisible pour chaque clé (sans créer de nouveaux critères)
const CRITERIA_LABELS = {
  frequence_usage_aucun: "usage nul",
  frequence_usage_ponctuel: "ponctuel",
  frequence_usage_regulier: "régulier",
  frequence_usage_quotidien: "quotidien",

  mode_usage_prevu: "usage prévu",
  mode_usage_detourne: "usage détourné",
  mode_usage_creatif: "usage créatif",

  intensite_usage_aucun: "intensité nulle",
  intensite_usage_faible: "faible intensité",
  intensite_usage_moyenne: "intensité moyenne",
  intensite_usage_forte: "intensité forte",
  intensite_usage_saturee: "saturé",

  echelle_micro: "micro",
  echelle_meso: "méso",
  echelle_macro: "macro",

  origine_forme_institutionnelle: "forme institutionnelle",
  origine_forme_singuliere: "forme singulière",
  origine_forme_collective: "forme collective",

  accessibilite_libre: "libre",
  accessibilite_semi_ouverte: "semi-ouverte",
  accessibilite_fermee: "fermée",

  visibilite_cachee: "cachée",
  visibilite_visible: "visible",
  visibilite_exposee: "exposée",

  acteurs_visibles_habitant: "habitants visibles",
  acteurs_visibles_institution: "institution visible",
  acteurs_visibles_collectif: "collectif visible",
  acteurs_visibles_invisible: "acteurs invisibles",

  rapport_affectif_symbolique: "symbolique",
};

// 2) Famille → couleur (pour le halo)
const CRIT_FAMILY = (k) => {
  if (k.startsWith("frequence_") || k.startsWith("mode_")) return "usage";
  if (k.startsWith("intensite_")) return "intensite";
  if (k.startsWith("echelle_")) return "echelle";
  if (k.startsWith("origine_")) return "origine";
  if (k.startsWith("accessibilite_")) return "accessibilite";
  if (k.startsWith("visibilite_")) return "visibilite";
  if (k.startsWith("acteurs_")) return "acteurs";
  if (k.startsWith("rapport_")) return "rapport";
  return "autre";
};
const FAMILY_COLOR = {
  usage: "#4DA3FF",
  intensite: "#FF7A59",
  echelle: "#B07CFF",
  origine: "#5BC489",
  accessibilite: "#FFC84D",
  visibilite: "#6DD3C2",
  acteurs: "#F45B69",
  rapport: "#E0E04D",
  autre: "#AAAAAA",
};

function activeCriteriaKeysForFeature(feature) {
  const dict = maskToCriteriaDict(getActiveMaskFor(feature)) || {};
  return Object.keys(dict); // ex: ["frequence_usage_regulier", "visibilite_visible", ...]
}

// Poids = combien de membres des patterns du fragment partagent ce critère (normalisé 0..1)
function scoreCriteriaForFragment(fragId) {
  const pList = getPatternsForFragment(fragId) || [];
  if (!pList.length) return {};

  // membres = union des fragments de ces patterns
  const members = new Set();
  pList.forEach(p => (patterns[p]?.elements || []).forEach(id => members.add(id)));

  // index id -> feature
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map(f => [f?.properties?.id, f]));

  // compter occurrences par critère
  const counts = {};
  let denom = 0;
  members.forEach(id => {
    const f = byId.get(id);
    if (!f || !isFeatureInActiveZones(f) || f.properties?.isDiscourse) return;
    denom++;
    activeCriteriaKeysForFeature(f).forEach(k => {
      counts[k] = (counts[k] || 0) + 1;
    });
  });
  if (!denom) return {};

  // normalise en 0..1
  const scores = {};
  Object.entries(counts).forEach(([k, c]) => (scores[k] = c / denom));
  return scores;
}



function buildTextLabelHTML(feature, mode) {
  const id   = feature?.properties?.id   || "";
  const name = feature?.properties?.name || id;

  const wrapStart = `<div class="frag-label-wrap"><div class="frag-label`;
  const wrapEnd   = `</div></div>`;

  if (mode === "noms") {
    if (!name) return "";
    return `${wrapStart} mode-noms">${name}${wrapEnd}`;
  }

  if (mode === "criteres") {
  const fid  = feature?.properties?.id || "";
  const keys = activeCriteriaKeysForFeature(feature);
  if (!keys.length) return "";

  // 1) pondération locale (patterns du fragment)
  const weights = scoreCriteriaForFragment(fid);

  // 2) scorés → triés desc
  const scored = keys
    .map(k => ({ k, w: (weights[k] || 0) }))
    .sort((a, b) => b.w - a.w);

  // 3) on fait un "nuage" court : top N (ajuste 3..6)
  const N = Math.min(5, scored.length);
  const top = scored.slice(0, N);

  // 4) placement polaire simple (nuage) + rotation légère
  //    plus le mot est "léger", plus il est éloigné
  const RMAX = 16; // px max d’écart intra-label (ajuste à l’œil)
  const tokens = top.map((t, i) => {
    const label = CRITERIA_LABELS[t.k] || t.k.replace(/_/g, " ");
    const w = Math.max(0.15, Math.min(1, t.w));                  // 0.15..1
    const ang = (i / Math.max(1, top.length)) * Math.PI * 2;     // dispersion
    const r   = (1 - w) * RMAX;                                  // faible → plus loin
    const dx  = Math.cos(ang) * r;
    const dy  = Math.sin(ang) * r;

    // petite rotation (-10°..+10°) selon la clé pour une variété stable
    let h = 0; for (const c of t.k) h = (h * 31 + c.charCodeAt(0)) | 0;
    const rot = ((h % 21) - 10); // -10..+10

    const fam = CRIT_FAMILY(t.k);
    const cls = `token token--${fam}`;

    return `<span class="${cls}" style="--w:${w}; --x:${dx.toFixed(1)}px; --y:${dy.toFixed(1)}px; --rot:${rot}deg;">${label}</span>`;
  });

  // wrap sans data-halo (on n’utilise plus les halos)
  return `${wrapStart} mode-criteres">${tokens.join("")}${wrapEnd}`;
}



  if (mode === "usages") {
    const meta  = loadFragmentMeta(id) || { usages: [] };
    const lines = (meta.usages || []).map(u => (u?.text || "").trim()).filter(Boolean);
    if (!lines.length) return "";
    return `${wrapStart} mode-usages">${lines.join("<br>")}${wrapEnd}`;
  }

  if (mode === "discours") {
    const meta = loadFragmentMeta(id) || { discours: [] };
    const userLines = (meta.discours || []).map(d => (d?.text || "").trim()).filter(Boolean);

    const nearLines = [];
    if (discoursLayer) {
      discoursLayer.eachLayer(grp => {
        const f = grp.feature; if (!f) return;
        const sameSpot =
          feature.geometry?.type === "Point" &&
          f.geometry?.type === "Point" &&
          f.geometry.coordinates[0] === feature.geometry.coordinates[0] &&
          f.geometry.coordinates[1] === feature.geometry.coordinates[1];
        if (sameSpot) {
          const auteur  = (f.properties?.auteur || "").trim();
          const contenu = (f.properties?.contenu || "").trim();
          const txt = (auteur ? (auteur + " : ") : "") + contenu;
          if (txt) nearLines.push(txt);
        }
      });
    }
    const all = [...nearLines, ...userLines];
    if (!all.length) return "";
    return `${wrapStart} mode-discours">${all.join("<br>")}${wrapEnd}`;
  }

  return "";
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

// 2) dessiner chaque fragment en ÉTIQUETTE TEXTE (DivIcon)
uniqEligible.forEach((fragId) => {
  const feat = byId.get(fragId);
  const center = getFeatureCenter(feat);
  if (!center) return;

 const html = buildTextLabelHTML(feat, patternDisplayMode);
if (!html) return; // rien à montrer pour ce fragment en ce mode → on skip

const icon = L.divIcon({
  className: "frag-label-ic",
  html,
  iconSize: null,      // laisser le HTML prendre sa taille réelle
  iconAnchor: [0, 0],  // ancre haut-gauche
});

const marker = L.marker(center, { icon, riseOnHover: true });
marker._fragId = fragId;

  // Survol : liens + dimming (inchangé)
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

  // Clic : sticky + ouverture panneau (inchangé)
  marker.on("click", (ev) => {
    const el = _getMarkerIconEl(marker);
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

  // --- superposition sélective SANS halo : calcule juste la distance au centre
const centerPx   = patternMap.latLngToLayerPoint(center);
const mapCenterPx= patternMap.latLngToLayerPoint(patternMap.getCenter());
const dist = Math.hypot(centerPx.x - mapCenterPx.x, centerPx.y - mapCenterPx.y);
const far = dist > 600; // seuil à ajuster

// un seul addTo
marker.addTo(patternImageLayer);

// puis on layout + éventuel .far
requestAnimationFrame(() => {
  const dom = marker.getElement?.();
  const label = dom?.querySelector('.frag-label.mode-criteres');
  if (label) {
    const z = patternMap.getZoom();
    const R = Math.max(16, 24 - (z - 12));
  }
  if (far) dom?.querySelector(".frag-label")?.classList.add("far");
});


if (marker.options._far) {
  const dom = marker.getElement?.();
  dom?.querySelector(".frag-label")?.classList.add("far");
}



});
refreshDiscourseTextLayer();
applyLabelSize();
requestAnimationFrame(layoutWordCloud);
updateFarOpacity();
}



let patternDiscourseTextLayer = null;

function refreshDiscourseTextLayer() {
  if (!patternMap) return;
  if (!patternDiscourseTextLayer) {
    patternDiscourseTextLayer = L.layerGroup().addTo(patternMap);
  }
  patternDiscourseTextLayer.clearLayers();

  if (patternDisplayMode !== "discours" || !discoursLayer) return;

  discoursLayer.eachLayer(grp => {
    const f = grp.feature;
    if (!f) return;
    const g = f.geometry;
    if (!g || g.type !== "Point") return;

    const [lng, lat] = g.coordinates;
    const auteur  = (f.properties?.auteur  || "").trim();
    const contenu = (f.properties?.contenu || "").trim();
    if (!auteur && !contenu) return; // rien à afficher

    // 1) le POINT associé en ROND VERT
    L.circleMarker([lat, lng], {
      radius: 3,
      color: "#f6ff00ff",
      weight: 1,
      fillColor: "#f6ff00ff",
      fillOpacity: 0.9
    }).addTo(patternDiscourseTextLayer);

    // 2) le LABEL texte : court + long
const discId = (f.properties?.id || `${lat},${lng}`);
const html = makeDiscourseHTML(auteur, contenu, discId);

const icon = L.divIcon({
  className: "frag-label-ic",
  html,
  iconSize: null,
  iconAnchor: [0, 0]
});

const m = L.marker([lat, lng], { icon, riseOnHover: false })
  .addTo(patternDiscourseTextLayer);

// -- listeners DOM (hover/click) une fois le marker dans le DOM
requestAnimationFrame(() => {
  const root = m.getElement?.();
  const el = root?.querySelector('.frag-label.mode-discours');
  if (!el) return;

  // HOOVER : ouvrir visuellement
  el.addEventListener('mouseenter', () => {
    if (_stickyDiscId && _stickyDiscId !== discId) return; // si autre sticky, ignore
    el.classList.add('is-hover');
  });
  el.addEventListener('mouseleave', () => {
    if (_stickyDiscId === discId) return; // si sticky, on ne referme pas
    el.classList.remove('is-hover');
  });

  // CLIC : toggle sticky
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (_stickyDiscId === discId) {
      // unstick
      _stickyDiscId = null;
      el.classList.remove('is-open', '--active');
      el.classList.add('is-hover'); // reste ouvert tant que la souris est dessus
    } else {
      // clear autres sticky + stick celui-ci
      if (patternDiscourseTextLayer) {
        patternDiscourseTextLayer.eachLayer((mm) => {
          const r = mm.getElement?.();
          const e2 = r?.querySelector(".frag-label.mode-discours");
          if (e2) e2.classList.remove('is-open', '--active');
        });
      }
      _stickyDiscId = discId;
      el.classList.add('is-open', '--active');
      el.classList.remove('is-hover');
    }
  });
});
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

// re-pack interne de chaque label "critères" après le layout global
if (patternImageLayer) {
  patternImageLayer.eachLayer(m => {
    const el = m.getElement?.();
    const label = el?.querySelector('.frag-label.mode-criteres');
  });
}



let __labelLayoutRunning = false;

// bornes “soft”
const BASE_MAX_SHIFT_PX = 16;  // déplacement max autour de l’ancre (augmenté quand peu de labels)
const SEPARATION_PAD    = 2;   // marge mini

// Force custom : borne chaque noeud dans un disque de rayon R autour de son ancre (centre)
function forceBoundWithinRadius(radiusAccessor) {
  let nodes;
  function force() {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const ax = n.anchorCx, ay = n.anchorCy;
      const dx = n.x - ax, dy = n.y - ay;
      const r = +radiusAccessor(n);
      const d2 = dx*dx + dy*dy;
      if (d2 > r*r) {
        const d = Math.sqrt(d2) || 1;
        n.x = ax + dx * (r / d);
        n.y = ay + dy * (r / d);
      }
    }
  }
  force.initialize = ns => { nodes = ns; };
  return force;
}


function layoutWordCloud() {
  if (!patternMap || !patternImageLayer) return;
  if (__labelLayoutRunning) return;
  __labelLayoutRunning = true;

  const nodes = [];
  patternImageLayer.eachLayer((m) => {
    const el = m.getElement?.(); if (!el) return;
    const wrap  = el.querySelector(".frag-label-wrap");
    const label = el.querySelector(".frag-label");
    if (!wrap || !label) return;

    const box = label.getBoundingClientRect();
    const w = Math.max(2, box.width);
    const h = Math.max(2, box.height);
    const p = patternMap.latLngToLayerPoint(m.getLatLng()); // top-left ancré

    const anchorLeft = p.x, anchorTop = p.y;
    const cx0 = anchorLeft + w/2, cy0 = anchorTop + h/2;

    // petite randomisation initiale pour casser les symétries
    const ang = Math.random() * Math.PI * 2;
    const j = 1.5;
    const jx = Math.cos(ang) * j, jy = Math.sin(ang) * j;

    nodes.push({
      wrap, w, h,
      anchorLeft, anchorTop,
      x: cx0 + jx, y: cy0 + jy,      // positions courantes (CENTRE)
      anchorCx: cx0, anchorCy: cy0   // ancre (CENTRE)
    });
  });

  if (!nodes.length) { __labelLayoutRunning = false; return; }

  const few = nodes.length < 40;
  const maxShift = few ? 28 : 16;             // rayon autorisé autour de l’ancre
  const pad = 2.5;                               // marge mini entre labels
  const collideR = d => 0.5 * Math.hypot(d.w, d.h) + pad;

  const sim = d3.forceSimulation(nodes)
    .alpha(1)
    .alphaDecay(few ? 0.14 : 0.18)
    .force("x", d3.forceX(d => d.anchorCx).strength(0.12)) // doux → laisse bouger
    .force("y", d3.forceY(d => d.anchorCy).strength(0.12))
    .force("collide", d3.forceCollide(collideR).strength(1).iterations(few ? 5 : 4))
    .force("bound", forceBoundWithinRadius(() => maxShift))
    .stop();

  const T = few ? 80 : 50;
  for (let i = 0; i < T; i++) sim.tick();

  // CENTRE → TOP-LEFT pour le DOM
  nodes.forEach(d => {
    const left = d.x - d.w/2;
    const top  = d.y - d.h/2;
    const dx = left - d.anchorLeft;
    const dy = top  - d.anchorTop;
    d.wrap.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  });

  __labelLayoutRunning = false;
}



function relayoutOnViewChange() {
  if (!patternMap || !patternImageLayer) return;

  const nodes = [];
  patternImageLayer.eachLayer((m) => {
    const el = m.getElement?.(); if (!el) return;
    const wrap  = el.querySelector(".frag-label-wrap");
    const label = el.querySelector(".frag-label");
    if (!wrap || !label) return;

    const box = label.getBoundingClientRect();
    const w = Math.max(2, box.width);
    const h = Math.max(2, box.height);
    const p = patternMap.latLngToLayerPoint(m.getLatLng());

    const anchorLeft = p.x, anchorTop = p.y;
    const cx0 = anchorLeft + w/2, cy0 = anchorTop + h/2;

    nodes.push({
      wrap, w, h,
      anchorLeft, anchorTop,
      x: cx0, y: cy0,
      anchorCx: cx0, anchorCy: cy0
    });
  });

  if (!nodes.length) return;

  const few = nodes.length < 40;
  const maxShift = few ? 28 : 16;
  const pad = 2;
  const collideR = d => 0.5 * Math.hypot(d.w, d.h) + pad;

  const sim = d3.forceSimulation(nodes)
    .alpha(0.9)
    .alphaDecay(few ? 0.18 : 0.22)
    .force("x", d3.forceX(d => d.anchorCx).strength(0.14))
    .force("y", d3.forceY(d => d.anchorCy).strength(0.14))
    .force("collide", d3.forceCollide(collideR).strength(1).iterations(few ? 4 : 3))
    .force("bound", forceBoundWithinRadius(() => maxShift))
    .stop();

  const T = few ? 50 : 30;
  for (let i = 0; i < T; i++) sim.tick();

  nodes.forEach(d => {
    const left = d.x - d.w/2;
    const top  = d.y - d.h/2;
    const dx = left - d.anchorLeft;
    const dy = top  - d.anchorTop;
    d.wrap.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
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
