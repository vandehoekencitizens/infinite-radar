
const APP_NAME = "Infinite Tracker";

const DEFAULT_API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";
const API_BASE = "https://api.infiniteflight.com/public/v2";

const POLL_MS = 5000;
const TRAIL_LENGTH = 100;
const PLANE_ICON = "https://infinite-tracker.tech/plane.png";

// Overlay candidates (fallback chain)
const OVERLAY_SOURCES = {
  labels: [
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  ],
  boundaries: [
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  ],
  subdomains: ["a", "b", "c", "d"]
};

const state = {
  apiKey: DEFAULT_API_KEY,
  sessionId: "",
  sessionName: "",
  mode: "ife",
  polling: null,
  viewer: null,
  aircraft: new Map(),
  selectedFlightId: null,
  followSelected: false,
  planeIconReady: false,

  labelsEnabled: true,
  boundariesEnabled: true,
  labelsLayer: null,
  boundariesLayer: null
};

const els = {
  serverSelect: document.getElementById("serverSelect"),
  connectBtn: document.getElementById("connectBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  ifeModeBtn: document.getElementById("ifeModeBtn"),
  radarModeBtn: document.getElementById("radarModeBtn"),
  status: document.getElementById("status"),
  topMode: document.getElementById("topMode"),
  topServer: document.getElementById("topServer"),
  togglePanelBtn: document.getElementById("togglePanelBtn"),
  controlShell: document.getElementById("controlShell"),
  followBtn: document.getElementById("followBtn"),
  title: document.querySelector(".brand h1"),

  drawer: document.getElementById("flightDrawer"),
  selectedStrip: document.getElementById("selectedStrip"),

  tabFlightInfo: document.getElementById("tabFlightInfo"),
  tabGlass: document.getElementById("tabGlass"),
  panelFlightInfo: document.getElementById("panelFlightInfo"),
  panelGlass: document.getElementById("panelGlass"),

  fiCallsign: document.getElementById("fiCallsign"),
  fiUser: document.getElementById("fiUser"),
  fiAlt: document.getElementById("fiAlt"),
  fiSpd: document.getElementById("fiSpd"),
  fiHdg: document.getElementById("fiHdg"),
  fiVs: document.getElementById("fiVs"),
  fiLat: document.getElementById("fiLat"),
  fiLon: document.getElementById("fiLon"),

  stripCallsign: document.getElementById("stripCallsign"),
  stripType: document.getElementById("stripType"),
  stripPilot: document.getElementById("stripPilot"),
  stripGs: document.getElementById("stripGs"),
  stripAlt: document.getElementById("stripAlt"),
  stripVs: document.getElementById("stripVs"),

  hudCallsign: document.getElementById("hudCallsign"),
  hudAlt: document.getElementById("hudAlt"),
  hudSpd: document.getElementById("hudSpd"),
  hudHdg: document.getElementById("hudHdg"),

  gcSpeedTape: document.getElementById("gcSpeedTape"),
  gcAltTape: document.getElementById("gcAltTape"),
  gcNeedle: document.getElementById("gcNeedle"),
  gcNDR: document.getElementById("gcNDR"),
  gcN1L: document.getElementById("gcN1L"),
  gcN1R: document.getElementById("gcN1R"),
  gcEgtL: document.getElementById("gcEgtL"),
  gcEgtR: document.getElementById("gcEgtR"),
  gcFpln: document.getElementById("gcFpln"),

  labelsToggleBtn: null,
  boundariesToggleBtn: null
};

function setStatus(msg, isError = false) {
  if (els.status) {
    els.status.textContent = msg;
    els.status.style.color = isError ? "#ff9f9f" : "var(--warn)";
  }
  console.log("[InfiniteTracker]", msg);
}

function headers() {
  return {
    Authorization: `Bearer ${state.apiKey}`,
    "Content-Type": "application/json"
  };
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errorCode !== 0) throw new Error(`API errorCode=${json.errorCode}`);
  return json.result;
}

// ---------------------------
// Robust startup helpers
// ---------------------------
function preloadPlaneIcon() {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;

    const done = (ok) => {
      if (settled) return;
      settled = true;
      state.planeIconReady = ok;
      resolve(ok);
    };

    img.onload = () => done(true);
    img.onerror = () => {
      console.error("Plane icon failed:", PLANE_ICON);
      done(false);
    };

    setTimeout(() => done(false), 2500); // timeout fallback
    img.src = `${PLANE_ICON}?v=${Date.now()}`;
  });
}

