/**
 * Infinite Tracker v1.6
 * Full replacement app.js
 *
 * Fixes included:
 * - Aircraft icon hard-fix: no billboard textures, uses guaranteed point + label marker
 * - Map visibility fix: keeps UI as floating cards (not full-screen takeover)
 * - ETA clarified as user's local time
 * - Time to Arrival shown as "X h Y min"
 * - Dep/Arr extraction with Arrival fallback = "NA"
 * - Flightplan + route endpoint wiring
 */

const APP_NAME = "Infinite Tracker";
const DEFAULT_API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";
const API_BASE = "https://api.infiniteflight.com/public/v2";

const POLL_MS = 5000;
const TRAIL_LENGTH = 140;

const state = {
  apiKey: DEFAULT_API_KEY,
  sessionId: "",
  sessionName: "",
  mode: "radar",

  viewer: null,
  polling: null,

  aircraftMap: new Map(), // flightId -> { entity, sampled, trail, last }
  selectedFlightId: null,
  followSelected: false,

  labelsEnabled: true,
  boundariesEnabled: true,
  didInitialZoom: false,

  ifeStarted: false,
  ifeView: "flightInfo",

  flightPlanCache: new Map(),
  flightRouteCache: new Map(),
  pendingDetailFetch: new Set()
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

  gcSpeedTape: byId("gcSpeedTape"),
  gcAltTape: byId("gcAltTape"),
  gcNeedle: byId("gcNeedle"),
  gcNDR: byId("gcNDR"),
  gcN1L: byId("gcN1L"),
  gcN1R: byId("gcN1R"),
  gcEgtL: byId("gcEgtL"),
  gcEgtR: byId("gcEgtR"),
  gcFpln: byId("gcFpln"),

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
/* Utils */
/* -------------------------------------------------------------------------- */

function setStatus(msg, isError = false) {
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.style.color = isError ? "#ff9f9f" : "var(--warn)";
}

function fmt(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeEtaDetails(distanceKm, gsKts) {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(gsKts) || gsKts < 30) {
    return { etaLocal: "--:--", durationText: "-- h -- min" };
  }

  const speedKmh = gsKts * 1.852;
  const hours = distanceKm / speedKmh;
  const totalMin = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  const etaDate = new Date(Date.now() + totalMin * 60000);
  const etaLocal = etaDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return {
    etaLocal, // user's local timezone
    durationText: `${h} h ${m} min`
  };
}

/* -------------------------------------------------------------------------- */
/* Flight plan parsing */
/* -------------------------------------------------------------------------- */

function collectWaypointsDeep(items, out = []) {
  if (!Array.isArray(items)) return out;

  for (const it of items) {
    if (it?.location) {
      const lat = Number(it.location.latitude);
      const lon = Number(it.location.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
        out.push({
          name: it.name || it.identifier || "WP",
          lat,
          lon
        });
      }
    }

    if (Array.isArray(it?.children) && it.children.length) {
      collectWaypointsDeep(it.children, out);
    }
  }

  return out;
}

function extractDepArrFromFlightPlan(fp) {
  const fallback = { dep: "DEP", arr: "NA", routeNames: [], points: [] };
  if (!fp || !Array.isArray(fp.flightPlanItems)) return fallback;

  const points = collectWaypointsDeep(fp.flightPlanItems, []);
  if (!points.length) return fallback;

  const dep = points[0]?.name || "DEP";
  const arr = points.length > 1 ? (points[points.length - 1]?.name || "NA") : "NA";

  return {
    dep,
    arr: arr || "NA",
    routeNames: points.map((p) => p.name),
    points
  };
}

function resolveAircraftType(f, fp) {
  return (
    fp?.aircraftType ||
    fp?.aircraftName ||
    f?.aircraftName ||
    f?.aircraftType ||
    f?.aircraftId ||
    "Unknown Type"
  );
}

/* -------------------------------------------------------------------------- */
/* Cesium init */
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
/* Sessions / mode */
/* -------------------------------------------------------------------------- */

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

  if (els.topMode) {
    els.topMode.textContent = mode === "ife" ? "IFE Mode" : "Radar Mode";
  }

  if (mode === "ife") {
    if (state.selectedFlightId) {
      if (!state.ifeStarted) showIFEWelcome();
      else showIFEPanel();
    }
  } else {
    hideIFE();
  }
}

function showIFEWelcome() {
  els.ifeOverlay?.classList.remove("hidden");
  els.ifeWelcome?.classList.remove("hidden");
  els.ifePanel?.classList.add("hidden");
}

function showIFEPanel() {
  els.ifeOverlay?.classList.remove("hidden");
  els.ifeWelcome?.classList.add("hidden");
  els.ifePanel?.classList.remove("hidden");
}

