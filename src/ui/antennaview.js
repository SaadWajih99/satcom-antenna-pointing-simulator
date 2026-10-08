const COMPASS_CENTER = { x: 786, y: 292 };
const COMPASS_RADIUS = 126;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  byId(id).textContent = value;
}

function setLine(id, end) {
  const line = byId(id);
  line.setAttribute("x2", end.x.toFixed(1));
  line.setAttribute("y2", end.y.toFixed(1));
}

function compassEndpoint(degrees) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: COMPASS_CENTER.x + Math.sin(radians) * COMPASS_RADIUS,
    y: COMPASS_CENTER.y - Math.cos(radians) * COMPASS_RADIUS,
  };
}

function configureViewLayout() {
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  byId("antenna-svg").setAttribute("viewBox", mobile ? "0 0 600 1120" : "0 0 1000 570");
  byId("compass").setAttribute("transform", mobile ? "translate(-604 454) scale(1.15)" : "");
}

export function renderAntennaView(sim) {
  configureViewLayout();
  const az = sim.axes.az.position;
  const el = sim.axes.el.position;
  const elevationOrigin = { x: 247, y: 322 };
  const elevationLength = 177;
  const endpoint = (angle) => ({
    x: elevationOrigin.x + Math.cos((angle * Math.PI) / 180) * elevationLength,
    y: elevationOrigin.y - Math.sin((angle * Math.PI) / 180) * elevationLength,
  });

  setLine("target-elevation-vector", endpoint(sim.target.el));
  setLine("actual-elevation-vector", endpoint(el));
  byId("dish-assembly").setAttribute("transform", `rotate(${-el} ${elevationOrigin.x} ${elevationOrigin.y})`);
  setText("elevation-angle-label", `${el.toFixed(1)}° EL`);

  setLine("target-azimuth-vector", compassEndpoint(sim.target.az));
  setLine("actual-azimuth-vector", compassEndpoint(az));
  setText("compass-target", `${String(Math.round(sim.target.az) % 360).padStart(3, "0")}°`);
  setText("compass-actual", `${String(Math.round(az) % 360).padStart(3, "0")}°`);
}

export function attachViewResize() {
  window.addEventListener("resize", configureViewLayout);
  configureViewLayout();
}