function ensureOverlayButtons() {
  const topActions = document.querySelector(".top-actions");
  if (!topActions) return;

  if (!document.getElementById("labelsToggleBtn")) {
    const btn = document.createElement("button");
    btn.id = "labelsToggleBtn";
    topActions.prepend(btn);
  }
  if (!document.getElementById("boundariesToggleBtn")) {
    const btn = document.createElement("button");
    btn.id = "boundariesToggleBtn";
    topActions.prepend(btn);
  }

  els.labelsToggleBtn = document.getElementById("labelsToggleBtn");
  els.boundariesToggleBtn = document.getElementById("boundariesToggleBtn");
  updateOverlayButtonLabels();
}

function updateOverlayButtonLabels() {
  if (els.labelsToggleBtn) {
    els.labelsToggleBtn.textContent = `Map Labels: ${state.labelsEnabled ? "ON" : "OFF"}`;
    els.labelsToggleBtn.classList.toggle("active", state.labelsEnabled);
  }
  if (els.boundariesToggleBtn) {
    els.boundariesToggleBtn.textContent = `Boundaries: ${state.boundariesEnabled ? "ON" : "OFF"}`;
    els.boundariesToggleBtn.classList.toggle("active", state.boundariesEnabled);
  }
}

function setLayerVisible(layer, visible) {
  if (!layer) return;
  layer.show = !!visible;
  layer.alpha = visible ? 1 : 0;
}

function makeImageryProvider(url) {
  return new Cesium.UrlTemplateImageryProvider({
    url,
    subdomains: OVERLAY_SOURCES.subdomains,
    credit: "Map data providers"
  });
}

function addOverlayWithFallback(type) {
  const urls = OVERLAY_SOURCES[type];
  if (!urls || !state.viewer) return null;

  for (const url of urls) {
    try {
      const provider = makeImageryProvider(url);
      const layer = state.viewer.imageryLayers.addImageryProvider(provider);
      return { layer, url };
    } catch (e) {
      console.warn(`Overlay ${type} source failed: ${url}`, e);
    }
  }
  return null;
}

function addOverlayLayers() {
  const labels = addOverlayWithFallback("labels");
  if (labels?.layer) {
    state.labelsLayer = labels.layer;
    state.labelsLayer.brightness = 1.05;
    state.labelsLayer.contrast = 1.1;
    setLayerVisible(state.labelsLayer, state.labelsEnabled);
    console.log("Labels source:", labels.url);
  }

  const boundaries = addOverlayWithFallback("boundaries");
  if (boundaries?.layer) {
    state.boundariesLayer = boundaries.layer;
    state.boundariesLayer.brightness = 1.0;
    state.boundariesLayer.contrast = 1.2;
    setLayerVisible(state.boundariesLayer, state.boundariesEnabled);
    console.log("Boundaries source:", boundaries.url);
  }
}

function toggleLabels() {
  state.labelsEnabled = !state.labelsEnabled;
  setLayerVisible(state.labelsLayer, state.labelsEnabled);
  updateOverlayButtonLabels();
}

function toggleBoundaries() {
  state.boundariesEnabled = !state.boundariesEnabled;
  setLayerVisible(state.boundariesLayer, state.boundariesEnabled);
  updateOverlayButtonLabels();
}