function hideIFE() {
  els.ifeOverlay?.classList.add("hidden");
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
/* Details fetch */
/* -------------------------------------------------------------------------- */

async function fetchSelectedFlightDetails(flightId) {
  if (!state.sessionId || !flightId) return;
  if (state.pendingDetailFetch.has(flightId)) return;
  state.pendingDetailFetch.add(flightId);

  try {
    try {
      const fp = await apiGet(`/sessions/${state.sessionId}/flights/${flightId}/flightplan`);
      state.flightPlanCache.set(flightId, fp);
    } catch {
      state.flightPlanCache.set(flightId, null);
    }

    try {
      const route = await apiGet(`/sessions/${state.sessionId}/flights/${flightId}/route`);
      state.flightRouteCache.set(flightId, Array.isArray(route) ? route : []);
    } catch {
      state.flightRouteCache.set(flightId, null);
    }

    if (state.selectedFlightId === flightId) {
      updatePanelsFromSelected();
    }
  } finally {
    state.pendingDetailFetch.delete(flightId);
  }
}

/* -------------------------------------------------------------------------- */
/* Aircraft entities */
/* -------------------------------------------------------------------------- */

function createAircraftEntity(f, pos, sampled) {
  return state.viewer.entities.add({
    id: f.flightId,
    position: sampled,

    // guaranteed-visible marker (no texture loading problems)
    point: {
      show: true,
      pixelSize: 10,
      color: Cesium.Color.fromCssColorString("#40e0ff"),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },

    // guaranteed-visible airplane glyph
    label: {
      text: "✈",
      font: "20px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -2),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      eyeOffset: new Cesium.Cartesian3(0, 0, -10)
    },

    polyline: {
      positions: [pos],
      width: 2,
      material: Cesium.Color.fromCssColorString("#7ec8ff").withAlpha(0.35)
    }
  });
}

function upsertAircraft(f) {
  const now = Cesium.JulianDate.now();
  const altM = Math.max(0, (Number(f.altitude) || 0) * 0.3048);
  const pos = Cesium.Cartesian3.fromDegrees(Number(f.longitude), Number(f.latitude), altM);

  let rec = state.aircraftMap.get(f.flightId);

  if (!rec) {
    const sampled = new Cesium.SampledPositionProperty();
    sampled.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation
    });
    sampled.addSample(now, pos);

    rec = {
      entity: createAircraftEntity(f, pos, sampled),
      sampled,
      trail: [pos],
      last: f
    };
    state.aircraftMap.set(f.flightId, rec);
  } else {
    rec.sampled.addSample(now, pos);
    rec.trail.push(pos);
    if (rec.trail.length > TRAIL_LENGTH) rec.trail.shift();

    rec.entity.polyline.positions = rec.trail;
    rec.last = f;
  }
}

function removeMissingAircraft(activeIds) {
  for (const [id, rec] of state.aircraftMap.entries()) {
    if (!activeIds.has(id)) {
      state.viewer.entities.remove(rec.entity);
      state.aircraftMap.delete(id);
      if (state.selectedFlightId === id) state.selectedFlightId = null;
    }
  }
}

