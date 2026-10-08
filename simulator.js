const DEFAULT_CONFIG = {
  pid: {
    kp: 0.16,
    ki: 0.035,
    kd: 0.10,
    derivativeFilter: 0.12,
    outputLimit: 0.9,
    integralLimit: 0.4,
    antiWindup: true,
  },
  mechanics: {
    inertiaAz: 18,
    inertiaEl: 14,
    maxSpeed: 10,
    maxAcceleration: 18,
    friction: 0.08,
    azMin: 0,
    azMax: 360,
    elMin: 0,
    elMax: 90,
  },
  gearbox: { ratio: 60, efficiency: 0.82, backlash: 0.25 },
  motor: { maxTorque: 0.08, maxSpeedRPM: 120, responseTime: 0.16, degradation: 0 },
  encoder: { resolution: 0.05, noiseDeg: 0.01, offsetDeg: 0, sampleRateHz: 20 },
  environment: {
    disturbanceTorque: 0.12,
    windTorque: 0.18,
    randomDisturbance: 0.04,
  },
  communication: { delay: 0.04 },
  safety: { watchdogTimeout: 2 },
};

const FAULT_NAMES = [
  "encoderDropout",
  "motorSaturation",
  "watchdogStall",
  "excessiveBacklash",
  "increasedFriction",
];
const HEALTH_LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"];
const MAX_EVENTS = 100;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function wrapAzimuth(value) {
  return positiveModulo(value, 360);
}

