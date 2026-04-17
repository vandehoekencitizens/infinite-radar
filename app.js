/**
 * Infinite Tracker - Ultimate Edition (Search + UI Revamp)
 * Fully expanded and verbose code for readability.
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
  aircraftMap: new Map(),
  selectedFlightId: null,
  followSelected: false,
  labelsEnabled: true,
  boundariesEnabled: true,
  didInitialZoom: false,
  ifeStarted: false,
  ifeView: "flightInfo",
  flightPlanCache: new Map(),
  flightRouteCache: new Map(),
  pendingDetailFetch: new Set(),
  physicsMap: new Map()
};

function byId(id) {
  return document.getElementById(id);
}

const els = {
  controlShell: byId("controlShell"),
  serverSelect: byId("serverSelect"),
  connectBtn: byId("connectBtn"),
  refreshBtn: byId("refreshBtn"),
  openRandomBtn: byId("openRandomBtn"),
  status: byId("status"),
  searchInput: byId("searchInput"),
  searchBtn: byId("searchBtn"),
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
  ifeRoute: byId("ifeRoute")
};

/* --- MATH & PARSING --- */

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * (Math.PI / 180)) *
            Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeEtaDetails(distKm, gsKts) {
  if (!Number.isFinite(distKm) || !Number.isFinite(gsKts) || gsKts < 30) {
    return { 
      etaLocal: "--:--", 
      durationText: "-- h -- min" 
    };
  }
  
  const hrs = distKm / (gsKts * 1.852);
  const totalMin = Math.max(0, Math.round(hrs * 60));
  const dateObj = new Date(Date.now() + totalMin * 60000);
  
  return { 
    etaLocal: dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), 
    durationText: `${Math.floor(totalMin / 60)} h ${totalMin % 60} min` 
  };
}

function calculateOAT(altFt) { 
  return Math.round(15 - (altFt / 1000) * 1.98); 
}

function updateAircraftPhysics(id, hdg, spd, vs, alt) {
  const now = Date.now(); 
  
  let phys = state.physicsMap.get(id);
  if (!phys) {
    phys = { lastHdg: hdg, lastTs: now, roll: 0, pitch: 0 };
  }
  
  const dt = (now - phys.lastTs) / 1000;
  
  if (dt > 0 && dt < 10) {
    let diff = hdg - phys.lastHdg; 
    
    if (diff > 180) {
      diff -= 360;
    }
    
    if (diff < -180) {
      diff += 360;
    }
    
    const maxRoll = Math.max(-45, Math.min(45, (diff / dt) * (Math.max(spd, 100) / 15)));
    phys.roll += (maxRoll - phys.roll) * 0.5;
  }
  
  let ptch = 0;
  if (spd > 30) { 
    const rad = Math.asin(vs / (spd * 101.268)); 
    if (!isNaN(rad)) { 
      ptch = rad * (180 / Math.PI); 
      if (alt > 10000 && vs > -500 && vs < 500) {
        ptch += 2.5; 
      }
    } 
  }
  
  phys.pitch += (ptch - phys.pitch) * 0.5; 
  phys.lastHdg = hdg; 
  phys.lastTs = now;
  
  state.physicsMap.set(id, phys); 
  return phys;
}

function extractDepArr(fp) {
  const fallback = { dep: "DEP", arr: "NA", names: [], pts: [] }; 
  
  if (!fp || !Array.isArray(fp.flightPlanItems)) {
    return fallback;
  }
  
  const pts = []; 
  
  const walk = (items) => { 
    for (const i of items) { 
      if (i?.location && i.location.latitude !== 0) {
        pts.push({
          name: i.name || "WP", 
          lat: i.location.latitude, 
          lon: i.location.longitude
        }); 
      }
      if (i.children) {
        walk(i.children); 
      }
    } 
  };
  
  walk(fp.flightPlanItems); 
  
  if (!pts.length) {
    return fallback;
  }
  
  return { 
    dep: pts[0].name, 
    arr: pts.length > 1 ? pts[pts.length - 1].name : "NA", 
    names: pts.map(p => p.name), 
    pts: pts 
  };
}

/* --- API & CESIUM --- */

