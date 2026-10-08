import {
  emergencyStop,
  rearmSimulator,
  resetController,
  resetPerformanceWindow,
  resetSimulator,
  setFault,
  setTarget,
} from "../simulation/simulator.js?v=phase14-1";
import { renderAntennaView, attachViewResize } from "./antennaView.js?v=phase14-1";
import { applyPreset, clearFaults, DEMO_STEPS } from "./scenarios.js?v=phase14-1";

const HEALTH_CLASS = { GREEN: "green", YELLOW: "yellow", ORANGE: "orange", RED: "red" };
const STATE_CLASS = { NORMAL: "normal", WARNING: "warning", DEGRADED: "degraded", FAULT: "fault", SAFE: "safe" };

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  byId(id).textContent = text;
}

function setEvent(sim, message, level = "INFO") {
  sim.events.push({ time: sim.time, message, level });
  if (sim.events.length > 100) sim.events.shift();
}

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value[key], object);
}

function setPath(object, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const parent = parts.reduce((result, key) => result[key], object);
  parent[last] = value;
}

function signed(value) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function fixed(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function eventTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

function setRangeProgress(element) {
  const min = Number(element.min || 0);
  const max = Number(element.max || 100);
  const value = Number(element.value);
  element.style.setProperty("--progress", `${((value - min) / (max - min)) * 100}%`);
}

function targetControls(sim) {
  const target = sim.target;
  byId("target-az").value = String(target.goalAz);
  byId("target-az-number").value = String(Math.round(target.goalAz));
  byId("target-el").value = String(target.goalEl);
  byId("target-el-number").value = String(Math.round(target.goalEl));
  byId("tracking-profile").value = target.profile;
  byId("target-speed").value = String(target.speed);
  setText("target-speed-value", Number(target.speed).toFixed(1));
  setRangeProgress(byId("target-az"));
  setRangeProgress(byId("target-el"));
  setRangeProgress(byId("target-speed"));
}

function configControls(sim) {
  document.querySelectorAll("[data-config], [data-config-percent]").forEach((input) => {
    const path = input.dataset.config ?? input.dataset.configPercent;
    const value = getPath(sim.config, path);
    input.checked = input.type === "checkbox" ? Boolean(value) : input.checked;
    if (input.type !== "checkbox") input.value = String(input.dataset.configPercent ? value * 100 : value);
  });
  byId("encoder-counts").value = String(Math.round(360 / sim.config.encoder.resolution));
  document.querySelectorAll("[data-fault]").forEach((input) => { input.checked = Boolean(sim.faults[input.dataset.fault]); });
}

function appendEventList(sim) {
  const list = byId("event-log");
  const last = sim.events.at(-1);
  const signature = `${sim.events.length}:${last?.time}:${last?.message}`;
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  list.replaceChildren();
  for (const event of [...sim.events].reverse()) {
    const item = document.createElement("li");
    item.className = event.level === "CRITICAL" ? "critical" : event.level === "WARNING" ? "warning" : "info";
    const time = document.createElement("time");
    time.textContent = eventTime(event.time);
    const level = document.createElement("b");
    level.textContent = event.level;
    const message = document.createElement("span");
    message.textContent = event.message;
    item.append(time, level, message);
    list.append(item);
  }
}

function renderAxis(name, axis) {
  const prefix = name;
  setText(`${prefix}-true`, fixed(axis.position, 1));
  setText(`${prefix}-measured`, axis.measuredValid ? fixed(axis.measured, 1) : "STALE");
  setText(`${prefix}-error`, `${signed(axis.error)}°`);
  setText(`${prefix}-velocity`, fixed(axis.velocity));
  setText(`${prefix}-acceleration`, fixed(axis.acceleration));
  setText(`${prefix}-output`, String(Math.round(axis.output * 100)));
  setText(`${prefix}-saturation`, axis.saturated ? "SAT" : "");
  const encoderStatus = byId(`encoder-status-${name}`);
  encoderStatus.textContent = axis.measuredValid ? "VALID" : "INVALID / STALE";
  encoderStatus.className = `sensor-state ${axis.measuredValid ? "valid" : "invalid"}`;
  setText(`${name}-p`, fixed(axis.p));
  setText(`${name}-i`, fixed(axis.i));
  setText(`${name}-d`, fixed(axis.d));
  setText(`${name}-sum`, fixed(axis.output));
  setText(`${name}-torque`, fixed(axis.motorTorque));
  setText(`${name}-rpm`, fixed(axis.motorSpeedRPM, 0));
}

function metric(id, value, suffix = "") {
  setText(id, value === null || value === undefined ? "—" : `${fixed(value, 2)}${suffix}`);
}

export function createDashboard(sim, charts) {
  let running = true;
  let demoIndex = -1;
  let lastEventSignature = "";

  function applyTarget(log = false) {
    setTarget(sim, {
      az: Number(byId("target-az-number").value || byId("target-az").value),
      el: Number(byId("target-el-number").value || byId("target-el").value),
      profile: byId("tracking-profile").value,
      speed: Number(byId("target-speed").value),
    });
    if (log) setEvent(sim, `Target command updated (${sim.target.profile})`, "INFO");
    targetControls(sim);
  }

  for (const axis of ["az", "el"]) {
    const range = byId(`target-${axis}`);
    const number = byId(`target-${axis}-number`);
    const sync = (value) => {
      const max = axis === "az" ? 360 : 90;
      const bounded = Math.max(0, Math.min(max, Number(value) || 0));
      range.value = String(bounded);
      number.value = String(Math.round(bounded));
      setRangeProgress(range);
      applyTarget(false);
    };
    range.addEventListener("input", () => sync(range.value));
    range.addEventListener("change", () => applyTarget(true));
    number.addEventListener("input", () => { if (number.value !== "") sync(number.value); });
    number.addEventListener("change", () => applyTarget(true));
  }
  byId("tracking-profile").addEventListener("change", () => applyTarget(true));
  byId("target-speed").addEventListener("input", () => { setText("target-speed-value", Number(byId("target-speed").value).toFixed(1)); applyTarget(false); });
  byId("target-speed").addEventListener("change", () => applyTarget(true));

  document.querySelectorAll("[data-config], [data-config-percent]").forEach((input) => {
    input.addEventListener("change", () => {
      const path = input.dataset.config ?? input.dataset.configPercent;
      let value = input.type === "checkbox" ? input.checked : Number(input.value);
      if (input.dataset.configPercent) value /= 100;
      if (input.type !== "checkbox") {
        const min = input.min === "" ? -Infinity : Number(input.min) / (input.dataset.configPercent ? 100 : 1);
        const max = input.max === "" ? Infinity : Number(input.max) / (input.dataset.configPercent ? 100 : 1);
        value = Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
        input.value = String(input.dataset.configPercent ? value * 100 : value);
      }
      setPath(sim.config, path, value);
      setEvent(sim, `Parameter changed: ${path}`, "INFO");
    });
  });
  byId("encoder-counts").addEventListener("change", (event) => {
    const counts = Math.max(64, Number(event.target.value) || 64);
    event.target.value = String(Math.round(counts));
    sim.config.encoder.resolution = 360 / counts;
    setEvent(sim, `Encoder resolution set to ${Math.round(counts)} counts/rev`, "INFO");
  });
  document.querySelectorAll("[data-fault]").forEach((input) => {
    input.addEventListener("change", () => setFault(sim, input.dataset.fault, input.checked));
  });

  function setRunning(value) {
    running = Boolean(value);
    byId("run-toggle").textContent = running ? "Pause" : "Resume";
    byId("run-toggle").setAttribute("aria-pressed", String(!running));
  }
  byId("run-toggle").addEventListener("click", () => setRunning(!running));
  byId("reset-all").addEventListener("click", () => {
    resetSimulator(sim, false);
    charts.clear();
    configControls(sim);
    targetControls(sim);
    setEvent(sim, "Simulation reset to nominal conditions", "INFO");
  });
  byId("emergency-stop").addEventListener("click", () => emergencyStop(sim));
  const rearm = () => {
    const success = rearmSimulator(sim);
    if (!success) setEvent(sim, `Re-arm denied: ${sim.safety.reason || "critical fault remains active"}`, "WARNING");
  };
  byId("rearm").addEventListener("click", rearm);
  byId("safety-rearm").addEventListener("click", rearm);
  byId("clear-faults").addEventListener("click", () => {
    clearFaults(sim);
    configControls(sim);
  });
  byId("apply-preset").addEventListener("click", () => {
    const note = applyPreset(sim, byId("preset-select").value);
    charts.clear();
    configControls(sim);
    targetControls(sim);
    setText("scenario-note", note);
    setRunning(true);
  });
  byId("reset-controller").addEventListener("click", () => {
    resetController(sim);
    setEvent(sim, "PID integrators and derivative filters reset", "INFO");
  });
  byId("reset-motor-thermal").addEventListener("click", () => {
    sim.axes.az.temperature = 0;
    sim.axes.el.temperature = 0;
    setEvent(sim, "Motor thermal proxy reset", "INFO");
  });
  byId("clear-events").addEventListener("click", () => { sim.events.length = 0; byId("event-log").dataset.signature = ""; });
  byId("clear-graphs").addEventListener("click", () => charts.clear());
  byId("reset-metrics").addEventListener("click", () => {
    resetPerformanceWindow(sim);
    setEvent(sim, "Performance measurement window reset", "INFO");
  });

  function beginDemo() {
    demoIndex = 0;
    DEMO_STEPS[demoIndex].apply(sim);
    setEvent(sim, `Demo ${demoIndex + 1}/${DEMO_STEPS.length}: ${DEMO_STEPS[demoIndex].title}`, "INFO");
    setRunning(true);
    configControls(sim);
    targetControls(sim);
  }
  byId("demo-start").addEventListener("click", beginDemo);
  byId("demo-next").addEventListener("click", () => {
    if (demoIndex < 0 || demoIndex >= DEMO_STEPS.length - 1) return;
    demoIndex += 1;
    DEMO_STEPS[demoIndex].apply(sim);
    setEvent(sim, `Demo ${demoIndex + 1}/${DEMO_STEPS.length}: ${DEMO_STEPS[demoIndex].title}`, "INFO");
    configControls(sim);
    targetControls(sim);
  });

  function renderHealth() {
    const health = sim.health;
    for (const name of ["mechanical", "motor", "encoder", "control"]) {
      const element = byId(`health-${name}`);
      element.textContent = health[name];
      element.className = `health-tag ${HEALTH_CLASS[health[name]]}`;
    }
    for (const id of ["overall-health", "health-overall-tag"]) {
      const element = byId(id);
      element.textContent = health.overall;
      element.className = `health-badge ${HEALTH_CLASS[health.overall]}`;
    }
  }

  function renderMetrics() {
    metric("metric-rise", sim.performance.riseTime, " s");
    metric("metric-overshoot", sim.performance.overshoot, "%");
    metric("metric-settling", sim.performance.settlingTime, " s");
    metric("metric-steady", sim.performance.steadyStateError, "°");
    metric("metric-rms", sim.performance.rmsError, "°");
    metric("metric-max-error", sim.performance.maxError, "°");
    metric("metric-effort", sim.performance.maxControlEffort * 100, "%");
  }

  function render(simulationTime) {
    setText("sim-time", `${simulationTime.toFixed(2)} s`);
    renderAntennaView(sim);
    renderAxis("az", sim.axes.az);
    renderAxis("el", sim.axes.el);
    renderHealth();
    const safety = sim.safety.state;
    for (const id of ["system-state-badge", "safety-state"]) {
      const element = byId(id);
      element.textContent = safety;
      element.className = `state-badge ${STATE_CLASS[safety]}`;
    }
    byId("safety-reason").textContent = sim.safety.reason || (sim.safety.latched ? "Actuator outputs are disabled; re-arm is required." : "Limits clear; watchdog heartbeat current.");
    setText("watchdog-status", sim.safety.watchdogTimedOut ? "TIMEOUT / TRIPPED" : sim.faults.watchdogStall ? "HEARTBEAT STALLED" : "HEARTBEAT OK");
    const limitHit = sim.axes.az.limitHit || sim.axes.el.limitHit;
    setText("limit-status", limitHit ? "TRAVEL STOP ACTIVE" : "CLEAR");
    byId("rearm").disabled = !sim.safety.latched;
    byId("safety-rearm").disabled = !sim.safety.latched;
    const motorState = sim.safety.latched ? "DISABLED" : sim.config.motor.degradation > 0.05 ? "DERATED" : sim.faults.motorSaturation ? "SATURATING" : "AVAILABLE";
    byId("motor-state").textContent = motorState;
    byId("motor-state").className = `sensor-state ${motorState === "DISABLED" ? "fault" : motorState === "AVAILABLE" ? "valid" : "warning"}`;
    setText("available-torque", fixed(Math.min(sim.axes.az.availableTorque, sim.axes.el.availableTorque)));
    const temperature = Math.max(sim.axes.az.temperature, sim.axes.el.temperature);
    byId("thermal-bar").style.width = `${Math.min(100, temperature * 100)}%`;
    setText("thermal-value", `${Math.round(temperature * 100)}%`);
    renderMetrics();
    appendEventList(sim);

    const stage = DEMO_STEPS[demoIndex];
    const demoTitle = stage?.title ?? "A guided control-system tour";
    setText("demo-step-index", stage ? `STEP ${demoIndex + 1} / ${DEMO_STEPS.length}` : "READY");
    setText("demo-step-title", demoTitle);
    setText("demo-step-copy", stage?.copy ?? "Run the nominal tracker, introduce gearbox wear, observe a sensor fault and safe state, then compare motor degradation.");
    byId("demo-start").textContent = demoIndex >= 0 ? "Restart demo" : "Start demo";
    const waiting = stage?.waitForSafe && sim.safety.state !== "SAFE";
    byId("demo-next").disabled = demoIndex < 0 || demoIndex >= DEMO_STEPS.length - 1 || waiting;
    byId("demo-next").textContent = demoIndex === DEMO_STEPS.length - 1 ? "Demo complete" : waiting ? "Waiting for SAFE transition…" : "Next demonstration step →";

    charts.push({
      azTarget: sim.target.az, azTrue: sim.axes.az.position, azMeasured: sim.axes.az.measuredValid ? sim.axes.az.measured : null,
      azError: sim.axes.az.error, azOutput: sim.axes.az.output,
      elTarget: sim.target.el, elTrue: sim.axes.el.position, elMeasured: sim.axes.el.measuredValid ? sim.axes.el.measured : null,
      elError: sim.axes.el.error, elOutput: sim.axes.el.output,
    });
    charts.draw();
  }

  attachViewResize();
  targetControls(sim);
  configControls(sim);
  return { render, isRunning: () => running, setRunning };
}