function angleError(target, measured) {
  return positiveModulo(target - measured + 180, 360) - 180;
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function randomUnit(sim) {
  let value = sim._randomState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  sim._randomState = value >>> 0;
  return sim._randomState / 0x100000000;
}

function addEvent(sim, message, level = "INFO") {
  sim.events.push({ time: sim.time, message, level });
  if (sim.events.length > MAX_EVENTS) sim.events.shift();
}

function makeAxis(position, axisName, config) {
  return {
    position,
    velocity: 0,
    acceleration: 0,
    measured: position,
    measuredValid: true,
    error: 0,
    p: 0,
    i: 0,
    d: 0,
    output: 0,
    motorTorque: 0,
    availableTorque: config.motor.maxTorque,
    motorSpeedRPM: 0,
    saturated: false,
    temperature: 0,
    backlashRemaining: 0,
    limitHit: false,
    _axisName: axisName,
    _previousMeasured: position,
    _derivativeRate: 0,
    _lastDriveDirection: 0,
    _limitWarningSide: null,
    _nextEncoderSampleAt: 1 / Math.max(1, config.encoder.sampleRateHz),
    _encoderQueue: [],
    _lastEncoderSampleAt: 0,
    _dropoutDuration: 0,
  };
}

function makeSimulator(seed, config = cloneConfig(DEFAULT_CONFIG)) {
  const normalizedSeed = (Number(seed) >>> 0) || 0x6d2b79f5;
  const { azMin, azMax, elMin, elMax } = config.mechanics;
  const fullAzTurn = azMax - azMin >= 360 - 1e-6;
  const azPosition = fullAzTurn ? azMin + positiveModulo(48 - azMin, 360) : clamp(48, azMin, azMax);
  const azGoal = fullAzTurn ? azMin + positiveModulo(72 - azMin, 360) : clamp(72, azMin, azMax);
  const elPosition = clamp(31, elMin, elMax);
  const elGoal = clamp(38, 0, 90);
  const sim = {
    time: 0,
    target: { az: azGoal, el: elGoal, goalAz: azGoal, goalEl: elGoal, profile: "step", speed: 4 },
    axes: {
      az: makeAxis(azPosition, "az", config),
      el: makeAxis(elPosition, "el", config),
    },
    config,
    faults: {
      encoderDropout: false,
      motorSaturation: false,
      watchdogStall: false,
      excessiveBacklash: false,
      increasedFriction: false,
    },
    safety: { state: "NORMAL", latched: false, reason: "", watchdogTimedOut: false },
    health: {
      overall: "GREEN",
      mechanical: "GREEN",
      motor: "GREEN",
      encoder: "GREEN",
      control: "GREEN",
      rmsError: 0,
      maxError: 0,
      saturation: 0,
    },
    performance: {
      riseTime: null,
      overshoot: 0,
      settlingTime: null,
      steadyStateError: 0,
      rmsError: 0,
      maxError: 0,
      maxControlEffort: 0,
    },
    events: [],
    _seed: normalizedSeed,
    _randomState: normalizedSeed,
    _lastHeartbeat: 0,
    _targetProfileStartTime: 0,
    _response: null,
    _metrics: { errorSquares: 0, samples: 0, maxError: 0, saturatedSamples: 0 },
    _errorWindow: [],
    _healthWindow: [],
  };

  sim._response = {
    startTime: 0,
    initialAzError: angleError(azGoal, azPosition),
    initialElError: elGoal - elPosition,
    rise10At: { az: null, el: null },
    riseTimes: { az: null, el: null },
    settledSince: null,
    peakOvershoot: 0,
  };

  for (const axis of Object.values(sim.axes)) {
    axis.availableTorque = config.motor.maxTorque;
    axis._encoderQueue.push({
      sampleTime: 0,
      deliverAt: Math.max(0, config.communication.delay),
      value: axis.position,
    });
  }
  return sim;
}

export function createSimulator(seed = 12345) {
  return makeSimulator(seed);
}

function axisLimits(sim, name) {
  const mechanics = sim.config.mechanics;
  return name === "az"
    ? [mechanics.azMin, mechanics.azMax]
    : [mechanics.elMin, mechanics.elMax];
}

function boundedTarget(sim, name, value) {
  if (name === "el") return clamp(value, 0, 90);
  const [min, max] = axisLimits(sim, name);
  if (name === "az" && max - min >= 360 - 1e-6) return wrapAzimuth(value);
  return clamp(value, min, max);
}

function azimuthPathDelta(sim, start, goal) {
  const [min, max] = axisLimits(sim, "az");
  return max - min >= 360 - 1e-6 ? angleError(goal, start) : goal - start;
}

function profileOffset(sim, name, time) {
  // Profiles are centered on goal angles; speed is in degrees per second.
  const speed = Math.max(0, sim.target.speed);
  if (sim.target.profile !== "sinusoidal" || speed === 0) return 0;
  const elapsed = Math.max(0, time - sim._targetProfileStartTime);

  const [min, max] = axisLimits(sim, name);
  const center = name === "az" ? sim.target.goalAz : sim.target.goalEl;
  const requestedSpan = name === "az" ? 30 : 10;
  const span = name === "az" && max - min >= 360 - 1e-6
    ? requestedSpan
    : Math.max(0, Math.min(requestedSpan, center - min, max - center));
  if (span === 0) return 0;

  const amplitude = Math.min(name === "az" ? 20 : 10, span);
  return amplitude * Math.sin((speed / amplitude) * elapsed);
}

function updateProfileTarget(sim) {
  // Ramp uses its captured reference; a pass sweeps +/-30 degrees and returns to the horizon.
  const elapsed = Math.max(0, sim.time - sim._targetProfileStartTime);
  const speed = Math.max(0, sim.target.speed);
  if (sim.target.profile === "ramp") {
    const azTravel = Math.min(Math.abs(sim._rampDeltaAz), speed * elapsed);
    const elTravel = Math.min(Math.abs(sim._rampDeltaEl), speed * elapsed);
    sim.target.az = boundedTarget(
      sim,
      "az",
      sim._rampStartAz + Math.sign(sim._rampDeltaAz) * azTravel,
    );
    sim.target.el = boundedTarget(
      sim,
      "el",
      sim._rampStartEl + Math.sign(sim._rampDeltaEl) * elTravel,
    );
    return;
  }
  if (sim.target.profile === "pass") {
    const azSpan = Math.abs(sim._passDeltaAz);
    const elevationLeg = Math.abs(sim._passPeakEl - sim._passStartEl);
    const duration = speed > 0 ? Math.max(azSpan, 2 * elevationLeg) / speed : Infinity;
    const progress = Number.isFinite(duration) && duration > 0
      ? Math.min(1, elapsed / duration)
      : duration === 0
        ? 1
        : 0;
    const elevationProgress = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
    sim.target.az = boundedTarget(sim, "az", sim._passStartAz + sim._passDeltaAz * progress);
    sim.target.el = boundedTarget(
      sim,
      "el",
      sim._passStartEl + (sim._passPeakEl - sim._passStartEl) * elevationProgress,
    );
    return;
  }
  sim.target.az = boundedTarget(sim, "az", sim.target.goalAz + profileOffset(sim, "az", sim.time));
  sim.target.el = boundedTarget(sim, "el", sim.target.goalEl + profileOffset(sim, "el", sim.time));
}

export function setTarget(sim, targetOrAz, el, options = {}) {
  const values = typeof targetOrAz === "object" && targetOrAz !== null
    ? targetOrAz
    : { az: targetOrAz, el, ...options };
  const referenceAz = sim.target.az;
  const referenceEl = sim.target.el;
  const nextAz = values.goalAz ?? values.az;
  const nextEl = values.goalEl ?? values.el;
  if (Number.isFinite(nextAz)) sim.target.goalAz = boundedTarget(sim, "az", nextAz);
  if (Number.isFinite(nextEl)) sim.target.goalEl = boundedTarget(sim, "el", nextEl);
  if (["step", "ramp", "sinusoidal", "pass"].includes(values.profile)) {
    sim.target.profile = values.profile;
  }
  if (Number.isFinite(values.speed)) sim.target.speed = Math.max(0, values.speed);

  sim._targetProfileStartTime = sim.time;
  sim._rampStartAz = referenceAz;
  sim._rampStartEl = referenceEl;
  sim._rampDeltaAz = azimuthPathDelta(sim, referenceAz, sim.target.goalAz);
  sim._rampDeltaEl = sim.target.goalEl - referenceEl;
  const [azMin, azMax] = axisLimits(sim, "az");
  const fullAzTurn = azMax - azMin >= 360 - 1e-6;
  sim._passStartAz = boundedTarget(sim, "az", sim.target.goalAz - 30);
  const passEndAz = boundedTarget(sim, "az", sim.target.goalAz + 30);
  sim._passDeltaAz = fullAzTurn ? 60 : passEndAz - sim._passStartAz;
  sim._passStartEl = 0;
  sim._passPeakEl = sim.target.goalEl;
  updateProfileTarget(sim);
  const initialAzError = angleError(sim.target.az, sim.axes.az.position);
  const initialElError = sim.target.el - sim.axes.el.position;
  sim._response = {
    startTime: sim.time,
    initialAzError,
    initialElError,
    rise10At: { az: null, el: null },
    riseTimes: { az: null, el: null },
    settledSince: null,
    peakOvershoot: 0,
  };
  sim.performance.riseTime = null;
  sim.performance.overshoot = 0;
  sim.performance.settlingTime = null;
  return sim;
}

export function setFault(sim, faultOrMap, enabled = true) {
  const changes = typeof faultOrMap === "object" && faultOrMap !== null
    ? faultOrMap
    : { [faultOrMap]: enabled };
  for (const [name, active] of Object.entries(changes)) {
    if (!FAULT_NAMES.includes(name)) throw new RangeError(`Unknown simulator fault: ${name}`);
    const value = Boolean(active);
    if (sim.faults[name] === value) continue;
    sim.faults[name] = value;
    if (name === "encoderDropout" && !value) {
      for (const axis of Object.values(sim.axes)) axis._dropoutDuration = 0;
    }
    if (name === "watchdogStall" && !value) sim.safety.watchdogTimedOut = false;
    addEvent(sim, `${name} ${value ? "enabled" : "cleared"}`, value ? "WARNING" : "INFO");
  }
  return sim;
}

export function resetController(sim) {
  for (const axis of Object.values(sim.axes)) {
    axis.p = 0;
    axis.i = 0;
    axis.d = 0;
    axis.error = 0;
    axis.output = 0;
    axis._derivativeRate = 0;
    axis._previousMeasured = axis.measured;
    axis.saturated = false;
  }
  return sim;
}

function latchSafe(sim, reason, watchdogTimedOut = false) {
  if (sim.safety.latched) return;
  sim.safety.state = "FAULT";
  sim.safety.reason = reason;
  sim.safety.watchdogTimedOut = watchdogTimedOut;
  addEvent(sim, `FAULT: ${reason}`, "CRITICAL");
  sim.safety.latched = true;
  sim.safety.state = "SAFE";
  addEvent(sim, `SAFE: ${reason}`, "CRITICAL");
  for (const axis of Object.values(sim.axes)) axis.output = 0;
}

export function emergencyStop(sim, reason = "Emergency stop") {
  latchSafe(sim, reason);
  return sim;
}

function criticalFaultActive(sim) {
  const timeout = Math.max(0, sim.config.safety.watchdogTimeout);
  return (
    (sim.faults.encoderDropout && Object.values(sim.axes).some((axis) => axis._dropoutDuration > 0.4)) ||
    Object.values(sim.axes).some((axis) => axis.temperature >= 1) ||
    (sim.faults.watchdogStall && sim.time - sim._lastHeartbeat >= timeout) ||
    sim.safety.watchdogTimedOut
  );
}

export function rearmSimulator(sim) {
  if (criticalFaultActive(sim)) return false;
  sim.safety.latched = false;
  sim.safety.reason = "";
  sim.safety.watchdogTimedOut = false;
  sim._lastHeartbeat = sim.time;
  sim.safety.state = currentSafetyState(sim);
  addEvent(sim, "Safety system rearmed", "INFO");
  return true;
}

export function resetSimulator(sim, keepConfig = true) {
  const config = keepConfig ? cloneConfig(sim.config) : cloneConfig(DEFAULT_CONFIG);
  const reset = makeSimulator(sim._seed, config);
  for (const key of Object.keys(sim)) delete sim[key];
  Object.assign(sim, reset);
  return sim;
}

export function resetPerformanceWindow(sim) {
  sim._metrics = { errorSquares: 0, samples: 0, maxError: 0, saturatedSamples: 0 };
  sim._errorWindow.length = 0;
  sim._healthWindow.length = 0;
  sim.performance.riseTime = null;
  sim.performance.overshoot = 0;
  sim.performance.settlingTime = null;
  sim.performance.steadyStateError = 0;
  sim.performance.rmsError = 0;
  sim.performance.maxError = 0;
  sim.performance.maxControlEffort = 0;
  sim._response = null;
  return sim;
}

function updateEncoder(sim, axis, dt) {
  const config = sim.config.encoder;
  const rate = Math.max(0.1, config.sampleRateHz);
  const delay = Math.max(0, sim.config.communication.delay);

  if (sim.faults.encoderDropout) {
    axis._dropoutDuration += dt;
    axis.measuredValid = false;
    return;
  }
  axis._dropoutDuration = 0;

  while (sim.time + 1e-9 >= axis._nextEncoderSampleAt) {
    let measured = axis.position + config.offsetDeg;
    measured += (randomUnit(sim) * 2 - 1) * Math.max(0, config.noiseDeg);
    const resolution = Math.max(1e-6, config.resolution);
    measured = Math.round(measured / resolution) * resolution;
    if (axis._axisName === "az") measured = wrapAzimuth(measured);
    axis._encoderQueue.push({
      sampleTime: axis._nextEncoderSampleAt,
      deliverAt: axis._nextEncoderSampleAt + delay,
      value: measured,
    });
    axis._encoderQueue.sort((first, second) => first.deliverAt - second.deliverAt);
    axis._nextEncoderSampleAt += 1 / rate;
  }

  while (axis._encoderQueue.length && axis._encoderQueue[0].deliverAt <= sim.time + 1e-9) {
    const sample = axis._encoderQueue.shift();
    axis.measured = sample.value;
    axis._lastEncoderSampleAt = sample.sampleTime;
  }
  const staleAfter = Math.max(0.5, 3 / rate + delay);
  axis.measuredValid = sim.time - axis._lastEncoderSampleAt <= staleAfter;
}

function controllerOutput(sim, axis, name, dt) {
  const pid = sim.config.pid;
  const error = name === "az"
    ? angleError(sim.target.az, axis.measured)
    : sim.target.el - axis.measured;
  axis.error = error;
  axis.p = pid.kp * error;

  if (sim.safety.latched) {
    axis.output = 0;
    axis.saturated = false;
    return;
  }

  if (!axis.measuredValid) {
    axis.output = 0;
    axis.saturated = false;
    return;
  }

  const measuredDelta = name === "az"
    ? angleError(axis.measured, axis._previousMeasured)
    : axis.measured - axis._previousMeasured;
  const rawRate = measuredDelta / dt;
  const filterTime = Math.max(0, pid.derivativeFilter);
  const alpha = filterTime === 0 ? 1 : dt / (filterTime + dt);
  axis._derivativeRate += alpha * (rawRate - axis._derivativeRate);
  axis.d = -pid.kd * axis._derivativeRate;
  axis._previousMeasured = axis.measured;

  const limit = clamp(Math.abs(pid.outputLimit), 0, 1);
  const candidateI = clamp(axis.i + pid.ki * error * dt, -Math.abs(pid.integralLimit), Math.abs(pid.integralLimit));
  const candidateOutput = axis.p + candidateI + axis.d;
  const isDrivingFurtherIntoLimit =
    (candidateOutput > limit && error > 0) || (candidateOutput < -limit && error < 0);
  if (!(pid.antiWindup && isDrivingFurtherIntoLimit)) axis.i = candidateI;

  const rawOutput = axis.p + axis.i + axis.d;
  const limited = clamp(rawOutput, -limit, limit);
  const saturationCap = sim.faults.motorSaturation ? limit * 0.3 : limit;
  axis.output = clamp(limited, -saturationCap, saturationCap);
  axis.saturated = Math.abs(rawOutput - axis.output) > 1e-9;
}

function frictionTorque(sim, axis, torque) {
  let friction = Math.max(0, sim.config.mechanics.friction);
  if (sim.faults.increasedFriction) friction *= 5;
  if (Math.abs(axis.velocity) > 0.015) return torque - Math.sign(axis.velocity) * friction;
  if (Math.abs(torque) <= friction) return 0;
  return torque - Math.sign(torque) * friction;
}

function recordTravelLimit(sim, axis, side) {
  axis.limitHit = true;
  if (axis._limitWarningSide !== side) {
    addEvent(sim, `${axis._axisName.toUpperCase()} ${side} travel limit blocked motion`, "WARNING");
    axis._limitWarningSide = side;
  }
}

function enforceTravelLimit(sim, axis, name) {
  const [min, max] = axisLimits(sim, name);
  if (name === "az" && max - min >= 360 - 1e-6) return;

  const tolerance = 1e-6;
  const blockedSide = axis.position >= max - tolerance && axis.output > 0
    ? "maximum"
    : axis.position <= min + tolerance && axis.output < 0
      ? "minimum"
      : null;
  if (blockedSide) {
    recordTravelLimit(sim, axis, blockedSide);
    axis.output = 0;
  } else if (axis.limitHit) {
    axis.limitHit = false;
    axis._limitWarningSide = null;
  }
}

function travelPosition(sim, axis, name, nextPosition) {
  const [min, max] = axisLimits(sim, name);
  // A full-turn AZ range wraps at its seam; narrower configured ranges are hard stops.
  if (name === "az" && max - min >= 360 - 1e-6) {
    axis.position = min + positiveModulo(nextPosition - min, 360);
    return;
  }
  if (nextPosition < min) {
    axis.position = min;
    if (axis.velocity < 0) axis.velocity = 0;
    recordTravelLimit(sim, axis, "minimum");
    if (axis.output < 0) axis.output = 0;
  } else if (nextPosition > max) {
    axis.position = max;
    if (axis.velocity > 0) axis.velocity = 0;
    recordTravelLimit(sim, axis, "maximum");
    if (axis.output > 0) axis.output = 0;
  } else {
    axis.position = nextPosition;
  }
}

function stepAxis(sim, axis, name, dt) {
  controllerOutput(sim, axis, name, dt);
  enforceTravelLimit(sim, axis, name);
  const motor = sim.config.motor;
  const gearbox = sim.config.gearbox;
  const degradation = clamp(motor.degradation, 0, 0.95);
  const temperatureDerating = clamp(1 - Math.max(0, axis.temperature - 0.65) * 1.8, 0.2, 1);
  const speedRatio = Math.abs(axis.motorSpeedRPM) / Math.max(1, motor.maxSpeedRPM);
  const speedDerating = clamp(1 - Math.max(0, speedRatio - 0.75), 0.1, 1);
  axis.availableTorque = Math.max(0, motor.maxTorque * (1 - degradation) * temperatureDerating * speedDerating);

  const requestedDirection = Math.sign(axis.output);
  let backlash = Math.max(0, gearbox.backlash);
  if (sim.faults.excessiveBacklash) backlash *= 5;
  if (requestedDirection && axis._lastDriveDirection && requestedDirection !== axis._lastDriveDirection) {
    axis.backlashRemaining = backlash;
  }
  if (requestedDirection) axis._lastDriveDirection = requestedDirection;

  const responseTime = Math.max(1e-4, motor.responseTime);
  const response = 1 - Math.exp(-dt / responseTime);
  const targetTorque = axis.output * axis.availableTorque;
  axis.motorTorque += response * (targetTorque - axis.motorTorque);
  axis.motorTorque = clamp(axis.motorTorque, -axis.availableTorque, axis.availableTorque);

  const inBacklash = axis.backlashRemaining > 0;
  const targetRPM = inBacklash
    ? requestedDirection * motor.maxSpeedRPM
    : axis.velocity * gearbox.ratio / 6;
  axis.motorSpeedRPM += response * (targetRPM - axis.motorSpeedRPM);
  axis.motorSpeedRPM = clamp(axis.motorSpeedRPM, -motor.maxSpeedRPM, motor.maxSpeedRPM);
  if (inBacklash && requestedDirection && Math.sign(axis.motorSpeedRPM) === requestedDirection) {
    const gapMotion = Math.abs(axis.motorSpeedRPM) * 6 / Math.max(1, gearbox.ratio) * dt;
    axis.backlashRemaining = Math.max(0, axis.backlashRemaining - gapMotion);
  }

  let loadTorque = inBacklash ? 0 : axis.motorTorque * gearbox.ratio * clamp(gearbox.efficiency, 0, 1);
  const env = sim.config.environment;
  const phase = name === "az" ? 0.4 : 2.1;
  const disturbance =
    Math.sin(sim.time * 0.7 + phase) * env.disturbanceTorque +
    Math.cos(sim.time * 0.31 + phase) * env.windTorque +
    (randomUnit(sim) * 2 - 1) * env.randomDisturbance;
  loadTorque = frictionTorque(sim, axis, loadTorque - disturbance);

  const inertia = name === "az"
    ? Math.max(0.01, sim.config.mechanics.inertiaAz)
    : Math.max(0.01, sim.config.mechanics.inertiaEl);
  const accelerationRad = loadTorque / inertia;
  const accelerationDeg = clamp(
    accelerationRad * 180 / Math.PI,
    -Math.abs(sim.config.mechanics.maxAcceleration),
    Math.abs(sim.config.mechanics.maxAcceleration),
  );
  axis.acceleration = accelerationDeg;
  axis.velocity = clamp(
    axis.velocity + axis.acceleration * dt,
    -Math.abs(sim.config.mechanics.maxSpeed),
    Math.abs(sim.config.mechanics.maxSpeed),
  );
  travelPosition(sim, axis, name, axis.position + axis.velocity * dt);

  // Heating follows commanded load so thermal protection remains reachable while torque derates.
  const effort = Math.min(1, Math.abs(axis.output) * (1 - degradation));
  axis.temperature = clamp(axis.temperature + (0.055 * effort * effort - 0.009 * axis.temperature) * dt, 0, 1.2);
}

function healthColor(value, thresholds) {
  if (value <= thresholds[0]) return "GREEN";
  if (value <= thresholds[1]) return "YELLOW";
  if (value <= thresholds[2]) return "ORANGE";
  return "RED";
}

function worstColor(...values) {
  return values.reduce((worst, value) =>
    HEALTH_LEVELS.indexOf(value) > HEALTH_LEVELS.indexOf(worst) ? value : worst, "GREEN");
}

function updateHealth(sim, azError, elError) {
  const errorMagnitude = Math.hypot(azError, elError) / Math.SQRT2;
  const metrics = sim._metrics;
  metrics.errorSquares += errorMagnitude * errorMagnitude;
  metrics.samples += 1;
  metrics.maxError = Math.max(metrics.maxError, errorMagnitude);
  const saturationCount = Number(sim.axes.az.saturated) + Number(sim.axes.el.saturated);
  metrics.saturatedSamples += saturationCount / 2;
  sim._errorWindow.push({ time: sim.time, error: errorMagnitude });
  while (sim._errorWindow.length > 1 && sim._errorWindow[0].time < sim.time - 1) sim._errorWindow.shift();
  sim._healthWindow.push({ time: sim.time, error: errorMagnitude, saturated: saturationCount / 2 });
  while (sim._healthWindow.length > 1 && sim._healthWindow[0].time < sim.time - 5) sim._healthWindow.shift();

  const healthSamples = sim._healthWindow.length;
  let healthErrorSquares = 0;
  let healthMaxError = 0;
  let healthSaturatedSamples = 0;
  for (const sample of sim._healthWindow) {
    healthErrorSquares += sample.error * sample.error;
    healthMaxError = Math.max(healthMaxError, sample.error);
    healthSaturatedSamples += sample.saturated;
  }
  const healthRmsError = Math.sqrt(healthErrorSquares / healthSamples);
  const healthSaturation = healthSaturatedSamples / healthSamples;
  const performanceRmsError = Math.sqrt(metrics.errorSquares / metrics.samples);
  sim.health.rmsError = healthRmsError;
  sim.health.maxError = healthMaxError;
  sim.health.saturation = healthSaturation;
  sim.performance.rmsError = performanceRmsError;
  sim.performance.maxError = metrics.maxError;
  sim.performance.steadyStateError = sim._errorWindow.reduce((sum, point) => sum + point.error, 0) / sim._errorWindow.length;
  sim.performance.maxControlEffort = Math.max(
    sim.performance.maxControlEffort,
    Math.abs(sim.axes.az.output),
    Math.abs(sim.axes.el.output),
  );

  const encoderValid = sim.axes.az.measuredValid && sim.axes.el.measuredValid;
  sim.health.encoder = encoderValid
    ? "GREEN"
    : sim.axes.az._dropoutDuration > 0.4 || sim.axes.el._dropoutDuration > 0.4
      ? "RED"
      : "YELLOW";

  const backlashActive = sim.faults.excessiveBacklash ||
    sim.axes.az.backlashRemaining > 0.5 || sim.axes.el.backlashRemaining > 0.5;
  const frictionActive = sim.faults.increasedFriction;
  sim.health.mechanical = backlashActive || frictionActive ? "ORANGE" : "GREEN";

  const degradation = clamp(sim.config.motor.degradation, 0, 1);
  const temperature = Math.max(sim.axes.az.temperature, sim.axes.el.temperature);
  sim.health.motor = worstColor(
    healthColor(degradation, [0.05, 0.2, 0.45]),
    healthColor(temperature, [0.65, 0.82, 0.98]),
    sim.faults.motorSaturation ? "ORANGE" : "GREEN",
  );
  sim.health.control = worstColor(
    healthColor(healthRmsError, [0.75, 2, 5]),
    healthColor(healthSaturation, [0.05, 0.2, 0.5]),
  );
  sim.health.overall = worstColor(
    sim.health.mechanical,
    sim.health.motor,
    sim.health.encoder,
    sim.health.control,
  );
  if (sim.safety.latched || sim.safety.state === "FAULT") sim.health.overall = "RED";
}

function currentSafetyState(sim) {
  if (sim.safety.latched) return "SAFE";
  if (Object.values(sim.axes).some((axis) => axis.limitHit)) return "WARNING";
  if (sim.faults.increasedFriction || sim.faults.excessiveBacklash || sim.faults.motorSaturation) {
    return "DEGRADED";
  }
  if (!sim.axes.az.measuredValid || !sim.axes.el.measuredValid) return "WARNING";
  return "NORMAL";
}

function updateSafety(sim) {
  if (sim.safety.latched) {
    sim.safety.state = "SAFE";
    return;
  }

  const dropoutAxis = Object.values(sim.axes).find((axis) => axis._dropoutDuration > 0.4);
  const overtempAxis = Object.values(sim.axes).find((axis) => axis.temperature >= 1);
  const timedOut = sim.faults.watchdogStall &&
    sim.time - sim._lastHeartbeat >= Math.max(0, sim.config.safety.watchdogTimeout);
  if (dropoutAxis || overtempAxis || timedOut) {
    const reason = timedOut
      ? "Watchdog heartbeat timeout"
      : dropoutAxis
        ? `${dropoutAxis._axisName.toUpperCase()} encoder dropout exceeded 0.4 s`
        : `${overtempAxis._axisName.toUpperCase()} motor overtemperature`;
    latchSafe(sim, reason, Boolean(timedOut));
    return;
  }
  sim.safety.state = currentSafetyState(sim);
}

function updatePerformance(sim, azError, elError) {
  const response = sim._response;
  if (!response || sim.target.profile !== "step") return;
  const axes = [
    ["az", response.initialAzError, azError],
    ["el", response.initialElError, elError],
  ];
  for (const [name, initialError, currentError] of axes) {
    if (Math.abs(initialError) <= 0.5) continue;
    const progress = 1 - currentError / initialError;
    if (response.rise10At[name] === null && progress >= 0.1) response.rise10At[name] = sim.time;
    if (response.rise10At[name] !== null && response.riseTimes[name] === null && progress >= 0.9) {
      response.riseTimes[name] = sim.time - response.rise10At[name];
    }
    response.peakOvershoot = Math.max(response.peakOvershoot, Math.max(0, progress - 1) * 100);
  }
  const activeRiseTimes = axes.map(([name, initialError]) => Math.abs(initialError) > 0.5 ? response.riseTimes[name] : 0);
  if (activeRiseTimes.every((value) => value !== null)) sim.performance.riseTime = Math.max(...activeRiseTimes);
  sim.performance.overshoot = response.peakOvershoot;

  const azTolerance = Math.max(0.5, Math.abs(response.initialAzError) * 0.02);
  const elTolerance = Math.max(0.5, Math.abs(response.initialElError) * 0.02);
  if (Math.abs(azError) <= azTolerance && Math.abs(elError) <= elTolerance) {
    if (response.settledSince === null) response.settledSince = sim.time;
    if (sim.time - response.settledSince >= 1 && sim.performance.settlingTime === null) {
      sim.performance.settlingTime = sim.time - response.startTime;
    }
  } else {
    response.settledSince = null;
  }
}

function advanceOneStep(sim, dt) {
  sim.time += dt;
  updateProfileTarget(sim);
  for (const [name, axis] of Object.entries(sim.axes)) {
    updateEncoder(sim, axis, dt);
    stepAxis(sim, axis, name, dt);
  }

  const azError = angleError(sim.target.az, sim.axes.az.position);
  const elError = sim.target.el - sim.axes.el.position;
  if (!sim.faults.watchdogStall) sim._lastHeartbeat = sim.time;
  updateSafety(sim);
  if (sim.safety.latched) {
    for (const axis of Object.values(sim.axes)) axis.output = 0;
  }
  updateHealth(sim, azError, elError);
  updatePerformance(sim, azError, elError);
}

export function stepSimulator(sim, dt) {
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("dt must be a positive finite number");
  let remaining = dt;
  while (remaining > 1e-12) {
    const substep = Math.min(remaining, 0.02);
    advanceOneStep(sim, substep);
    remaining -= substep;
  }
  return sim;
}
