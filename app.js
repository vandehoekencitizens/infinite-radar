const APP_NAME = "Infinite Tracker";
const DEFAULT_API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";
const API_BASE = "https://api.infiniteflight.com/public/v2";
const POLL_MS = 5000;
const TRAIL_LENGTH = 140;
const HOSTED_PLANE_ICON_FALLBACK = "https://infinite-tracker.tech/plane.svg";

// Keep false for production look.
const DEBUG_FORCE_POINTS = false;

const state = {
  apiKey: DEFAULT_API_KEY,
  sessionId: "",
  sessionName: "",
  mode: "radar", // "radar" | "ife"
  viewer: null,
  polling: null,

  aircraftMap: new Map(), // flightId -> record
  selectedFlightId: null,
  followSelected: false,

  labelsEnabled: true,
  boundariesEnabled: true,
  didInitialZoom: false,

  // IFE flow
  ifeStarted: false,
  ifeView: "flightInfo", // "flightInfo" | "glass"

  // assets
  generatedPlaneIconDataUrl: null,
  generatedPlaneCanvas: null,

  // aircraft type cache (if future endpoints added)
  aircraftTypeCache: new Map()
};

const byId = (id) => document.getElementById(id);

const els = {
  controlShell: byId("controlShell"),
  serverSelect: byId("serverSelect"),
  connectBtn: byId("connectBtn"),
  refreshBtn: byId("refreshBtn"),
  openRandomBtn: byId("openRandomBtn"),
  status: byId("status"),

  ifeModeBtn: byId("ifeModeBtn"),
  radarModeBtn: byId("radarModeBtn"),

  topMode: byId("topMode"),
  topServer: byId("topServer"),
  followBtn: byId("followBtn"),
  togglePanelBtn: byId("togglePanelBtn"),
  boundariesToggleBtn: byId("boundariesToggleBtn"),
  labelsToggleBtn: byId("labelsToggleBtn"),

  drawer: byId("flightDrawer"),
  drawerCloseBtn: byId("drawerCloseBtn"),
  tabFlightInfo: byId("tabFlightInfo"),
  tabGlass: byId("tabGlass"),
  panelFlightInfo: byId("panelFlightInfo"),
  panelGlass: byId("panelGlass"),

  fiCallsign: byId("fiCallsign"),
  fiUser: byId("fiUser"),
  fiAlt: byId("fiAlt"),
  fiSpd: byId("fiSpd"),
  fiHdg: byId("fiHdg"),
  fiVs: byId("fiVs"),
  fiLat: byId("fiLat"),
  fiLon: byId("fiLon"),

  selectedStrip: byId("selectedStrip"),
  stripCallsign: byId("stripCallsign"),
  stripType: byId("stripType"),
  stripPilot: byId("stripPilot"),
  stripGs: byId("stripGs"),
  stripAlt: byId("stripAlt"),
  stripVs: byId("stripVs"),

  hudCallsign: byId("hudCallsign"),
  hudAlt: byId("hudAlt"),
  hudSpd: byId("hudSpd"),
  hudHdg: byId("hudHdg"),

  // Radar glass instruments
  gcSpeedTape: byId("gcSpeedTape"),
  gcAltTape: byId("gcAltTape"),
  gcNeedle: byId("gcNeedle"),
  gcNDR: byId("gcNDR"),
  gcN1L: byId("gcN1L"),
  gcN1R: byId("gcN1R"),
  gcEgtL: byId("gcEgtL"),
  gcEgtR: byId("gcEgtR"),
  gcFpln: byId("gcFpln"),

  // IFE overlay + views
  ifeOverlay: byId("ifeOverlay"),
  ifeWelcome: byId("ifeWelcome"),
  ifePanel: byId("ifePanel"),
  ifeStartBtn: byId("ifeStartBtn"),
  ifeCloseBtn: byId("ifeCloseBtn"),
  changeViewBtn: byId("changeViewBtn"),

  welcomeCallsign: byId("welcomeCallsign"),
  fromCode: byId("fromCode"),
  toCode: byId("toCode"),

  ifeTitle: byId("ifeTitle"),
  ifeSub: byId("ifeSub"),

  ifeTabFlightInfo: byId("ifeTabFlightInfo"),
  ifeTabGlass: byId("ifeTabGlass"),
  ifeFlightInfoView: byId("ifeFlightInfoView"),
  ifeGlassView: byId("ifeGlassView"),

  ifeSpd: byId("ifeSpd"),
  ifeAlt: byId("ifeAlt"),
  ifeHdg: byId("ifeHdg"),
  ifeVs: byId("ifeVs"),
  ifeDep: byId("ifeDep"),
  ifeArr: byId("ifeArr"),
  ifeRoute: byId("ifeRoute"),

  // IFE glass instruments
  ifeGcSpeed: byId("ifeGcSpeed"),
  ifeGcAlt: byId("ifeGcAlt"),
  ifeGcNeedle: byId("ifeGcNeedle"),
  ifeGcNdr: byId("ifeGcNdr"),
  ifeGcN1L: byId("ifeGcN1L"),
  ifeGcN1R: byId("ifeGcN1R"),
  ifeGcEgtL: byId("ifeGcEgtL"),
  ifeGcEgtR: byId("ifeGcEgtR"),
  ifeGcFpln: byId("ifeGcFpln")
};