function setStatus(msg, isErr = false) { 
  if (els.status) {
    els.status.textContent = msg; 
    if (isErr) {
      els.status.style.color = "var(--danger)";
    } else {
      els.status.style.color = "var(--text-muted)";
    }
  } 
}

function fmt(v, d = 0) { 
  if (Number.isFinite(Number(v))) {
    return Number(v).toFixed(d);
  }
  return "-";
}

async function apiGet(path) {
  const headers = {
    Authorization: `Bearer ${state.apiKey}`, 
    "Content-Type": "application/json"
  };
  
  const res = await fetch(`${API_BASE}${path}`, { headers: headers });
  
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  
  const json = await res.json(); 
  if (json.errorCode !== 0) {
    throw new Error(`API Error ${json.errorCode}`); 
  }
  
  return json.result;
}

function initCesium() {
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
  const style = state.labelsEnabled ? Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS : Cesium.IonWorldImageryStyle.AERIAL;
  const layer = await Cesium.ImageryLayer.fromProviderAsync(Cesium.createWorldImageryAsync({ style: style }));
  
  state.viewer.imageryLayers.removeAll(); 
  state.viewer.imageryLayers.add(layer);
  
  state.viewer.scene.globe.showGroundAtmosphere = !!state.boundariesEnabled; 
  state.viewer.scene.globe.enableLighting = true; 
  state.viewer.scene.skyAtmosphere.show = true; 
  state.viewer.scene.fog.enabled = true;
}

function createAircraftEntity(f, pos) {
  return state.viewer.entities.add({
    id: f.flightId, 
    position: pos,
    point: { 
      show: true, 
      pixelSize: 10, 
      color: Cesium.Color.fromCssColorString("#00d2ff"), 
      outlineColor: Cesium.Color.BLACK, 
      outlineWidth: 2, 
      disableDepthTestDistance: Number.POSITIVE_INFINITY 
    },
    label: { 
      text: "✈", 
      font: "22px sans-serif", 
      fillColor: Cesium.Color.WHITE, 
      outlineColor: Cesium.Color.BLACK, 
      outlineWidth: 4, 
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, 
      pixelOffset: new Cesium.Cartesian2(0, -8), 
      disableDepthTestDistance: Number.POSITIVE_INFINITY 
    },
    polyline: { 
      positions: [pos], 
      width: 2, 
      material: Cesium.Color.fromCssColorString("#3a7bd5").withAlpha(0.4) 
    }
  });
}

function upsertAircraft(f) {
  const altitudeMeters = Math.max(0, (Number(f.altitude) || 0) * 0.3048);
  const pos = Cesium.Cartesian3.fromDegrees(Number(f.longitude), Number(f.latitude), altitudeMeters);
  
  let rec = state.aircraftMap.get(f.flightId);
  
  if (!rec) {
    const newRecord = { 
      entity: createAircraftEntity(f, pos), 
      trail: [pos], 
      last: f 
    };
    state.aircraftMap.set(f.flightId, newRecord);
  } else { 
    rec.entity.position = pos; 
    rec.trail.push(pos); 
    
    if (rec.trail.length > TRAIL_LENGTH) {
      rec.trail.shift(); 
    }
    
    rec.entity.polyline.positions = rec.trail; 
    rec.last = f; 
  }
}

/* --- UI PANELS & GLASS COCKPIT --- */

function buildAirlinerPFD(container, prefix) {
  if (container.querySelector('.pfd-airliner')) {
    return;
  }
  
  container.innerHTML = `
    <div class="pfd-airliner">
      <div class="pfd-horizon-mask">
        <div class="pfd-face" id="${prefix}Face">
          <div class="sky"></div>
          <div class="ground"></div>
          <div class="horizon-line"></div>
          <div class="pitch-ladder">
            <div class="ladder-line" style="top:20%;"><span>20</span></div>
            <div class="ladder-line" style="top:35%;"><span>10</span></div>
            <div class="ladder-line" style="top:65%;"><span>10</span></div>
            <div class="ladder-line" style="top:80%;"><span>20</span></div>
          </div>
        </div>
        <div class="pfd-reticle">
          <div class="reticle-left"></div>
          <div class="reticle-center"></div>
          <div class="reticle-right"></div>
        </div>
      </div>
      <div class="pfd-tape speed-tape">
        <div class="tape-bug magenta-bug">
          <span id="${prefix}SpeedBug">---</span>
        </div>
      </div>
      <div class="pfd-tape alt-tape">
        <div class="tape-bug yellow-bug">
          <span id="${prefix}AltBug">---</span>
        </div>
      </div>
      <div class="pfd-heading" id="${prefix}HdgBug">000</div>
    </div>
  `;
}

