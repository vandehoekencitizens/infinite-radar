
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

const APP_NAME = "Infinite Tracker";
const DEFAULT_API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u"; // replace
const API_BASE = "https://api.infiniteflight.com/public/v2";
const POLL_MS = 5000;
const TRAIL_LENGTH = 60;

const state = {
  apiKey: DEFAULT_API_KEY,
  sessionId: "",
  sessionName: "",
  mode: "ife",
  polling: null,
  viewer: null,
  aircraft: new Map(),
  selectedFlightId: null
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
  hudCallsign: document.getElementById("hudCallsign"),
  hudAlt: document.getElementById("hudAlt"),
  hudSpd: document.getElementById("hudSpd"),
  hudHdg: document.getElementById("hudHdg"),
  title: document.querySelector(".brand h1")
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
    setStatus("Cesium initialized");
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
    setStatus("Cesium initialized (fallback)");
  }

  state.viewer.scene.globe.enableLighting = true;

  state.viewer.screenSpaceEventHandler.setInputAction((click) => {
    const picked = state.viewer.scene.pick(click.position);
    if (picked?.id?.id && state.aircraft.has(picked.id.id)) {
      state.selectedFlightId = picked.id.id;
      updateHud();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
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

  for (const rec of state.aircraft.values()) {
    rec.entity.point.pixelSize = mode === "radar" ? 8 : 5;
    rec.entity.point.color = mode === "radar" ? Cesium.Color.CYAN : Cesium.Color.WHITE;
    rec.entity.polyline.material =
      mode === "radar"
        ? Cesium.Color.CYAN.withAlpha(0.8)
        : Cesium.Color.SKYBLUE.withAlpha(0.55);
  }
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

    const entity = state.viewer.entities.add({
      id: f.flightId,
      position: sampled,
      point: {
        pixelSize: state.mode === "radar" ? 8 : 5,
        color: state.mode === "radar" ? Cesium.Color.CYAN : Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1
      },
      label: {
        text: f.callsign || "UNKN",
        font: "12px Inter, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        scale: 0.9
      },
      polyline: {
        positions: [pos],
        width: 2,
        material: state.mode === "radar"
          ? Cesium.Color.CYAN.withAlpha(0.8)
          : Cesium.Color.SKYBLUE.withAlpha(0.55)
      }
    });

    rec = { entity, sampled, trailPositions: [pos], last: f };
    state.aircraft.set(f.flightId, rec);
  } else {
    rec.sampled.addSample(now, pos);
    rec.trailPositions.push(pos);
    if (rec.trailPositions.length > TRAIL_LENGTH) rec.trailPositions.shift();
    rec.entity.polyline.positions = rec.trailPositions;
    rec.entity.label.text = f.callsign || "UNKN";
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

function updateHud() {
  const rec = state.selectedFlightId ? state.aircraft.get(state.selectedFlightId) : null;
  if (!rec) {
    els.hudCallsign.textContent = "-";
    els.hudAlt.textContent = "- ft";
    els.hudSpd.textContent = "- kts";
    els.hudHdg.textContent = "-°";
    return;
  }

  const f = rec.last;
  els.hudCallsign.textContent = f.callsign || "-";
  els.hudAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.hudSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  els.hudHdg.textContent = `${Math.round(f.heading || 0)}°`;
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
      state.selectedFlightId = flights[0].flightId;
    }

    updateHud();
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
  updateHud();
}

function connect() {
  if (!state.apiKey || state.apiKey === "tyy8znhl0u5kbbb2vuvdhfetmsil041u") {
    setStatus("Set your real API key in app.js first", true);
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
  els.topServer.textContent = state.sessionName || "Unknown server";
  setStatus("Connected. Starting live tracking...");
  startPolling();
}

els.connectBtn.addEventListener("click", connect);
els.refreshBtn.addEventListener("click", async () => {
  try {
    await loadSessions();
  } catch (e) {
    setStatus(`Refresh failed: ${e.message}`, true);
  }
});
els.ifeModeBtn.addEventListener("click", () => setMode("ife"));
els.radarModeBtn.addEventListener("click", () => setMode("radar"));
els.togglePanelBtn.addEventListener("click", () => {
  const hidden = els.controlShell.classList.toggle("hidden");
  els.togglePanelBtn.textContent = hidden ? "Show Panel" : "Hide Panel";
});

(async function bootstrap() {
  document.title = APP_NAME;
  if (els.title) els.title.textContent = APP_NAME;

  try {
    initCesium();
    setMode("ife");
    await loadSessions();
    setStatus("Ready. Select server and connect.");
  } catch (e) {
    console.error(e);
    setStatus(`Startup error: ${e.message}`, true);
  }
})();