/* -------------------------------------------------------------------------- */
/* Utilities */
/* -------------------------------------------------------------------------- */

function setStatus(msg, isError = false) {
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.style.color = isError ? "#ff9f9f" : "var(--warn)";
  console.log("[InfiniteTracker v1.2]", msg);
}

function fmt(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits);
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

/* -------------------------------------------------------------------------- */
/* Guaranteed icon pipeline */
/* -------------------------------------------------------------------------- */

function makePlaneIconDataUrl(color = "#ffffff") {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <g fill="${color}" stroke="#0b0f18" stroke-width="2.4" stroke-linejoin="round">
    <path d="M38 5h4l5 24 20 10v5l-22-3-2 12 8 7v4l-11-3-11 3v-4l8-7-2-12-22 3v-5l20-10z"/>
  </g>
</svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function makePlaneCanvasIcon() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const g = canvas.getContext("2d");
  g.clearRect(0, 0, 128, 128);

  g.translate(64, 64);
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#0b0f18";
  g.lineWidth = 4;

  g.beginPath();
  g.moveTo(0, -56);
  g.lineTo(8, -10);
  g.lineTo(46, 9);
  g.lineTo(46, 17);
  g.lineTo(8, 11);
  g.lineTo(5, 33);
  g.lineTo(17, 45);
  g.lineTo(17, 53);
  g.lineTo(0, 46);
  g.lineTo(-17, 53);
  g.lineTo(-17, 45);
  g.lineTo(-5, 33);
  g.lineTo(-8, 11);
  g.lineTo(-46, 17);
  g.lineTo(-46, 9);
  g.lineTo(-8, -10);
  g.closePath();

  g.fill();
  g.stroke();

  return canvas;
}

function getGuaranteedPlaneIcon() {
  // strongest compatibility path: in-memory canvas
  if (state.generatedPlaneCanvas) return state.generatedPlaneCanvas;

  // then generated data-url svg
  if (state.generatedPlaneIconDataUrl) return state.generatedPlaneIconDataUrl;

  // finally hosted icon
  return HOSTED_PLANE_ICON_FALLBACK;
}

/* -------------------------------------------------------------------------- */
/* Map / Cesium */
/* -------------------------------------------------------------------------- */

