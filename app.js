const API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u";
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3MDU4NWI1YS03ZGUxLTRmMzEtODEwZi01MDNlM2QyMTg5MzAiLCJpZCI6NDExNTkzLCJpYXQiOjE3NzQ5MjgxNjh9.NeKegq8BpQ4KqIs2hJWNgoEy2c0vidgNg869ldUVFew";

const viewer = new Cesium.Viewer("cesiumContainer", {
  terrain: Cesium.Terrain.fromWorldTerrain()
});

viewer.scene.globe.baseColor = Cesium.Color.BLACK;
viewer.clock.shouldAnimate = true;

let aircraft = {};
let selected = null;

/* =========================
   MODE SWITCH (Radar / IFE)
========================= */
function updateMode() {
  const mode = document.getElementById("mode").value;

  document.body.classList.toggle("radar-mode", mode === "radar");
  document.body.classList.toggle("ife-mode", mode === "ife");
}

/* =========================
   SMOOTH MOVE
========================= */
function smoothMove(entity, pos) {
  const now = Cesium.JulianDate.now();
  const prop = new Cesium.SampledPositionProperty();

  prop.addSample(now, entity.position.getValue(now));
  prop.addSample(
    Cesium.JulianDate.addSeconds(now, 2, new Cesium.JulianDate()),
    pos
  );

  entity.position = prop;
}

/* =========================
   LOAD FLIGHTS
========================= */
async function loadFlights() {
  try {
    const sessions = await fetch(
      `https://api.infiniteflight.com/public/v2/sessions?apikey=${API_KEY}`
    ).then(r => r.json());

    const server = document.getElementById("server").value;
    const session = sessions.result?.find(s =>
      s.name.toLowerCase().includes(server)
    );

    if (!session) return;

    const flights = await fetch(
      `https://api.infiniteflight.com/public/v2/sessions/${session.id}/flights?apikey=${API_KEY}`
    ).then(r => r.json());

    if (!flights.result) return;

    flights.result.forEach(f => {
      if (!f.latitude || !f.longitude) return;

      const pos = Cesium.Cartesian3.fromDegrees(
        f.longitude,
        f.latitude,
        (f.altitude || 0) * 0.3048
      );

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

      if (selected === f.id) {
        updateCockpit(f);
      }
    });

  } catch (e) {
    console.error(e);
  }
}

/* =========================
   CLICK SELECT
========================= */
viewer.screenSpaceEventHandler.setInputAction(function(click) {
  const picked = viewer.scene.pick(click.position);

  if (picked && picked.id) {
    selected = picked.id.id;
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

/* =========================
   COCKPIT
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
   CAMERA
========================= */
function updateCamera() {
  if (document.getElementById("mode").value !== "ife") return;
  if (!selected) return;

  viewer.trackedEntity = aircraft[selected];
}

/* =========================
   EVENTS
========================= */
document.getElementById("mode").addEventListener("change", updateMode);

/* =========================
   LOOP
========================= */
setInterval(() => {
  loadFlights();
  updateCamera();
}, 2000);