// ---------------------------
// Cesium init (globe first)
// ---------------------------
function initCesium() {
  if (!window.Cesium) throw new Error("Cesium not loaded");

  if (CESIUM_ION_TOKEN && CESIUM_ION_TOKEN !== "PASTE_YOUR_CESIUM_ION_TOKEN_HERE") {
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
  }

  try {
    state.viewer = new Cesium.Viewer("cesiumContainer", {
      animation: false,
      timeline: false,
      sceneModePicker: false,
      baseLayerPicker: true,
      geocoder: false,
      homeButton: true,
      navigationHelpButton: false,
      selectionIndicator: false,
      infoBox: false,
      terrain: Cesium.Terrain.fromWorldTerrain()
    });
  } catch (e) {
    console.warn("Terrain init failed, using fallback viewer:", e);
    state.viewer = new Cesium.Viewer("cesiumContainer", {
      animation: false,
      timeline: false,
      sceneModePicker: false,
      baseLayerPicker: true,
      geocoder: false,
      homeButton: true,
      navigationHelpButton: false,
      selectionIndicator: false,
      infoBox: false
    });
  }

  state.viewer.scene.globe.enableLighting = true;
  state.viewer.scene.globe.depthTestAgainstTerrain = false;

  addOverlayLayers();

  state.viewer.screenSpaceEventHandler.setInputAction((click) => {
    const picked = state.viewer.scene.pick(click.position);
    if (picked?.id?.id && state.aircraft.has(picked.id.id)) selectFlight(picked.id.id);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  window.__IT_VIEWER__ = state.viewer;
}

async function loadSessions() {
  setStatus("Loading sessions...");
  const sessions = await apiGet("/sessions");
  if (!els.serverSelect) return;

  els.serverSelect.innerHTML = `<option value="">Select server</option>`;
  sessions.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.dataset.serverName = s.name;
    opt.textContent = `${s.name} (${s.userCount}/${s.maxUsers})`;
    els.serverSelect.appendChild(opt);
  });
  setStatus(`Loaded ${sessions.length} sessions`);
}

function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle("mode-ife", mode === "ife");
  document.body.classList.toggle("mode-radar", mode === "radar");
  els.ifeModeBtn?.classList.toggle("active", mode === "ife");
  els.radarModeBtn?.classList.toggle("active", mode === "radar");
  if (els.topMode) els.topMode.textContent = mode === "ife" ? "IFE Mode" : "Radar Mode";
}

function createAircraftEntity(f, pos, sampled) {
  return state.viewer.entities.add({
    id: f.flightId,
    position: sampled,
    billboard: {
      image: PLANE_ICON,
      show: !!state.planeIconReady,
      width: 22,
      height: 22,
      color: Cesium.Color.WHITE,
      rotation: Cesium.Math.toRadians((f.heading || 0) - 90),
      alignedAxis: Cesium.Cartesian3.UNIT_Z,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    point: {
      show: !state.planeIconReady,
      pixelSize: 6,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    polyline: {
      positions: [pos],
      width: 2,
      material: Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.3)
    }
  });
}

function upsertAircraft(f) {
  const now = Cesium.JulianDate.now();
  const pos = Cesium.Cartesian3.fromDegrees(f.longitude, f.latitude, (f.altitude || 0) * 0.3048);
  let rec = state.aircraft.get(f.flightId);

  if (!rec) {
    const sampled = new Cesium.SampledPositionProperty();
    sampled.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation
    });
    sampled.addSample(now, pos);

    const entity = createAircraftEntity(f, pos, sampled);
    rec = { entity, sampled, trailPositions: [pos], last: f };
    state.aircraft.set(f.flightId, rec);
  } else {
    rec.sampled.addSample(now, pos);
    rec.trailPositions.push(pos);
    if (rec.trailPositions.length > TRAIL_LENGTH) rec.trailPositions.shift();
    rec.entity.polyline.positions = rec.trailPositions;
    rec.entity.billboard.rotation = Cesium.Math.toRadians((f.heading || 0) - 90);
    rec.last = f;
  }
}

function removeMissingAircraft(activeIds) {
  for (const [flightId, rec] of state.aircraft.entries()) {
    if (!activeIds.has(flightId)) {
      state.viewer.entities.remove(rec.entity);
      state.aircraft.delete(flightId);
      if (state.selectedFlightId === flightId) state.selectedFlightId = null;
    }
  }
}

function updateSelectedStyles() {
  for (const [id, rec] of state.aircraft.entries()) {
    const selected = id === state.selectedFlightId;
    rec.entity.billboard.scale = selected ? 1.25 : 1.0;
    rec.entity.billboard.color = selected ? Cesium.Color.fromCssColorString("#34f5c5") : Cesium.Color.WHITE;
    rec.entity.polyline.width = selected ? 3 : 2;
    rec.entity.polyline.material = selected
      ? Cesium.Color.fromCssColorString("#34f5c5").withAlpha(0.85)
      : Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.3);
  }
}

function selectFlight(flightId) {
  state.selectedFlightId = flightId;
  if (els.drawer) els.drawer.style.display = "block";
  if (els.selectedStrip) els.selectedStrip.style.display = "flex";
  updateSelectedStyles();
  updateInfoPanels();
}