function initCesium() {
  if (!window.Cesium) throw new Error("Cesium not loaded");

  if (CESIUM_ION_TOKEN && !CESIUM_ION_TOKEN.startsWith("PASTE_")) {
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
  }

  state.viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    timeline: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: true,
    navigationHelpButton: false,
    selectionIndicator: false,
    infoBox: false,
    terrain: Cesium.Terrain.fromWorldTerrain()
  });

  state.viewer.scene.globe.depthTestAgainstTerrain = false;
  state.viewer.resolutionScale = 1.0;

  state.viewer.screenSpaceEventHandler.setInputAction((click) => {
    const picked = state.viewer.scene.pick(click.position);
    if (picked?.id?.id && state.aircraftMap.has(picked.id.id)) {
      selectFlight(picked.id.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

async function applyGlobeStyle() {
  const style = state.labelsEnabled
    ? Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS
    : Cesium.IonWorldImageryStyle.AERIAL;

  const layer = await Cesium.ImageryLayer.fromProviderAsync(
    Cesium.createWorldImageryAsync({ style })
  );

  state.viewer.imageryLayers.removeAll();
  state.viewer.imageryLayers.add(layer);

  state.viewer.scene.globe.showGroundAtmosphere = !!state.boundariesEnabled;
  state.viewer.scene.globe.enableLighting = true;
  state.viewer.scene.skyAtmosphere.show = true;
  state.viewer.scene.fog.enabled = true;
}

/* -------------------------------------------------------------------------- */
/* Sessions */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Mode & IFE state machine */
/* -------------------------------------------------------------------------- */

function setMode(mode) {
  state.mode = mode;

  document.body.classList.toggle("mode-ife", mode === "ife");
  document.body.classList.toggle("mode-radar", mode === "radar");

  els.ifeModeBtn?.classList.toggle("active", mode === "ife");
  els.radarModeBtn?.classList.toggle("active", mode === "radar");

  if (els.topMode) {
    els.topMode.textContent = mode === "ife" ? "IFE Mode" : "Radar Mode";
  }

  if (mode === "ife") {
    // If already selected flight:
    // - first time => welcome/start
    // - after start => direct panel
    if (state.selectedFlightId) {
      if (!state.ifeStarted) showIFEWelcome();
      else showIFEPanel();
    }
  } else {
    hideIFE();
  }
}

function showIFEWelcome() {
  if (!els.ifeOverlay || !els.ifeWelcome || !els.ifePanel) return;

  els.ifeOverlay.classList.remove("hidden");
  els.ifeWelcome.classList.remove("hidden");
  els.ifePanel.classList.add("hidden");
}

function showIFEPanel() {
  if (!els.ifeOverlay || !els.ifeWelcome || !els.ifePanel) return;

  els.ifeOverlay.classList.remove("hidden");
  els.ifeWelcome.classList.add("hidden");
  els.ifePanel.classList.remove("hidden");

  // sizing guard so panel never full-screen
  els.ifePanel.style.width = "min(1100px, 94vw)";
  els.ifePanel.style.maxHeight = "88vh";
  els.ifePanel.style.overflow = "auto";
}

function hideIFE() {
  if (!els.ifeOverlay) return;
  els.ifeOverlay.classList.add("hidden");
}

function setIFEView(view) {
  state.ifeView = view;
  const flightInfo = view === "flightInfo";

  els.ifeTabFlightInfo?.classList.toggle("active", flightInfo);
  els.ifeTabGlass?.classList.toggle("active", !flightInfo);

  els.ifeFlightInfoView?.classList.toggle("hidden", !flightInfo);
  els.ifeGlassView?.classList.toggle("hidden", flightInfo);
}

/* -------------------------------------------------------------------------- */
/* Aircraft type pipeline */
/* -------------------------------------------------------------------------- */

function resolveAircraftType(flight) {
  // Attempt known fields first
  const candidates = [
    flight?.aircraftName,
    flight?.aircraftType,
    flight?.aircraftId,
    state.aircraftTypeCache.get(flight?.flightId)
  ].filter(Boolean);

  if (candidates.length) return String(candidates[0]);

  return "Unknown Type";
}

/* -------------------------------------------------------------------------- */
/* Entity creation / update */
/* -------------------------------------------------------------------------- */

function createAircraftEntity(flight, cartesianPos, sampledPos) {
  return state.viewer.entities.add({
    id: flight.flightId,
    position: sampledPos,

    billboard: {
      image: getGuaranteedPlaneIcon(),
      show: true,
      width: 30,
      height: 30,
      scale: 1.0,
      color: Cesium.Color.WHITE,
      rotation: Cesium.Math.toRadians((flight.heading || 0) - 90),
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      heightReference: Cesium.HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      eyeOffset: new Cesium.Cartesian3(0, 0, -20)
    },

    // debug visibility fallback
    point: {
      show: DEBUG_FORCE_POINTS,
      pixelSize: 8,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },

    polyline: {
      positions: [cartesianPos],
      width: 2,
      material: Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.35)
    }
  });
}

function upsertAircraft(flight) {
  const now = Cesium.JulianDate.now();
  const altitudeMeters = Math.max(0, (Number(flight.altitude) || 0) * 0.3048);

  const pos = Cesium.Cartesian3.fromDegrees(
    Number(flight.longitude),
    Number(flight.latitude),
    altitudeMeters
  );

  let rec = state.aircraftMap.get(flight.flightId);

  if (!rec) {
    const sampled = new Cesium.SampledPositionProperty();
    sampled.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation
    });
    sampled.addSample(now, pos);

    const entity = createAircraftEntity(flight, pos, sampled);

    rec = {
      entity,
      sampled,
      trail: [pos],
      last: flight
    };

    state.aircraftMap.set(flight.flightId, rec);
  } else {
    rec.sampled.addSample(now, pos);
    rec.trail.push(pos);
    if (rec.trail.length > TRAIL_LENGTH) rec.trail.shift();

    rec.entity.polyline.positions = rec.trail;
    rec.entity.billboard.rotation = Cesium.Math.toRadians((flight.heading || 0) - 90);
    rec.last = flight;
  }
}

function removeMissingAircraft(activeIds) {
  for (const [id, rec] of state.aircraftMap.entries()) {
    if (!activeIds.has(id)) {
      state.viewer.entities.remove(rec.entity);
      state.aircraftMap.delete(id);

      if (state.selectedFlightId === id) {
        state.selectedFlightId = null;
      }
    }
  }
}

function updateSelectedStyles() {
  for (const [id, rec] of state.aircraftMap.entries()) {
    const selected = id === state.selectedFlightId;

    rec.entity.billboard.scale = selected ? 1.35 : 1.0;
    rec.entity.polyline.width = selected ? 3 : 2;
    rec.entity.polyline.material = selected
      ? Cesium.Color.fromCssColorString("#34f5c5").withAlpha(0.9)
      : Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.35);
  }
}