function bindGlass(prefix, f, fp, phys) {
  const containerId = prefix === 'ifeGc' ? '#ifeGlassView' : '#panelGlass';
  const container = document.querySelector(containerId); 
  
  if (container) {
    buildAirlinerPFD(container, prefix);
  }
  
  const speedBug = byId(`${prefix}SpeedBug`);
  const altBug = byId(`${prefix}AltBug`);
  const hdgBug = byId(`${prefix}HdgBug`);
  const face = byId(`${prefix}Face`);
  
  if (speedBug) {
    speedBug.textContent = Math.round(f?.speed || 0).toString().padStart(3, '0');
  }
  
  if (altBug) {
    altBug.textContent = Math.round(f?.altitude || 0).toString().padStart(5, '0');
  }
  
  if (hdgBug) {
    hdgBug.textContent = Math.round(f?.heading || 0).toString().padStart(3, '0');
  }
  
  if (phys && face) {
    const pitchPx = Math.max(-150, Math.min(150, phys.pitch * 4));
    face.style.transform = `rotate(${phys.roll}deg) translateY(${pitchPx}px)`;
  }
}

function updatePanelsFromSelected() {
  const rec = state.aircraftMap.get(state.selectedFlightId);
  const f = rec?.last; 
  
  if (!f) {
    return;
  }
  
  const fp = state.flightPlanCache.get(f.flightId); 
  const aType = fp?.aircraftType || fp?.aircraftName || f?.aircraftName || "Unknown";
  const phys = updateAircraftPhysics(f.flightId, f.heading, f.speed, f.verticalSpeed, f.altitude);
  
  const setText = (id, txt) => { 
    if (els[id]) {
      els[id].textContent = txt; 
    }
  };
  
  // Set basic flight info
  setText("fiCallsign", f.callsign || "-"); 
  setText("fiUser", f.username || "-"); 
  setText("fiSpd", `${Math.round(f.speed)} kts`); 
  setText("fiAlt", `${Math.round(f.altitude)} ft`); 
  setText("fiHdg", `${Math.round(f.heading)}°`); 
  setText("fiVs", `${Math.round(f.verticalSpeed)} fpm`); 
  setText("fiLat", fmt(f.latitude, 4)); 
  setText("fiLon", fmt(f.longitude, 4));
  
  // Set selected strip info
  setText("stripCallsign", f.callsign || "-"); 
  setText("stripType", aType); 
  setText("stripPilot", f.username || "-"); 
  setText("stripGs", `${Math.round(f.speed)} kts`); 
  setText("stripAlt", `${Math.round(f.altitude)} ft`); 
  setText("stripVs", `${Math.round(f.verticalSpeed)} fpm`);
  
  // Set IFE info
  setText("ifeTitle", f.callsign || "--"); 
  setText("ifeSub", `${aType} • ${f.username || "-"}`); 
  setText("welcomeCallsign", f.callsign || "--"); 
  setText("ifeSpd", `${Math.round(f.speed)} kts`); 
  setText("ifeAlt", `${Math.round(f.altitude)} ft`); 
  setText("ifeHdg", `${Math.round(f.heading)}°`); 
  setText("ifeVs", `${Math.round(f.verticalSpeed)} fpm`);

  // Bind the Glass Cockpits
  bindGlass("gc", f, fp, phys); 
  bindGlass("ifeGc", f, fp, phys);

  // Route extraction and ETA math
  const route = extractDepArr(fp); 
  const oat = calculateOAT(f.altitude || 0);
  
  setText("ifeDep", route.dep); 
  setText("ifeArr", route.arr); 
  setText("fromCode", route.dep); 
  setText("toCode", route.arr);

  if (route.pts.length > 0 && els.ifeRoute) {
    const destLat = route.pts[route.pts.length - 1].lat;
    const destLon = route.pts[route.pts.length - 1].lon;
    const dKm = haversineKm(f.latitude, f.longitude, destLat, destLon);
    const eta = computeEtaDetails(dKm, f.speed);
    
    els.ifeRoute.innerHTML = `
      <div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:12px;">
        ${route.names.join(" → ")}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;border-top:1px solid var(--border-color);padding-top:15px;text-align:center;">
        <div style="color:var(--text-muted);font-size:0.8rem;text-transform:uppercase;">
          Dist to Dest<br/>
          <span style="color:var(--accent-green);font-size:1.2rem;font-weight:bold;">${Math.round(dKm)} km</span>
        </div>
        <div style="color:var(--text-muted);font-size:0.8rem;text-transform:uppercase;">
          ETA (Local)<br/>
          <span style="color:var(--accent-green);font-size:1.2rem;font-weight:bold;">${eta.etaLocal}</span>
        </div>
        <div style="color:var(--text-muted);font-size:0.8rem;text-transform:uppercase;">
          Time to Arr<br/>
          <span style="color:var(--accent-green);font-size:1.2rem;font-weight:bold;">${eta.durationText}</span>
        </div>
        <div style="grid-column:1/span 3;margin-top:10px;color:var(--text-muted);font-size:0.85rem;">
          OAT: ${oat}°C • Arrival: ${route.arr}
        </div>
      </div>
    `;
  } else if (els.ifeRoute) {
    els.ifeRoute.innerHTML = `
      <div>No valid flight plan waypoints available</div>
      <div style="margin-top:8px;">ETA (Local): <b>--:--</b></div>
      <div>Time to Arrival: <b>-- h -- min</b></div>
      <div>Arrival: <b>NA</b></div>
    `;
  }
}

