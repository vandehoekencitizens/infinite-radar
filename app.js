const API_KEY = "PUT_YOUR_API_KEY_HERE";

const viewer = new Cesium.Viewer("cesiumContainer", {
  terrainProvider: Cesium.createWorldTerrain()
});

let aircraft = {};
let history = {};
let selected = null;

// SMOOTH INTERPOLATION
function smoothMove(entity, newPos) {
  const property = new Cesium.SampledPositionProperty();
  const now = Cesium.JulianDate.now();

  property.addSample(now, entity.position.getValue(now));
  property.addSample(
    Cesium.JulianDate.addSeconds(now, 5, new Cesium.JulianDate()),
    newPos
  );

  entity.position = property;
}

// FETCH DATA
async function loadFlights() {
  const sessions = await fetch(`https://api.infiniteflight.com/public/v2/sessions?apikey=${API_KEY}`).then(r => r.json());

  const server = document.getElementById("server").value;
  const session = sessions.result.find(s => s.name.toLowerCase().includes(server));

  if (!session) return;

  const flights = await fetch(
    `https://api.infiniteflight.com/public/v2/sessions/${session.id}/flights?apikey=${API_KEY}`
  ).then(r => r.json());

  flights.result.forEach(f => {
    if (!f.latitude || !f.longitude) return;

    const id = f.id;

    const pos = Cesium.Cartesian3.fromDegrees(
      f.longitude,
      f.latitude,
      f.altitude * 0.3048
    );

    // CREATE
    if (!aircraft[id]) {
      aircraft[id] = viewer.entities.add({
        position: pos,
        billboard: {
          image: "plane.png",
          scale: 0.05
        }
      });
    } else {
      smoothMove(aircraft[id], pos);
    }

    // TRAILS
    if (!history[id]) history[id] = [];
    history[id].push([f.longitude, f.latitude]);

    if (history[id].length > 30) history[id].shift();

    viewer.entities.add({
      polyline: {
        positions: history[id].map(p =>
          Cesium.Cartesian3.fromDegrees(p[0], p[1])
        ),
        width: 2,
        material: Cesium.Color.CYAN
      }
    });

    // UPDATE COCKPIT IF SELECTED
    if (selected === id) {
      updateCockpit(f);
    }
  });
}

// CLICK
viewer.screenSpaceEventHandler.setInputAction(function(click) {
  const picked = viewer.scene.pick(click.position);
  if (picked && picked.id) {
    selected = Object.keys(aircraft).find(k => aircraft[k] === picked.id);
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// GLASS COCKPIT (SIMULATED)
function updateCockpit(f) {
  document.getElementById("pfd").innerHTML = `
    ALT ${f.altitude} ft<br>
    SPD ${f.speed} kts<br>
    HDG ${f.heading}°
  `;

  document.getElementById("nd").innerHTML = `
    NAV DISPLAY<br>
    LAT ${f.latitude.toFixed(2)}<br>
    LON ${f.longitude.toFixed(2)}
  `;
}

// IFE MODE CAMERA
function updateCamera() {
  if (document.getElementById("mode").value !== "ife") return;
  if (!selected) return;

  viewer.trackedEntity = aircraft[selected];
}

// LOOP
setInterval(() => {
  loadFlights();
  updateCamera();
}, 5000);
