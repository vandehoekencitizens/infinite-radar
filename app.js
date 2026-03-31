const API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

/* =========================
   VIEWER (FIXED TERRAIN)
========================= */
// Grant CesiumJS access to your ion assets
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

const viewer = new Cesium.Viewer("cesiumContainer", {
  geocoder: Cesium.IonGeocodeProviderType.GOOGLE,
});

try {
  const imageryLayer = viewer.imageryLayers.addImageryProvider(
    await Cesium.IonImageryProvider.fromAssetId(3830183),
  );
  await viewer.zoomTo(imageryLayer);
} catch (error) {
  console.log(error);
}


// Improve visual feel
viewer.scene.globe.baseColor = Cesium.Color.BLACK;
viewer.clock.shouldAnimate = true;
viewer.clock.multiplier = 1;

let aircraft = {};
let selected = null;

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
   LOAD FLIGHTS (SAFE)
========================= */
async function loadFlights() {
  try {
    const sessionsRes = await fetch(
      `https://api.infiniteflight.com/public/v2/sessions?apikey=${API_KEY}`
    );
    const sessions = await sessionsRes.json();

    if (!sessions.result) {
      console.error("Sessions failed:", sessions);
      return;
    }

    const server = document.getElementById("server").value.toLowerCase();

    const session = sessions.result.find(s =>
      s.name.toLowerCase().includes(server)
    );

    if (!session) {
      console.warn("No matching session found");
      return;
    }

    const flightsRes = await fetch(
      `https://api.infiniteflight.com/public/v2/sessions/${session.id}/flights?apikey=${API_KEY}`
    );
    const flights = await flightsRes.json();

    if (!flights.result) {
      console.error("Flights failed:", flights);
      return;
    }

    const activeIds = new Set(flights.result.map(f => f.id));

    flights.result.forEach(f => {
      if (!f.latitude || !f.longitude) return;

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
            scale: 0.04
          },
          path: {
            material: Cesium.Color.CYAN,
            width: 2,
            trailTime: 120
          }
        });
      } else {
        smoothMove(aircraft[f.id], pos);
      }

      // UPDATE COCKPIT
      if (selected === f.id) {
        updateCockpit(f);
      }
    });

    // CLEANUP OLD AIRCRAFT
    Object.keys(aircraft).forEach(id => {
      if (!activeIds.has(id)) {
        viewer.entities.remove(aircraft[id]);
        delete aircraft[id];
      }
    });

  } catch (err) {
    console.error("API Error:", err);
  }
}

/* =========================
   CLICK SELECTION
========================= */
viewer.screenSpaceEventHandler.setInputAction(click => {
  const picked = viewer.scene.pick(click.position);

  if (picked && picked.id) {
    selected = picked.id.id;
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

/* =========================
   COCKPIT UI
========================= */
function updateCockpit(f) {
  document.getElementById("pfd").innerHTML = `
    ALT ${f.altitude} ft<br>
    SPD ${f.speed} kts<br>
    HDG ${f.heading}°
  `;

  document.getElementById("nd").innerHTML = `
    LAT ${f.latitude.toFixed(2)}<br>
    LON ${f.longitude.toFixed(2)}
  `;
}

/* =========================
   CAMERA TRACKING (IFE MODE)
========================= */
function updateCamera() {
  if (document.getElementById("mode").value !== "ife") return;
  if (!selected) return;

  viewer.trackedEntity = aircraft[selected];
}

/* =========================
   DEBUG (VERY IMPORTANT)
========================= */
console.log("App started. If nothing loads:");
console.log("- Check API key");
console.log("- Check console errors (F12)");
console.log("- Check Cesium token");

/* =========================
   MAIN LOOP
========================= */
setInterval(() => {
  loadFlights();
  updateCamera();
}, 2000);

/* Initialize mode */
updateMode();
