
const APP_NAME = "Infinite Tracker";

const DEFAULT_API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";
const API_BASE = "https://api.infiniteflight.com/public/v2";
const POLL_MS = 5000;
const TRAIL_LENGTH = 80;
const PLANE_ICON = "https://infinite-tracker.tech/plane.png";

const state = {
  apiKey: DEFAULT_API_KEY,
  sessionId: "",
  sessionName: "",
  mode: "ife",
  polling: null,
  viewer: null,
  aircraft: new Map(),
  selectedFlightId: null,
  followSelected: false
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
  gcFpln: document.getElementById("gcFpln")
};

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.style.color = isError ? "#ff9f9f" : "var(--warn)";
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
  if (CESIUM_ION_TOKEN && CESIUM_ION_TOKEN !== "PASTE_YOUR_CESIUM_ION_TOKEN_HERE") {
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
  }

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

  state.viewer.scene.globe.enableLighting = true;
  state.viewer.scene.globe.depthTestAgainstTerrain = false;

  state.viewer.screenSpaceEventHandler.setInputAction((click) => {
    const picked = state.viewer.scene.pick(click.position);
    if (picked?.id?.id && state.aircraft.has(picked.id.id)) {
      selectFlight(picked.id.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  const pre = new Image();
  pre.src = PLANE_ICON;
  pre.onerror = () => console.error("Failed to load plane icon:", PLANE_ICON);
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
  els.ifeModeBtn.classList.toggle("active", mode === "ife");
  els.radarModeBtn.classList.toggle("active", mode === "radar");
  els.topMode.textContent = mode === "ife" ? "IFE Mode" : "Radar Mode";
}

function createAircraftEntity(f, pos, sampled) {
  return state.viewer.entities.add({
    id: f.flightId,
    position: sampled,
    billboard: {
      image: PLANE_ICON,
      width: 24,
      height: 24,
      color: Cesium.Color.WHITE,
      rotation: Cesium.Math.toRadians((f.heading || 0) - 90),
      alignedAxis: Cesium.Cartesian3.UNIT_Z,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    point: { pixelSize: 6, color: Cesium.Color.WHITE, show: false },
    polyline: {
      positions: [pos],
      width: 2,
      material: Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.35)
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

function selectFlight(flightId) {
  state.selectedFlightId = flightId;
  els.drawer.style.display = "block";
  els.selectedStrip.style.display = "flex";
  updateSelectedStyles();
  updateInfoPanels();
}

function updateSelectedStyles() {
  for (const [flightId, rec] of state.aircraft.entries()) {
    const selected = flightId === state.selectedFlightId;
    rec.entity.billboard.scale = selected ? 1.25 : 1.0;
    rec.entity.billboard.color = selected
      ? Cesium.Color.fromCssColorString("#34f5c5")
      : Cesium.Color.WHITE;
    rec.entity.polyline.width = selected ? 3 : 2;
    rec.entity.polyline.material = selected
      ? Cesium.Color.fromCssColorString("#34f5c5").withAlpha(0.9)
      : Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.35);
  }
}

function updateHud(f) {
  if (!f) {
    els.hudCallsign.textContent = "-";
    els.hudAlt.textContent = "- ft";
    els.hudSpd.textContent = "- kts";
    els.hudHdg.textContent = "-°";
    return;
  }
  els.hudCallsign.textContent = f.callsign || "-";
  els.hudAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.hudSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  els.hudHdg.textContent = `${Math.round(f.heading || 0)}°`;
}

function updateGlassCockpit(f) {
  if (!f) return;

  const gs = Math.round(f.speed || 0);
  const alt = Math.round(f.altitude || 0);
  const hdg = Math.round(f.heading || 0);
  const vs = Math.round(f.verticalSpeed || 0);

  els.gcSpeedTape.textContent = `GS ${gs}`;
  els.gcAltTape.textContent = `ALT ${alt}`;
  els.gcNDR.textContent = `HDG ${hdg.toString().padStart(3, "0")}`;
  els.gcNeedle.style.transform = `translate(-50%, -100%) rotate(${hdg}deg)`;

  const n1 = Math.max(25, Math.min(105, gs / 5 + 20));
  els.gcN1L.textContent = n1.toFixed(1);
  els.gcN1R.textContent = n1.toFixed(1);

  const egtPct = Math.max(20, Math.min(95, (Math.abs(vs) / 40) + 35));
  els.gcEgtL.style.height = `${egtPct}%`;
  els.gcEgtR.style.height = `${egtPct}%`;

  els.gcFpln.innerHTML = `
    <div>POS ${Number(f.latitude || 0).toFixed(3)}, ${Number(f.longitude || 0).toFixed(3)}</div>
    <div>HDG ${hdg} • GS ${gs} • ALT ${alt}</div>
    <div>V/S ${vs} fpm</div>
    <div>LIVE TRACK STREAM</div>
  `;
}

function updateInfoPanels() {
  const rec = state.selectedFlightId ? state.aircraft.get(state.selectedFlightId) : null;
  if (!rec) {
    els.selectedStrip.style.display = "none";
    els.drawer.style.display = "none";
    updateHud(null);
    return;
  }

  const f = rec.last;

  els.fiCallsign.textContent = f.callsign || "-";
  els.fiUser.textContent = f.username || "-";
  els.fiAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.fiSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  els.fiHdg.textContent = `${Math.round(f.heading || 0)}°`;
  els.fiVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;
  els.fiLat.textContent = Number(f.latitude || 0).toFixed(4);
  els.fiLon.textContent = Number(f.longitude || 0).toFixed(4);

  els.stripCallsign.textContent = f.callsign || "Unknown";
  els.stripType.textContent = "Infinite Flight Aircraft";
  els.stripPilot.textContent = f.username || "Anonymous";
  els.stripGs.textContent = `${Math.round(f.speed || 0)} kts`;
  els.stripAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.stripVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;

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
      els.selectedStrip.style.display = "none";
      els.drawer.style.display = "none";
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
  for (const rec of state.aircraft.values()) {
    state.viewer.entities.remove(rec.entity);
  }
  state.aircraft.clear();
  state.selectedFlightId = null;
  state.viewer.trackedEntity = undefined;
  els.selectedStrip.style.display = "none";
  els.drawer.style.display = "none";
  updateHud(null);
}

function connect() {
  state.apiKey = (DEFAULT_API_KEY || "").trim();
  if (!state.apiKey) return setStatus("Missing API key in app.js", true);

  state.sessionId = els.serverSelect.value;
  const selected = els.serverSelect.options[els.serverSelect.selectedIndex];
  state.sessionName = selected?.dataset?.serverName || selected?.textContent || "";
  if (!state.sessionId) return setStatus("Please select a server", true);

  clearAircraft();
  els.topServer.textContent = state.sessionName || "Unknown server";
  setStatus("Connected. Showing live aircraft...");
  startPolling();
}

function setupTabs() {
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
  els.connectBtn.addEventListener("click", connect);
  els.refreshBtn.addEventListener("click", loadSessions);
  els.ifeModeBtn.addEventListener("click", () => setMode("ife"));
  els.radarModeBtn.addEventListener("click", () => setMode("radar"));

  els.togglePanelBtn.addEventListener("click", () => {
    const hidden = els.controlShell.classList.toggle("hidden");
    els.togglePanelBtn.textContent = hidden ? "Show Panel" : "Hide Panel";
  });

  els.followBtn.addEventListener("click", () => {
    state.followSelected = !state.followSelected;
    els.followBtn.classList.toggle("active", state.followSelected);
    if (!state.followSelected) state.viewer.trackedEntity = undefined;
    else updateFollowCamera();
  });
}

(async function bootstrap() {
  document.title = APP_NAME;
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
