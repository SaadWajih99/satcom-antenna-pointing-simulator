const COMPASS_CENTER = { x: 786, y: 292 };
const COMPASS_RADIUS = 126;

function byId(id) {
  return document.getElementById(id);
}

function setLine(id, end) {
  const line = byId(id);
  line.setAttribute("x2", end.x.toFixed(1));
  line.setAttribute("y2", end.y.toFixed(1));
}

function setText(id, value) {
  byId(id).textContent = value;
}

function compassEndpoint(degrees) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: COMPASS_CENTER.x + Math.sin(radians) * COMPASS_RADIUS,
    y: COMPASS_CENTER.y - Math.cos(radians) * COMPASS_RADIUS,
  };
}

function signedAzimuthError(target, actual) {
  return ((target - actual + 540) % 360) - 180;
}

function setMarker(id, value, max) {
  byId(id).style.left = `${(value / max) * 100}%`;
}

function configureViewLayout() {
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  byId("antenna-svg").setAttribute("viewBox", mobile ? "0 0 600 1120" : "0 0 1000 570");
  byId("compass").setAttribute("transform", mobile ? "translate(-604 454) scale(1.15)" : "");
}

export function renderAntennaView({ targetAz, targetEl, antennaAz, antennaEl }) {
  configureViewLayout();
  const elevationOrigin = { x: 247, y: 322 };
  const elevationLength = 177;
  const targetRadians = (targetEl * Math.PI) / 180;
  const antennaRadians = (antennaEl * Math.PI) / 180;
  const elevationEndpoint = (angle) => ({
    x: elevationOrigin.x + Math.cos(angle) * elevationLength,
    y: elevationOrigin.y - Math.sin(angle) * elevationLength,
  });

  setLine("target-elevation-vector", elevationEndpoint(targetRadians));
  setLine("actual-elevation-vector", elevationEndpoint(antennaRadians));
  byId("dish-assembly").setAttribute("transform", `rotate(${-antennaEl} ${elevationOrigin.x} ${elevationOrigin.y})`);
  setText("elevation-angle-label", `${String(antennaEl).padStart(2, "0")}° EL`);

  setLine("target-azimuth-vector", compassEndpoint(targetAz));
  setLine("actual-azimuth-vector", compassEndpoint(antennaAz));
  setText("compass-target", `${String(targetAz).padStart(3, "0")}°`);
  setText("compass-actual", `${String(antennaAz).padStart(3, "0")}°`);

  setText("readout-target-az", `${targetAz.toFixed(1).padStart(5, "0")}°`);
  setText("readout-antenna-az", `${antennaAz.toFixed(1).padStart(5, "0")}°`);
  setText("readout-error-az", `${signedAzimuthError(targetAz, antennaAz) >= 0 ? "+" : "−"}${Math.abs(signedAzimuthError(targetAz, antennaAz)).toFixed(1)}°`);
  setText("readout-target-el", `${targetEl.toFixed(1).padStart(5, "0")}°`);
  setText("readout-antenna-el", `${antennaEl.toFixed(1).padStart(5, "0")}°`);
  setText("readout-error-el", `${targetEl - antennaEl >= 0 ? "+" : "−"}${Math.abs(targetEl - antennaEl).toFixed(1)}°`);

  setMarker("az-target-marker", targetAz, 360);
  setMarker("az-antenna-marker", antennaAz, 360);
  setMarker("el-target-marker", targetEl, 90);
  setMarker("el-antenna-marker", antennaEl, 90);
}

export function attachAntennaViewControls() {
  const axes = [
    { key: "targetAz", range: "target-az", number: "target-az-number", max: 360 },
    { key: "targetEl", range: "target-el", number: "target-el-number", max: 90 },
    { key: "antennaAz", range: "antenna-az", number: "antenna-az-number", max: 360 },
    { key: "antennaEl", range: "antenna-el", number: "antenna-el-number", max: 90 },
  ];
  const state = Object.fromEntries(axes.map(({ key, range }) => [key, Number(byId(range).value)]));
  const update = () => renderAntennaView(state);
  window.addEventListener("resize", configureViewLayout);

  for (const axis of axes) {
    const slider = byId(axis.range);
    const number = byId(axis.number);
    const commit = (rawValue) => {
      const parsed = Number(rawValue);
      const value = Math.min(axis.max, Math.max(0, Number.isFinite(parsed) ? parsed : 0));
      state[axis.key] = value;
      slider.value = String(value);
      number.value = String(value);
      slider.style.setProperty("--progress", `${(value / axis.max) * 100}%`);
      update();
    };

    slider.addEventListener("input", () => commit(slider.value));
    number.addEventListener("input", () => {
      if (number.value !== "") commit(number.value);
    });
    number.addEventListener("change", () => commit(number.value));
    commit(state[axis.key]);
  }

  byId("reset-view").addEventListener("click", () => {
    for (const axis of axes) commitAxis(axis, axis.key.startsWith("target") ? (axis.key.endsWith("Az") ? 72 : 38) : (axis.key.endsWith("Az") ? 48 : 31));
    update();
  });

  function commitAxis(axis, value) {
    state[axis.key] = value;
    byId(axis.range).value = String(value);
    byId(axis.number).value = String(value);
    byId(axis.range).style.setProperty("--progress", `${(value / axis.max) * 100}%`);
  }

  update();
}