function updateHud(f) {
  if (!f) {
    if (els.hudCallsign) els.hudCallsign.textContent = "-";
    if (els.hudAlt) els.hudAlt.textContent = "- ft";
    if (els.hudSpd) els.hudSpd.textContent = "- kts";
    if (els.hudHdg) els.hudHdg.textContent = "-°";
    return;
  }
  if (els.hudCallsign) els.hudCallsign.textContent = f.callsign || "-";
  if (els.hudAlt) els.hudAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  if (els.hudSpd) els.hudSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  if (els.hudHdg) els.hudHdg.textContent = `${Math.round(f.heading || 0)}°`;
}

function updateGlassCockpit(f) {
  if (!f || !els.gcNeedle) return;
  const gs = Math.round(f.speed || 0);
  const alt = Math.round(f.altitude || 0);
  const hdg = Math.round(f.heading || 0);
  const vs = Math.round(f.verticalSpeed || 0);

  if (els.gcSpeedTape) els.gcSpeedTape.textContent = `GS ${gs}`;
  if (els.gcAltTape) els.gcAltTape.textContent = `ALT ${alt}`;
  if (els.gcNDR) els.gcNDR.textContent = `HDG ${String(hdg).padStart(3, "0")}`;
  els.gcNeedle.style.transform = `translate(-50%, -100%) rotate(${hdg}deg)`;

  const n1 = Math.max(25, Math.min(105, gs / 5 + 20));
  if (els.gcN1L) els.gcN1L.textContent = n1.toFixed(1);
  if (els.gcN1R) els.gcN1R.textContent = n1.toFixed(1);

  const egtPct = Math.max(20, Math.min(95, Math.abs(vs) / 40 + 35));
  if (els.gcEgtL) els.gcEgtL.style.height = `${egtPct}%`;
  if (els.gcEgtR) els.gcEgtR.style.height = `${egtPct}%`;

  if (els.gcFpln) {
    els.gcFpln.innerHTML = `
      <div>POS ${Number(f.latitude || 0).toFixed(3)}, ${Number(f.longitude || 0).toFixed(3)}</div>
      <div>HDG ${hdg} • GS ${gs} • ALT ${alt}</div>
      <div>V/S ${vs} fpm</div>
      <div>LIVE TRACK STREAM</div>
    `;
  }
}

function updateInfoPanels() {
  const rec = state.selectedFlightId ? state.aircraft.get(state.selectedFlightId) : null;
  if (!rec) {
    if (els.drawer) els.drawer.style.display = "none";
    if (els.selectedStrip) els.selectedStrip.style.display = "none";
    updateHud(null);
    return;
  }

  const f = rec.last;

  if (els.fiCallsign) els.fiCallsign.textContent = f.callsign || "-";
  if (els.fiUser) els.fiUser.textContent = f.username || "-";
  if (els.fiAlt) els.fiAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  if (els.fiSpd) els.fiSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  if (els.fiHdg) els.fiHdg.textContent = `${Math.round(f.heading || 0)}°`;
  if (els.fiVs) els.fiVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;
  if (els.fiLat) els.fiLat.textContent = Number(f.latitude || 0).toFixed(4);
  if (els.fiLon) els.fiLon.textContent = Number(f.longitude || 0).toFixed(4);

  if (els.stripCallsign) els.stripCallsign.textContent = f.callsign || "Unknown";
  if (els.stripType) els.stripType.textContent = "Infinite Flight Aircraft";
  if (els.stripPilot) els.stripPilot.textContent = f.username || "Anonymous";
  if (els.stripGs) els.stripGs.textContent = `${Math.round(f.speed || 0)} kts`;
  if (els.stripAlt) els.stripAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  if (els.stripVs) els.stripVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;

  updateHud(f);
  updateGlassCockpit(f);
}

function updateFollowCamera() {
  if (!state.followSelected || !state.selectedFlightId) return;
  const rec = state.aircraft.get(state.selectedFlightId);
  if (rec) state.viewer.trackedEntity = rec.entity;
}