/* --- LOGIC & EVENTS --- */

async function fetchSelectedFlightDetails(id) {
  if (!state.sessionId || !id || state.pendingDetailFetch.has(id)) {
    return;
  }
  
  state.pendingDetailFetch.add(id);
  
  try {
    try {
      const planData = await apiGet(`/sessions/${state.sessionId}/flights/${id}/flightplan`);
      state.flightPlanCache.set(id, planData);
    } catch (e) {
      state.flightPlanCache.set(id, null);
    }
    
    try {
      const routeData = await apiGet(`/sessions/${state.sessionId}/flights/${id}/route`);
      state.flightRouteCache.set(id, routeData);
    } catch (e) {
      state.flightRouteCache.set(id, null);
    }
    
    if (state.selectedFlightId === id) {
      updatePanelsFromSelected();
    }
  } finally { 
    state.pendingDetailFetch.delete(id); 
  }
}

async function pollFlights() {
  if (!state.sessionId) {
    return;
  }
  
  try {
    const flights = await apiGet(`/sessions/${state.sessionId}/flights`); 
    const active = new Set(flights.map(f => f.flightId));
    
    flights.forEach((f) => upsertAircraft(f));
    
    for (const [id, rec] of state.aircraftMap.entries()) {
      if (!active.has(id)) { 
        state.viewer.entities.remove(rec.entity); 
        state.aircraftMap.delete(id); 
        
        if (state.selectedFlightId === id) {
          state.selectedFlightId = null; 
        }
      }
    }
    
    if (!state.didInitialZoom && flights.length > 0) { 
      state.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(flights[0].longitude, flights[0].latitude, 2500000),
        duration: 1.2
      }); 
      state.didInitialZoom = true; 
    }
    
    if (state.selectedFlightId) {
      updatePanelsFromSelected(); 
    }
    
    if (state.followSelected && state.selectedFlightId) {
      state.viewer.trackedEntity = state.aircraftMap.get(state.selectedFlightId)?.entity;
    }
    
    setStatus(`Tracking ${flights.length} flights`);
  } catch (e) { 
    setStatus(`Polling error: ${e.message}`, true); 
  }
}