function selectFlight(flightId) {
  state.selectedFlightId = flightId;

  updateSelectedStyles();
  updatePanelsFromSelected();

  if (state.mode === "ife") {
    // corrected state machine
    if (!state.ifeStarted) showIFEWelcome();
    else showIFEPanel();
  } else {
    if (els.drawer) els.drawer.style.display = "block";
    if (els.selectedStrip) els.selectedStrip.style.display = "flex";
  }
}

function openRandomAircraft() {
  const arr = Array.from(state.aircraftMap.values());
  if (!arr.length) return setStatus("No aircraft loaded yet", true);

  const pick = arr[Math.floor(Math.random() * arr.length)];
  const f = pick.last;
  if (!f) return;

  state.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      Number(f.longitude),
      Number(f.latitude),
      Math.max(120000, (Number(f.altitude) || 0) * 0.3048 + 100000)
    ),
    duration: 1.3
  });

  selectFlight(f.flightId);
}

/* -------------------------------------------------------------------------- */
/* Instrument binding */
/* -------------------------------------------------------------------------- */

function bindHud(f) {
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

/**
 * Improved PFD-style binding:
 * - speed / altitude tapes
 * - heading rose needle
 * - pseudo N1 + EGT logic
 * - FPLN text
 */
function bindGlass(prefix, f) {
  const speed = Math.round(f?.speed || 0);
  const alt = Math.round(f?.altitude || 0);
  const hdg = Math.round(f?.heading || 0);
  const vs = Math.round(f?.verticalSpeed || 0);

  const speedEl = byId(`${prefix}Speed`) || byId(`${prefix}SpeedTape`);
  const altEl = byId(`${prefix}Alt`) || byId(`${prefix}AltTape`);
  const ndrEl = byId(`${prefix}Ndr`) || byId(`${prefix}NDR`);
  const needleEl = byId(`${prefix}Needle`);
  const n1L = byId(`${prefix}N1L`);
  const n1R = byId(`${prefix}N1R`);
  const egtL = byId(`${prefix}EgtL`);
  const egtR = byId(`${prefix}EgtR`);
  const fpln = byId(`${prefix}Fpln`) || byId(`${prefix}FPLN`);

  if (speedEl) speedEl.textContent = `GS ${speed}`;
  if (altEl) altEl.textContent = `ALT ${alt}`;
  if (ndrEl) ndrEl.textContent = `HDG ${String(hdg).padStart(3, "0")}`;
  if (needleEl) needleEl.style.transform = `translate(-50%, -100%) rotate(${hdg}deg)`;

  const n1 = Math.max(20, Math.min(106, speed / 5 + 20));
  if (n1L) n1L.textContent = n1.toFixed(1);
  if (n1R) n1R.textContent = n1.toFixed(1);

  const egt = Math.max(18, Math.min(95, Math.abs(vs) / 40 + 35));
  if (egtL) egtL.style.height = `${egt}%`;
  if (egtR) egtR.style.height = `${egt}%`;

  if (fpln) {
    fpln.innerHTML = `
      <div>CALLSIGN ${f?.callsign || "-"}</div>
      <div>TYPE ${resolveAircraftType(f)}</div>
      <div>HDG ${hdg} • GS ${speed} • ALT ${alt}</div>
      <div>V/S ${vs} fpm</div>
      <div>LAT ${fmt(f?.latitude, 3)} • LON ${fmt(f?.longitude, 3)}</div>
    `;
  }
}

function updatePanelsFromSelected() {
  const rec = state.selectedFlightId ? state.aircraftMap.get(state.selectedFlightId) : null;
  const f = rec?.last;

  if (!f) {
    bindHud(null);
    return;
  }

  // Radar drawer
  els.fiCallsign.textContent = f.callsign || "-";
  els.fiUser.textContent = f.username || "-";
  els.fiSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  els.fiAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.fiHdg.textContent = `${Math.round(f.heading || 0)}°`;
  els.fiVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;
  els.fiLat.textContent = fmt(f.latitude, 4);
  els.fiLon.textContent = fmt(f.longitude, 4);

  // Bottom strip
  els.stripCallsign.textContent = f.callsign || "-";
  els.stripType.textContent = resolveAircraftType(f);
  els.stripPilot.textContent = f.username || "-";
  els.stripGs.textContent = `${Math.round(f.speed || 0)} kts`;
  els.stripAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.stripVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;

  // HUD + Radar Glass
  bindHud(f);
  bindGlass("gc", f);

  // IFE text
  els.ifeTitle.textContent = f.callsign || "--";
  els.ifeSub.textContent = `${resolveAircraftType(f)} • ${f.username || "-"}`;
  els.welcomeCallsign.textContent = f.callsign || "--";

  els.ifeSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  els.ifeAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.ifeHdg.textContent = `${Math.round(f.heading || 0)}°`;
  els.ifeVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;

  if (els.ifeDep && els.ifeDep.textContent === "----") els.ifeDep.textContent = "DEP";
  if (els.ifeArr && els.ifeArr.textContent === "----") els.ifeArr.textContent = "ARR";
  if (els.ifeRoute && /unavailable/i.test(els.ifeRoute.textContent)) {
    els.ifeRoute.textContent = "Live route placeholder (wire additional endpoint when available).";
  }

  bindGlass("ifeGc", f);
}

/* -------------------------------------------------------------------------- */
/* Poll loop */
/* -------------------------------------------------------------------------- */

function updateFollowCamera() {
  if (!state.followSelected || !state.selectedFlightId) return;
  const rec = state.aircraftMap.get(state.selectedFlightId);
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

    if (!state.didInitialZoom && flights.length > 0) {
      const r = flights[Math.floor(Math.random() * flights.length)];
      state.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          Number(r.longitude),
          Number(r.latitude),
          2500000
        ),
        duration: 1.2
      });
      state.didInitialZoom = true;
    }

    if (state.selectedFlightId) {
      updatePanelsFromSelected();
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
  for (const rec of state.aircraftMap.values()) {
    state.viewer.entities.remove(rec.entity);
  }
  state.aircraftMap.clear();
  state.selectedFlightId = null;
  state.viewer.trackedEntity = undefined;
  state.didInitialZoom = false;
}

