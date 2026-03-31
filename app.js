const API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

/* =========================
   VIEWER
========================= */
// Grant CesiumJS access to your ion assets
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

const viewer = new Cesium.Viewer("cesiumContainer", {
 geocoder: true
    baseLayerPicker: true,
});

async function loadImagery() {
  try {
    const imageryLayer = viewer.imageryLayers.addImageryProvider(
      await Cesium.IonImageryProvider.fromAssetId(3830183)
    );

    await viewer.zoomTo(imageryLayer);
  } catch (error) {
    console.log(error);
  }
}

loadImagery();


// start camera properly
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(0, 20, 20000000)
});

viewer.scene.globe.baseColor = Cesium.Color.BLACK;
viewer.clock.shouldAnimate = true;

let aircraft = {};
let selected = null;

/* =========================
   DEBUG LOGGER
========================= */
function debug(label, data) {
  console.log(`[DEBUG] ${label}:`, data);
}

/* =========================
   MODE HANDLING
========================= */
function updateMode() {
  const mode = document.getElementById("mode").value;

  document.body.classList.toggle("radar-mode", mode === "radar");
  document.body.classList.toggle("ife-mode", mode === "ife");
}

document.getElementById("mode").addEventListener("change", updateMode);

/* =========================
   SMOOTH INTERPOLATION
========================= */
function smoothMove(entity, newPos) {
  const now = Cesium.JulianDate.now();
  const property = new Cesium.SampledPositionProperty();

  const current = entity.position.getValue(now);
  if (!current) return;

  property.addSample(now, current);

  const future = Cesium.JulianDate.addSeconds(now, 2, new Cesium.JulianDate());
  property.addSample(future, newPos);

  entity.position = property;
}

/* =========================
   LOAD FLIGHTS
========================= */
async function loadFlights() {
  try {
    debug("Fetching sessions", "");

    const sessionsRes = await fetch(
      `https://api.infiniteflight.com/public/v2/sessions?apikey=${API_KEY}`
    );

    const sessions = await sessionsRes.json();
    debug("Sessions response", sessions);

    if (!sessions.result || sessions.result.length === 0) {
      console.error("❌ No sessions found (API issue or key wrong)");
      return;
    }

    const server = document.getElementById("server").value.toLowerCase();

    // safer session selection
    const session = sessions.result.find(s =>
      s.name.toLowerCase().includes(server)
    );

    if (!session) {
      console.warn("⚠️ No matching session found. Using first session.");
    }

    const activeSession = session || sessions.result[0];

    debug("Using session", activeSession);

    const flightsRes = await fetch(
      `https://api.infiniteflight.com/public/v2/sessions/${activeSession.id}/flights?apikey=${API_KEY}`
    );

    const flights = await flightsRes.json();
    debug("Flights response", flights);

    if (!flights.result) {
      console.error("❌ Flights API failed");
      return;
    }

    const activeIds = new Set(flights.result.map(f => f.id));

    flights.result.forEach(f => {
      // FIX: allow 0 values
      if (f.latitude == null || f.longitude == null) return;

      const pos = Cesium.Cartesian3.fromDegrees(
        f.longitude,
        f.latitude,
        (f.altitude || 0) * 0.3048
      );

      // CREATE AIRCRAFT
      if (!aircraft[f.id]) {
        aircraft[f.id] = viewer.entities.add({
          id: f.id,
          position: pos,
          billboard: {
            image: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
            scale: 0.06
          },
          path: {
            material: Cesium.Color.CYAN,
            width: 2,
            trailTime: 120
          }
        });

        debug("Created aircraft", f.id);
      } else {
        smoothMove(aircraft[f.id], pos);
      }

      if (selected === f.id) {
        updateCockpit(f);
      }
    });

    // CLEANUP
    Object.keys(aircraft).forEach(id => {
      if (!activeIds.has(id)) {
        viewer.entities.remove(aircraft[id]);
        delete aircraft[id];
        debug("Removed aircraft", id);
      }
    });

    debug("Aircraft count", Object.keys(aircraft).length);

  } catch (err) {
    console.error("❌ API ERROR:", err);
  }
}

/* =========================
   CLICK SELECTION
========================= */
viewer.screenSpaceEventHandler.setInputAction(click => {
  const picked = viewer.scene.pick(click.position);

  if (picked && picked.id) {
    selected = picked.id.id;
    debug("Selected aircraft", selected);
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

/* =========================
   COCKPIT
========================= */
function updateCockpit(f) {
  document.getElementById("pfd").innerHTML = `
    ALT ${Math.round(f.altitude)} ft<br>
    SPD ${Math.round(f.speed)} kts<br>
    HDG ${Math.round(f.heading)}°
  `;

  document.getElementById("nd").innerHTML = `
    LAT ${f.latitude.toFixed(2)}<br>
    LON ${f.longitude.toFixed(2)}
  `;
}

/* =========================
   CAMERA (IFE MODE)
========================= */
function updateCamera() {
  if (document.getElementById("mode").value !== "ife") return;
  if (!selected || !aircraft[selected]) return;

  viewer.trackedEntity = aircraft[selected];
}

/* =========================
   DEBUG STARTUP
========================= */
console.log("🚀 App started");
console.log("👉 If nothing shows:");
console.log("- Check API key");
console.log("- Open DevTools (F12)");
console.log("- Look for [DEBUG] logs below");

/* =========================
   MAIN LOOP
========================= */
setInterval(() => {
  loadFlights();
  updateCamera();
}, 2000);

/* INIT */
updateMode();