function selectFlight(id) {
  state.selectedFlightId = id;
  
  for (const [fid, rec] of state.aircraftMap.entries()) { 
    const isSelected = (fid === id); 
    rec.entity.point.pixelSize = isSelected ? 15 : 10; 
    rec.entity.label.scale = isSelected ? 1.3 : 1.0; 
    rec.entity.polyline.width = isSelected ? 3 : 2; 
  }
  
  updatePanelsFromSelected(); 
  fetchSelectedFlightDetails(id);
  
  if (state.mode === "ife") { 
    if (els.ifeOverlay) {
      els.ifeOverlay.classList.remove("hidden"); 
    }
    if (!state.ifeStarted) { 
      if (els.ifeWelcome) els.ifeWelcome.classList.remove("hidden"); 
      if (els.ifePanel) els.ifePanel.classList.add("hidden"); 
    } else { 
      if (els.ifeWelcome) els.ifeWelcome.classList.add("hidden"); 
      if (els.ifePanel) els.ifePanel.classList.remove("hidden"); 
    } 
  } else { 
    if (els.drawer) els.drawer.style.display = "block"; 
    if (els.selectedStrip) els.selectedStrip.style.display = "flex"; 
  }
}

// FLIGHT SEARCH ENGINE
function searchFlight() {
  const query = els.searchInput?.value.toLowerCase().trim();
  
  if (!query) {
    setStatus("Enter a callsign or username to search.");
    return;
  }
  
  let found = null;
  
  for (const rec of state.aircraftMap.values()) {
    const callsign = (rec.last.callsign || "").toLowerCase();
    const username = (rec.last.username || "").toLowerCase();
    
    if (callsign.includes(query) || username.includes(query)) { 
      found = rec; 
      break; 
    }
  }
  
  if (found) {
    const altitudeZoom = Math.max(120000, (found.last.altitude || 0) * 0.3048 + 100000);
    
    state.viewer.camera.flyTo({ 
      destination: Cesium.Cartesian3.fromDegrees(found.last.longitude, found.last.latitude, altitudeZoom), 
      duration: 1.5 
    });
    
    selectFlight(found.last.flightId);
    setStatus(`Found flight: ${found.last.callsign}`);
  } else {
    setStatus(`Flight not found for: ${query}`, true);
  }
}