async function pollFlights() {
  if (!state.sessionId) return;

  try {
    const flights = await apiGet(`/sessions/${state.sessionId}/flights`);
    const active = new Set();

    flights.forEach((f) => {
      active.add(f.flightId);
      upsertAircraft(f);
    });

    removeMissingAircraft(active);

    if (state.selectedFlightId) {
      updateSelectedStyles();
      updateInfoPanels();
    } else {
      if (els.drawer) els.drawer.style.display = "none";
      if (els.selectedStrip) els.selectedStrip.style.display = "none";
      updateHud(null);
    }

    updateFollowCamera();
    setStatus(`Tracking ${flights.length} flights on ${state.sessionName || "server"}`);
  } catch (e) {
    setStatus(`Polling error: ${e.message}`, true);
  }
}

function startPolling() {
  if (state.polling) clearInterval(state.polling);
  pollFlights();
  state.polling = setInterval(pollFlights, POLL_MS);
}

function clearAircraft() {
  for (const rec of state.aircraft.values()) state.viewer.entities.remove(rec.entity);
  state.aircraft.clear();
  state.selectedFlightId = null;
  state.viewer.trackedEntity = undefined;

  if (els.drawer) els.drawer.style.display = "none";
  if (els.selectedStrip) els.selectedStrip.style.display = "none";
  updateHud(null);
}

function connect() {
  state.apiKey = (DEFAULT_API_KEY || "").trim();
  if (!state.apiKey) return setStatus("Missing API key in app.js", true);

  state.sessionId = els.serverSelect?.value || "";
  const selected = els.serverSelect?.options?.[els.serverSelect.selectedIndex];
  state.sessionName = selected?.dataset?.serverName || selected?.textContent || "";

  if (!state.sessionId) return setStatus("Please select a server", true);

  clearAircraft();
  if (els.topServer) els.topServer.textContent = state.sessionName || "Unknown server";
  setStatus("Connected. Showing live aircraft...");
  startPolling();
}

function setupTabs() {
  if (!els.tabFlightInfo || !els.tabGlass || !els.panelFlightInfo || !els.panelGlass) return;
  const activate = (flightTab) => {
    els.tabFlightInfo.classList.toggle("active", flightTab);
    els.tabGlass.classList.toggle("active", !flightTab);
    els.panelFlightInfo.style.display = flightTab ? "block" : "none";
    els.panelGlass.style.display = flightTab ? "none" : "block";
  };
  els.tabFlightInfo.addEventListener("click", () => activate(true));
  els.tabGlass.addEventListener("click", () => activate(false));
  activate(true);
}

function setupEvents() {
  els.connectBtn?.addEventListener("click", connect);
  els.refreshBtn?.addEventListener("click", () => {
    loadSessions().catch((e) => setStatus(`Refresh error: ${e.message}`, true));
  });

  els.ifeModeBtn?.addEventListener("click", () => setMode("ife"));
  els.radarModeBtn?.addEventListener("click", () => setMode("radar"));

  els.togglePanelBtn?.addEventListener("click", () => {
    const hidden = els.controlShell?.classList.toggle("hidden");
    if (els.togglePanelBtn) els.togglePanelBtn.textContent = hidden ? "Show Panel" : "Hide Panel";
  });

  els.followBtn?.addEventListener("click", () => {
    state.followSelected = !state.followSelected;
    els.followBtn.classList.toggle("active", state.followSelected);
    if (!state.followSelected) state.viewer.trackedEntity = undefined;
    else updateFollowCamera();
  });

  els.labelsToggleBtn?.addEventListener("click", toggleLabels);
  els.boundariesToggleBtn?.addEventListener("click", toggleBoundaries);
}

(async function bootstrap() {
  document.title = APP_NAME;
  if (els.title) els.title.textContent = APP_NAME;

  try {
    // 1) show globe first
    initCesium();
    setStatus("Globe ready. Loading data...");

    // 2) immediately usable controls
    ensureOverlayButtons();
    setupTabs();
    setupEvents();
    setMode("ife");
    if (els.selectedStrip) els.selectedStrip.style.display = "none";
    if (els.drawer) els.drawer.style.display = "none";

    // 3) async background tasks with fallbacks
    preloadPlaneIcon().then((ok) => {
      setStatus(ok ? "Plane icon ready" : "Plane icon fallback mode");
    });

    loadSessions()
      .then(() => setStatus("Ready. Select server and connect."))
      .catch((e) => setStatus(`Session load failed: ${e.message}`, true));
  } catch (e) {
    console.error(e);
    setStatus(`Startup error: ${e.message}`, true);
  }
})();