function updateSelectedStyles() {
  for (const [id, rec] of state.aircraftMap.entries()) {
    const selected = id === state.selectedFlightId;
    rec.entity.point.pixelSize = selected ? 12 : 10;
    rec.entity.label.scale = selected ? 1.15 : 1.0;
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
  fetchSelectedFlightDetails(flightId);

  if (state.mode === "ife") {
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
/* UI binding */
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

function bindGlass(prefix, f, fp) {
  const speed = Math.round(f?.speed || 0);
  const alt = Math.round(f?.altitude || 0);
  const hdg = Math.round(f?.heading || 0);
  const vs = Math.round(f?.verticalSpeed || 0);
  const type = resolveAircraftType(f, fp);

  const q = (suffix) => byId(`${prefix}${suffix}`);

  const speedEl = q("Speed") || q("SpeedTape");
  const altEl = q("Alt") || q("AltTape");
  const ndrEl = q("Ndr") || q("NDR");
  const needleEl = q("Needle");
  const n1L = q("N1L");
  const n1R = q("N1R");
  const egtL = q("EgtL");
  const egtR = q("EgtR");
  const fpln = q("Fpln") || q("FPLN");

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
      <div>TYPE ${type}</div>
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

  const fp = state.flightPlanCache.get(f.flightId);
  const routeReports = state.flightRouteCache.get(f.flightId);
  const aType = resolveAircraftType(f, fp);

  els.fiCallsign.textContent = f.callsign || "-";
  els.fiUser.textContent = f.username || "-";
  els.fiSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  els.fiAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.fiHdg.textContent = `${Math.round(f.heading || 0)}°`;
  els.fiVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;
  els.fiLat.textContent = fmt(f.latitude, 4);
  els.fiLon.textContent = fmt(f.longitude, 4);

  els.stripCallsign.textContent = f.callsign || "-";
  els.stripType.textContent = aType;
  els.stripPilot.textContent = f.username || "-";
  els.stripGs.textContent = `${Math.round(f.speed || 0)} kts`;
  els.stripAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.stripVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;

  bindHud(f);
  bindGlass("gc", f, fp);
  bindGlass("ifeGc", f, fp);

  els.ifeTitle.textContent = f.callsign || "--";
  els.ifeSub.textContent = `${aType} • ${f.username || "-"}`;
  els.welcomeCallsign.textContent = f.callsign || "--";
  els.ifeSpd.textContent = `${Math.round(f.speed || 0)} kts`;
  els.ifeAlt.textContent = `${Math.round(f.altitude || 0)} ft`;
  els.ifeHdg.textContent = `${Math.round(f.heading || 0)}°`;
  els.ifeVs.textContent = `${Math.round(f.verticalSpeed || 0)} fpm`;

  const parsed = extractDepArrFromFlightPlan(fp);
  const dep = parsed.dep || "DEP";
  const arr = parsed.arr || "NA";

  if (els.ifeDep) els.ifeDep.textContent = dep;
  if (els.ifeArr) els.ifeArr.textContent = arr;
  if (els.fromCode) els.fromCode.textContent = dep;
  if (els.toCode) els.toCode.textContent = arr;

  if (parsed.points.length >= 1) {
    const dest = parsed.points[parsed.points.length - 1];
    const distKm = haversineKm(
      Number(f.latitude),
      Number(f.longitude),
      Number(dest.lat),
      Number(dest.lon)
    );

    const eta = computeEtaDetails(distKm, Number(f.speed || 0));
    const routeText = parsed.routeNames.length
      ? parsed.routeNames.join(" → ")
      : "No route names";

    const trackInfo = Array.isArray(routeReports) ? `Track samples: ${routeReports.length}` : "Track samples: n/a";

    if (els.ifeRoute) {
      els.ifeRoute.innerHTML = `
        <div>${routeText}</div>
        <div style="margin-top:10px;display:flex;gap:18px;flex-wrap:wrap;">
          <span>Distance to Destination: <b>${Math.round(distKm)} km</b></span>
          <span>ETA (your local time): <b>${eta.etaLocal}</b></span>
          <span>Time to Arrival: <b>${eta.durationText}</b></span>
          <span>Arrival: <b>${arr}</b></span>
          <span>${trackInfo}</span>
        </div>
      `;
    }
  } else {
    if (els.ifeRoute) {
      els.ifeRoute.innerHTML = `
        <div>No valid flight plan waypoints available</div>
        <div style="margin-top:8px;">ETA (your local time): <b>--:--</b></div>
        <div>Time to Arrival: <b>-- h -- min</b></div>
        <div>Arrival: <b>NA</b></div>
      `;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Polling */
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
      const seed = flights[Math.floor(Math.random() * flights.length)];
      state.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          Number(seed.longitude),
          Number(seed.latitude),
          2500000
        ),
        duration: 1.2
      });
      state.didInitialZoom = true;
    }

    if (state.selectedFlightId) updatePanelsFromSelected();
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

  state.flightPlanCache.clear();
  state.flightRouteCache.clear();
}

/* -------------------------------------------------------------------------- */
/* Connect / events */
/* -------------------------------------------------------------------------- */

function connect() {
  state.apiKey = (DEFAULT_API_KEY || "").trim();
  if (!state.apiKey || state.apiKey.startsWith("PASTE_")) {
    return setStatus("Set API key in app.js", true);
  }

  state.sessionId = els.serverSelect?.value || "";
  const sel = els.serverSelect?.options?.[els.serverSelect.selectedIndex];
  state.sessionName = sel?.dataset?.serverName || sel?.textContent || "";

  if (!state.sessionId) return setStatus("Please select a server", true);

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
    if (!state.followSelected) state.viewer.trackedEntity = undefined;
    else updateFollowCamera();
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

    initCesium();
    await applyGlobeStyle();

    setupRadarTabs();
    setupEvents();

    setIFEView("flightInfo");
    setMode("radar");

    // Keep map visible by constraining floating panels
    if (els.drawer) {
      els.drawer.style.width = "min(980px, calc(100vw - 32px))";
      els.drawer.style.maxHeight = "70vh";
      els.drawer.style.overflow = "auto";
    }

    if (els.ifePanel) {
      els.ifePanel.style.width = "min(980px, 90vw)";
      els.ifePanel.style.maxHeight = "78vh";
      els.ifePanel.style.overflow = "auto";
    }

    await loadSessions();
    setStatus("Ready. Select server and connect.");
  } catch (e) {
    console.error(e);
    setStatus(`Startup error: ${e.message}`, true);
  }
})();