/* -------------------------------------------------------------------------- */
/* Connect / tabs / events */
/* -------------------------------------------------------------------------- */

function connect() {
  state.apiKey = (DEFAULT_API_KEY || "").trim();
  if (!state.apiKey || state.apiKey.startsWith("PASTE_")) {
    return setStatus("Set API key in app.js", true);
  }

  state.sessionId = els.serverSelect?.value || "";
  const sel = els.serverSelect?.options?.[els.serverSelect.selectedIndex];
  state.sessionName = sel?.dataset?.serverName || sel?.textContent || "";

  if (!state.sessionId) {
    return setStatus("Please select a server", true);
  }

  clearAircraft();
  if (els.topServer) els.topServer.textContent = state.sessionName || "Unknown server";
  startPolling();
}

function setupRadarTabs() {
  if (!els.tabFlightInfo || !els.tabGlass) return;

  const activate = (flightInfo) => {
    els.tabFlightInfo.classList.toggle("active", flightInfo);
    els.tabGlass.classList.toggle("active", !flightInfo);
    if (els.panelFlightInfo) els.panelFlightInfo.style.display = flightInfo ? "block" : "none";
    if (els.panelGlass) els.panelGlass.style.display = flightInfo ? "none" : "block";
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

  els.openRandomBtn?.addEventListener("click", openRandomAircraft);

  els.ifeModeBtn?.addEventListener("click", () => setMode("ife"));
  els.radarModeBtn?.addEventListener("click", () => setMode("radar"));

  els.togglePanelBtn?.addEventListener("click", () => {
    const hidden = els.controlShell?.classList.toggle("hidden");
    if (els.togglePanelBtn) els.togglePanelBtn.textContent = hidden ? "Show Panel" : "Hide Panel";
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

  els.labelsToggleBtn?.addEventListener("click", async () => {
    state.labelsEnabled = !state.labelsEnabled;
    els.labelsToggleBtn.textContent = `Map Labels: ${state.labelsEnabled ? "ON" : "OFF"}`;
    await applyGlobeStyle();
  });

  els.boundariesToggleBtn?.addEventListener("click", async () => {
    state.boundariesEnabled = !state.boundariesEnabled;
    els.boundariesToggleBtn.textContent = `Boundaries: ${state.boundariesEnabled ? "ON" : "OFF"}`;
    await applyGlobeStyle();
  });

  // IFE flow
  els.ifeStartBtn?.addEventListener("click", () => {
    state.ifeStarted = true;
    showIFEPanel();
  });

  els.ifeCloseBtn?.addEventListener("click", hideIFE);

  els.changeViewBtn?.addEventListener("click", () => {
    setIFEView(state.ifeView === "flightInfo" ? "glass" : "flightInfo");
  });

  els.ifeTabFlightInfo?.addEventListener("click", () => setIFEView("flightInfo"));
  els.ifeTabGlass?.addEventListener("click", () => setIFEView("glass"));

  els.drawerCloseBtn?.addEventListener("click", () => {
    if (els.drawer) els.drawer.style.display = "none";
    if (els.selectedStrip) els.selectedStrip.style.display = "none";
    state.selectedFlightId = null;
    updateSelectedStyles();
  });
}

/* -------------------------------------------------------------------------- */
/* Bootstrap */
/* -------------------------------------------------------------------------- */

(async function bootstrap() {
  try {
    document.title = APP_NAME;

    // Build icon assets early
    state.generatedPlaneIconDataUrl = makePlaneIconDataUrl("#ffffff");
    state.generatedPlaneCanvas = makePlaneCanvasIcon();

    initCesium();
    await applyGlobeStyle();

    setupRadarTabs();
    setupEvents();

    setIFEView("flightInfo");
    setMode("radar");

    // flight info panel sizing safety (prevents full-screen overflow)
    if (els.drawer) {
      els.drawer.style.width = "min(980px, calc(100vw - 32px))";
      els.drawer.style.maxHeight = "86vh";
      els.drawer.style.overflow = "auto";
    }

    await loadSessions();
    setStatus("Ready. Select server and connect.");
  } catch (e) {
    console.error(e);
    setStatus(`Startup error: ${e.message}`, true);
  }
})();