(async function bootstrap() {
  try {
    initCesium(); 
    await applyGlobeStyle();
    
    if (els.searchBtn) {
      els.searchBtn.addEventListener("click", searchFlight);
    }
    
    if (els.searchInput) {
      els.searchInput.addEventListener("keypress", (e) => { 
        if (e.key === "Enter") {
          searchFlight(); 
        }
      });
    }
    
    if (els.tabFlightInfo) {
      els.tabFlightInfo.addEventListener("click", () => { 
        els.tabFlightInfo.classList.add("active"); 
        els.tabGlass.classList.remove("active"); 
        els.panelFlightInfo.style.display = "block"; 
        els.panelGlass.style.display = "none"; 
      });
    }
    
    if (els.tabGlass) {
      els.tabGlass.addEventListener("click", () => { 
        els.tabFlightInfo.classList.remove("active"); 
        els.tabGlass.classList.add("active"); 
        els.panelFlightInfo.style.display = "none"; 
        els.panelGlass.style.display = "block"; 
      });
    }
    
    if (els.connectBtn) {
      els.connectBtn.addEventListener("click", () => { 
        state.sessionId = els.serverSelect?.value; 
        
        if (!state.sessionId) {
          return;
        }
        
        if (els.topServer) {
          els.topServer.textContent = els.serverSelect.options[els.serverSelect.selectedIndex].text; 
        }
        
        if (state.polling) {
          clearInterval(state.polling); 
        }
        
        pollFlights(); 
        state.polling = setInterval(pollFlights, POLL_MS); 
      });
    }
    
    if (els.openRandomBtn) {
      els.openRandomBtn.addEventListener("click", () => { 
        const a = Array.from(state.aircraftMap.values()); 
        
        if (a.length) { 
          const f = a[Math.floor(Math.random() * a.length)].last; 
          
          state.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(f.longitude, f.latitude, 250000),
            duration: 1.3
          }); 
          
          selectFlight(f.flightId); 
        } 
      });
    }
    
    if (els.radarModeBtn) {
      els.radarModeBtn.addEventListener("click", () => { 
        state.mode = "radar"; 
        document.body.className = "mode-radar"; 
        
        if (els.ifeOverlay) {
          els.ifeOverlay.classList.add("hidden"); 
        }
        
        els.radarModeBtn.classList.add("active"); 
        els.ifeModeBtn.classList.remove("active"); 
      });
    }
    
    if (els.ifeModeBtn) {
      els.ifeModeBtn.addEventListener("click", () => { 
        state.mode = "ife"; 
        document.body.className = "mode-ife"; 
        els.radarModeBtn.classList.remove("active"); 
        els.ifeModeBtn.classList.add("active"); 
        
        if (state.selectedFlightId) { 
          if (els.ifeOverlay) {
            els.ifeOverlay.classList.remove("hidden"); 
          }
          if (!state.ifeStarted) {
            if (els.ifeWelcome) els.ifeWelcome.classList.remove("hidden");
            if (els.ifePanel) els.ifePanel.classList.add("hidden");
          } else {
            if (els.ifeWelcome) els.ifeWelcome.classList.add("hidden");
            if (els.ifePanel) els.ifePanel.classList.remove("hidden");
          } 
        } 
      });
    }
    
    if (els.followBtn) {
      els.followBtn.addEventListener("click", () => { 
        state.followSelected = !state.followSelected; 
        els.followBtn.classList.toggle("active", state.followSelected); 
        
        if (!state.followSelected) {
          state.viewer.trackedEntity = undefined; 
        } else if (state.selectedFlightId) {
          state.viewer.trackedEntity = state.aircraftMap.get(state.selectedFlightId)?.entity; 
        }
      });
    }
    
    if (els.labelsToggleBtn) {
      els.labelsToggleBtn.addEventListener("click", async () => { 
        state.labelsEnabled = !state.labelsEnabled; 
        els.labelsToggleBtn.textContent = `Map Labels: ${state.labelsEnabled ? "ON" : "OFF"}`; 
        await applyGlobeStyle(); 
      });
    }
    
    if (els.boundariesToggleBtn) {
      els.boundariesToggleBtn.addEventListener("click", async () => { 
        state.boundariesEnabled = !state.boundariesEnabled; 
        els.boundariesToggleBtn.textContent = `Boundaries: ${state.boundariesEnabled ? "ON" : "OFF"}`; 
        await applyGlobeStyle(); 
      });
    }
    
    if (els.togglePanelBtn) {
      els.togglePanelBtn.addEventListener("click", () => { 
        const hidden = els.controlShell?.classList.toggle("hidden"); 
        if (els.togglePanelBtn) {
          els.togglePanelBtn.textContent = hidden ? "Show Panel" : "Hide Panel"; 
        }
      });
    }
    
    if (els.drawerCloseBtn) {
      els.drawerCloseBtn.addEventListener("click", () => { 
        if (els.drawer) els.drawer.style.display = "none"; 
        if (els.selectedStrip) els.selectedStrip.style.display = "none"; 
        state.selectedFlightId = null; 
      });
    }
    
    if (els.ifeStartBtn) {
      els.ifeStartBtn.addEventListener("click", () => { 
        state.ifeStarted = true; 
        if (els.ifeWelcome) els.ifeWelcome.classList.add("hidden"); 
        if (els.ifePanel) els.ifePanel.classList.remove("hidden"); 
      });
    }
    
    if (els.ifeCloseBtn) {
      els.ifeCloseBtn.addEventListener("click", () => { 
        if (els.ifeOverlay) {
          els.ifeOverlay.classList.add("hidden"); 
        }
      });
    }
    
    if (els.changeViewBtn) {
      els.changeViewBtn.addEventListener("click", () => { 
        state.ifeView = state.ifeView === "flightInfo" ? "glass" : "flightInfo"; 
        
        if (els.ifeFlightInfoView) {
          els.ifeFlightInfoView.classList.toggle("hidden", state.ifeView !== "flightInfo"); 
        }
        
        if (els.ifeGlassView) {
          els.ifeGlassView.classList.toggle("hidden", state.ifeView === "flightInfo"); 
        }
      });
    }
    
    const sessions = await apiGet("/sessions"); 
    
    if (els.serverSelect) { 
      els.serverSelect.innerHTML = `<option value="">Select server</option>`; 
      
      sessions.forEach(s => {
        els.serverSelect.innerHTML += `<option value="${s.id}">${s.name} (${s.userCount}/${s.maxUsers})</option>`;
      }); 
    }
    
    setStatus("Ready.");
  } catch(e) { 
    setStatus(`Startup error: ${e.message}`, true); 
  }
})();
