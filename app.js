

const APP_NAME = "Infinite Tracker";

// ===== KEYS =====
const DEFAULT_API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew"; // optional but recommended

const API_BASE = "https://api.infiniteflight.com/public/v2";
const POLL_MS = 5000;
const TRAIL_LENGTH = 80;
const PLANE_ICON = "./plane.png"; // provided by you

const state = {
  apiKey: DEFAULT_API_KEY,
  sessionId: "",
  sessionName: "",
  mode: "ife", // ife | radar
  polling: null,
  viewer: null,
  aircraft: new Map(), // flightId -> { entity, sampled, trailPositions, last }
  selectedFlightId: null,
  followSelected: false
};

const els = {
  // existing
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
  hudCallsign: document.getElementById("hudCallsign"),
  hudAlt: document.getElementById("hudAlt"),
  hudSpd: document.getElementById("hudSpd"),
  hudHdg: document.getElementById("hudHdg"),
  title: document.querySelector(".brand h1"),

  // NEW optional UI ids (add to index.html if not there yet)
  selectedStrip: document.getElementById("selectedStrip"),
  stripCallsign: document.getElementById("stripCallsign"),
  stripType: document.getElementById("stripType"),
  stripGs: document.getElementById("stripGs"),
  stripAlt: document.getElementById("stripAlt"),
  stripVs: document.getElementById("stripVs"),
  stripPilot: document.getElementById("stripPilot"),

  drawer: document.getElementById("flightDrawer"),
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

  followBtn: document.getElementById("followBtn")
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

function initCesium() {
  if (!window.Cesium) throw new Error("Cesium not loaded");

  if (
    CESIUM_ION_TOKEN &&
    CESIUM_ION_TOKEN !== "PASTE_YOUR_CESIUM_ION_TOKEN_HERE"
  ) {
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
    console.warn("Terrain failed, fallback:", e);
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

  // click select
  state.viewer.screenSpaceEventHandler.setInputAction((click) => {
    const picked = state.viewer.scene.pick(click.position);
    if (picked?.id?.id && state.aircraft.has(picked.id.id)) {
      selectFlight(picked.id.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  setStatus("Cesium ready");
}

async function loadSessions() {
  setStatus("Loading sessions...");
  const sessions = await apiGet("/sessions");

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

  for (const [flightId, rec] of state.aircraft.entries()) {
    const isSelected = flightId === state.selectedFlightId;
    const color = isSelected
      ? Cesium.Color.fromCssColorString("#34f5c5")
      : (mode === "radar"
          ? Cesium.Color.fromCssColorString("#56b9ff")
          : Cesium.Color.WHITE);

    rec.entity.billboard.color = color;
    rec.entity.polyline.material = isSelected
      ? Cesium.Color.fromCssColorString("#34f5c5").withAlpha(0.9)
      : (mode === "radar"
          ? Cesium.Color.fromCssColorString("#56b9ff").withAlpha(0.55)
          : Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.45));
  }
}

function createAircraftEntity(f, pos, sampled) {
  return state.viewer.entities.add({
    id: f.flightId,
    position: sampled,
    billboard: {
      image: PLANE_ICON,
      width: 24,
      height: 24,
      color: state.mode === "radar"
        ? Cesium.Color.fromCssColorString("#56b9ff")
        : Cesium.Color.WHITE,
      rotation: Cesium.Math.toRadians((f.heading || 0) - 90),
      alignedAxis: Cesium.Cartesian3.UNIT_Z,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 1.0e7, 0.55)
    },
    label: {
      text: f.callsign || "UNKN",
      font: "12px Inter, sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      scale: 0.85,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#061226").withAlpha(0.65)
    },
    polyline: {
      positions: [pos],
      width: 2,
      material: Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.45)
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
    rec.entity.label.text = f.callsign || "UNKN";
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

function selectFlight(flightId) {
  state.selectedFlightId = flightId;
  updateSelectedStyles();
  updateInfoPanels();

  const rec = state.aircraft.get(flightId);
  if (rec) {
    state.viewer.flyTo(rec.entity, { duration: 1.1, offset: new Cesium.HeadingPitchRange(0, -0.35, 2200000) });
  }
}

function updateSelectedStyles() {
  for (const [flightId, rec] of state.aircraft.entries()) {
    const selected = flightId === state.selectedFlightId;
    rec.entity.billboard.scale = selected ? 1.25 : 1.0;
    rec.entity.polyline.width = selected ? 3 : 2;
  }
  setMode(state.mode); // re-apply colors based on mode + selected
}

function updateHud() {
  const rec = state.selectedFlightId ? state.aircraft.get(state.selectedFlightId) : null;
  if (!rec) {
    els.hudCallsign && (els.hudCallsign.textContent = "-");
    els.hudAlt && (els.hudAlt.textContent = "- ft");
    els.hudSpd && (els.hudSpd.textContent = "- kts");
    els.hudHdg && (els.hudHdg.textContent = "-°");
    return;
  }
  const f = rec.last;
  els.hudCallsign && (els.hudCallsign.textContent = f.callsign || "-");
  els.hudAlt && (els.hudAlt.textContent = `${Math.round(f.altitude || 0)} ft`);
  els.hudSpd && (els.hudSpd.textContent = `${Math.round(f.speed || 0)} kts`);
  els.hudHdg && (els.hudHdg.textContent = `${Math.round(f.heading || 0)}°`);
}

function updateInfoPanels() {
  const rec = state.selectedFlightId ? state.aircraft.get(state.selectedFlightId) : null;
  if (!rec) {
    if (els.selectedStrip) els.selectedStrip.style.display = "none";
    return;
  }

  const f = rec.last;
  if (els.selectedStrip) els.selectedStrip.style.display = "flex";

  // bottom strip
  els.stripCallsign && (els.stripCallsign.textContent = f.callsign || "Unknown");
  els.stripType && (els.stripType.textContent = "Infinite Flight Aircraft");
  els.stripGs && (els.stripGs.textContent = `${Math.round(f.speed || 0)} kts`);
  els.stripAlt && (els.stripAlt.textContent = `${Math.round(f.altitude || 0)} ft`);
  els.stripVs && (els.stripVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`);
  els.stripPilot && (els.stripPilot.textContent = f.username || "Anonymous");

  // right drawer - flight info
  els.fiCallsign && (els.fiCallsign.textContent = f.callsign || "-");
  els.fiUser && (els.fiUser.textContent = f.username || "-");
  els.fiAlt && (els.fiAlt.textContent = `${Math.round(f.altitude || 0)} ft`);
  els.fiSpd && (els.fiSpd.textContent = `${Math.round(f.speed || 0)} kts`);
  els.fiHdg && (els.fiHdg.textContent = `${Math.round(f.heading || 0)}°`);
  els.fiVs && (els.fiVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`);
  els.fiLat && (els.fiLat.textContent = Number(f.latitude || 0).toFixed(4));
  els.fiLon && (els.fiLon.textContent = Number(f.longitude || 0).toFixed(4));

  updateHud();
}

function updateFollowCamera() {
  if (!state.followSelected || !state.selectedFlightId) return;
  const rec = state.aircraft.get(state.selectedFlightId);
  if (!rec) return;

  state.viewer.trackedEntity = rec.entity;
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

    if (!state.selectedFlightId && flights.length > 0) {
      selectFlight(flights[0].flightId);
    } else {
      updateInfoPanels();
      updateSelectedStyles();
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
  for (const rec of state.aircraft.values()) {
    state.viewer.entities.remove(rec.entity);
  }
  state.aircraft.clear();
  state.selectedFlightId = null;
  state.viewer.trackedEntity = undefined;
  updateHud();
  updateInfoPanels();
}

function connect() {
  state.apiKey = (DEFAULT_API_KEY || "").trim();
  if (!state.apiKey) {
    setStatus("Missing Infinite Flight API key in app.js", true);
    return;
  }

  state.sessionId = els.serverSelect.value;
  const selected = els.serverSelect.options[els.serverSelect.selectedIndex];
  state.sessionName = selected?.dataset?.serverName || selected?.textContent || "";

  if (!state.sessionId) {
    setStatus("Please select a server", true);
    return;
  }

  clearAircraft();
  if (els.topServer) els.topServer.textContent = state.sessionName || "Unknown server";

  setStatus("Connected. Starting live tracking...");
  startPolling();
}

function setupTabs() {
  if (!els.tabFlightInfo || !els.tabGlass || !els.panelFlightInfo || !els.panelGlass) return;

  const activate = (tab) => {
    const isFlight = tab === "flight";
    els.tabFlightInfo.classList.toggle("active", isFlight);
    els.tabGlass.classList.toggle("active", !isFlight);
    els.panelFlightInfo.style.display = isFlight ? "block" : "none";
    els.panelGlass.style.display = isFlight ? "none" : "block";
  };

  els.tabFlightInfo.addEventListener("click", () => activate("flight"));
  els.tabGlass.addEventListener("click", () => activate("glass"));
  activate("flight");
}

function setupEvents() {
  els.connectBtn?.addEventListener("click", connect);

  els.refreshBtn?.addEventListener("click", async () => {
    try {
      await loadSessions();
    } catch (e) {
      setStatus(`Refresh failed: ${e.message}`, true);
    }
  });

  els.ifeModeBtn?.addEventListener("click", () => setMode("ife"));
  els.radarModeBtn?.addEventListener("click", () => setMode("radar"));

  els.togglePanelBtn?.addEventListener("click", () => {
    const hidden = els.controlShell.classList.toggle("hidden");
    els.togglePanelBtn.textContent = hidden ? "Show Panel" : "Hide Panel";
  });

  els.followBtn?.addEventListener("click", () => {
    state.followSelected = !state.followSelected;
    els.followBtn.classList.toggle("active", state.followSelected);
    if (!state.followSelected) {
      state.viewer.trackedEntity = undefined;
    } else {
      updateFollowCamera();
    }
  });
}

(async function bootstrap() {
  document.title = APP_NAME;
  if (els.title) els.title.textContent = APP_NAME;

  try {
    initCesium();
    setupEvents();
    setupTabs();
    setMode("ife");
    await loadSessions();
    setStatus("Ready. Select server and connect.");
  } catch (e) {
    console.error(e);
    setStatus(`Startup error: ${e.message}`, true);
  }
})();
