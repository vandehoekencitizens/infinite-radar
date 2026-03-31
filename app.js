
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

const APP_NAME = "Infinite Tracker";
const DEFAULT_API_KEY = tyy8znhl0u5kbbb2vuvdhfetmsil041u"; // ← replace for local testing
const API_BASE = "https://api.infiniteflight.com/public/v2";
const POLL_MS = 5000; // flight poll interval (ms)

const state = {
  apiKey: DEFAULT_API_KEY,
  sessionId: "",
  mode: "ife",          // "ife" | "radar"
  polling: null,
  viewer: null,
  aircraft: new Map(),  // flightId -> { entity, sampled, trailPositions, last, target }
  selectedFlightId: null
};

const els = {
  apiKeyInput: document.getElementById("apiKeyInput"),
  serverSelect: document.getElementById("serverSelect"),
  connectBtn: document.getElementById("connectBtn"),
  modeBtn: document.getElementById("modeBtn"),
  status: document.getElementById("status"),
  hudCallsign: document.getElementById("hudCallsign"),
  hudAlt: document.getElementById("hudAlt"),
  hudSpd: document.getElementById("hudSpd"),
  hudHdg: document.getElementById("hudHdg"),
  title: document.querySelector("h1")
};

function setStatus(msg) {
  els.status.textContent = msg;
  console.log("[EX3]", msg);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${state.apiKey}`,
    "Content-Type": "application/json"
  };
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errorCode !== 0) throw new Error(`API errorCode=${json.errorCode}`);
  return json.result;
}

function initCesium() {
  // Optional: set Cesium Ion token if using ion assets/terrain
  // Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

  state.viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    timeline: false,
    sceneModePicker: false,
    baseLayerPicker: true,
    terrain: Cesium.Terrain.fromWorldTerrain()
  });

  state.viewer.scene.globe.enableLighting = true;
}

async function loadSessions() {
  setStatus("Loading sessions...");
  const sessions = await apiGet("/sessions");

  els.serverSelect.innerHTML = `<option value="">Select server</option>`;
  for (const s of sessions) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.userCount}/${s.maxUsers})`;
    els.serverSelect.appendChild(opt);
  }

  setStatus(`Loaded ${sessions.length} sessions`);
}

function upsertAircraft(f) {
  const viewer = state.viewer;
  const now = Cesium.JulianDate.now();
  const targetPos = Cesium.Cartesian3.fromDegrees(
    f.longitude,
    f.latitude,
    (f.altitude || 0) * 0.3048
  );

  let rec = state.aircraft.get(f.flightId);
  if (!rec) {
    const sampled = new Cesium.SampledPositionProperty();
    sampled.addSample(now, targetPos);

    const entity = viewer.entities.add({
      id: f.flightId,
      position: sampled,
      point: {
        pixelSize: state.mode === "radar" ? 8 : 5,
        color: state.mode === "radar" ? Cesium.Color.CYAN : Cesium.Color.WHITE
      },
      label: {
        text: f.callsign || "UNKN",
        font: "12px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        scale: 0.9
      },
      polyline: {
        positions: [],
        width: 2,
        material: Cesium.Color.SKYBLUE.withAlpha(0.6)
      }
    });

    rec = {
      entity,
      sampled,
      trailPositions: [targetPos],
      last: f,
      target: f
    };
    state.aircraft.set(f.flightId, rec);
  } else {
    rec.target = f;
    rec.sampled.addSample(now, targetPos);
    rec.trailPositions.push(targetPos);
    if (rec.trailPositions.length > 50) rec.trailPositions.shift();
    rec.entity.polyline.positions = rec.trailPositions;
    rec.last = f;
  }
}

function removeMissingAircraft(activeIds) {
  for (const [flightId, rec] of state.aircraft.entries()) {
    if (!activeIds.has(flightId)) {
      state.viewer.entities.remove(rec.entity);
      state.aircraft.delete(flightId);
    }
  }
}

function updateHud() {
  const rec = state.selectedFlightId ? state.aircraft.get(state.selectedFlightId) : null;
  if (!rec) return;
  const f = rec.last;
  els.hudCallsign.textContent = f.callsign || "-";
  els.hudAlt.textContent = Math.round(f.altitude ?? 0);
  els.hudSpd.textContent = Math.round(f.speed ?? 0);
  els.hudHdg.textContent = Math.round(f.heading ?? 0);
}

async function pollFlights() {
  if (!state.sessionId) return;
  try {
    const flights = await apiGet(`/sessions/${state.sessionId}/flights`);
    const ids = new Set();

    for (const f of flights) {
      ids.add(f.flightId);
      upsertAircraft(f);
    }

    removeMissingAircraft(ids);

    if (!state.selectedFlightId && flights.length) {
      state.selectedFlightId = flights[0].flightId;
    }

    updateHud();
    setStatus(`Tracking ${flights.length} flights`);
  } catch (err) {
    setStatus(`Polling error: ${err.message}`);
  }
}

function setMode(nextMode) {
  state.mode = nextMode;
  document.body.classList.toggle("mode-ife", nextMode === "ife");
  document.body.classList.toggle("mode-radar", nextMode === "radar");
  els.modeBtn.textContent = nextMode === "ife" ? "Switch to Radar" : "Switch to IFE";
}

function startPolling() {
  if (state.polling) clearInterval(state.polling);
  pollFlights();
  state.polling = setInterval(pollFlights, POLL_MS);
}

// UI events
els.connectBtn.addEventListener("click", async () => {
  try {
    state.apiKey = els.apiKeyInput.value.trim();
    state.sessionId = els.serverSelect.value;
    if (!state.apiKey) throw new Error("Missing API key");
    if (!state.sessionId) throw new Error("Select a server");

    setStatus("Connecting...");
    startPolling();
  } catch (err) {
    setStatus(err.message);
  }
});

els.modeBtn.addEventListener("click", () => {
  setMode(state.mode === "ife" ? "radar" : "ife");
});

// Bootstrap
(async function bootstrap() {
  document.title = APP_NAME;
  if (els.title) els.title.textContent = APP_NAME;
  els.apiKeyInput.value = DEFAULT_API_KEY || "";
  initCesium();
  setMode("ife");
  setStatus("Ready");
  try {
    await loadSessions();
  } catch (err) {
    setStatus(`Failed to load sessions: ${err.message}`);
  }
})();
