import test from "node:test";
import assert from "node:assert/strict";
import {
  createSimulator,
  emergencyStop,
  rearmSimulator,
  resetPerformanceWindow,
  resetSimulator,
  setFault,
  setTarget,
  stepSimulator,
} from "../src/simulation/simulator.js";

function runFor(sim, duration, dt = 0.02) {
  const steps = Math.ceil(duration / dt);
  for (let index = 0; index < steps; index += 1) {
    stepSimulator(sim, Math.min(dt, duration - index * dt));
  }
}

function quiet(sim) {
  sim.config.environment.disturbanceTorque = 0;
  sim.config.environment.windTorque = 0;
  sim.config.environment.randomDisturbance = 0;
  sim.config.encoder.noiseDeg = 0;
  sim.config.encoder.resolution = 0.001;
  sim.config.encoder.sampleRateHz = 100;
  sim.config.communication.delay = 0;
  return sim;
}

test("nominal tracking moves toward a target without teleporting", () => {
  const sim = quiet(createSimulator());
  setTarget(sim, { az: 60, el: 38 });
  const startingPosition = sim.axes.az.position;
  stepSimulator(sim, 0.02);

  assert.ok(sim.axes.az.position > startingPosition);
  assert.ok(sim.axes.az.position < sim.target.az);
  assert.notEqual(sim.axes.az.position, sim.target.az);

  runFor(sim, 5);
  assert.ok(Math.abs(sim.target.az - sim.axes.az.position) < 12);
  assert.ok(sim.axes.az.motorTorque > 0);
});

test("default state preserves the Phase 1 antenna view and starts tracking", () => {
  const sim = createSimulator();
  assert.equal(sim.axes.az.position, 48);
  assert.equal(sim.axes.el.position, 31);
  assert.equal(sim.target.az, 72);
  assert.equal(sim.target.el, 38);
  assert.equal(sim.target.goalAz, 72);
  assert.equal(sim.target.goalEl, 38);

  stepSimulator(sim, 0.02);
  assert.notEqual(sim.axes.az.position, sim.target.az);
  assert.ok(sim.axes.az.position > 48);
});

test("default step response reports performance and health recovers after startup", () => {
  const sim = quiet(createSimulator());
  runFor(sim, 25);

  assert.ok(Number.isFinite(sim.performance.riseTime));
  assert.ok(Number.isFinite(sim.performance.settlingTime));
  assert.ok(sim.performance.rmsError > sim.health.rmsError);
  assert.equal(sim.health.overall, "GREEN");

  resetPerformanceWindow(sim);
  assert.equal(sim.performance.rmsError, 0);
  assert.equal(sim.performance.maxError, 0);
  assert.equal(sim._metrics.samples, 0);
});

test("ramp moves from the active reference at a bounded rate, then holds the goal", () => {
  const sim = quiet(createSimulator());
  setTarget(sim, { az: 82, el: 42, profile: "ramp", speed: 10 });
  assert.equal(sim.target.az, 72);
  assert.equal(sim.target.el, 38);
  stepSimulator(sim, 0.02);
  assert.ok(Math.abs(sim.target.az - 72.2) < 1e-9);
  assert.ok(Math.abs(sim.target.el - 38.2) < 1e-9);
  runFor(sim, 1.1);
  assert.equal(sim.target.az, 82);
  assert.equal(sim.target.el, 42);
  runFor(sim, 0.2);
  assert.equal(sim.target.az, 82);
  assert.equal(sim.target.el, 42);

  setTarget(sim, { az: 180, el: 45, profile: "sinusoidal", speed: 10 });
  assert.equal(sim.target.az, 180);
  assert.equal(sim.target.el, 45);
  stepSimulator(sim, 0.02);
  assert.ok(sim.target.az > 180);
  assert.ok(sim.target.el > 45);

  setTarget(sim, { az: 180, el: 60, profile: "pass", speed: 60 });
  assert.equal(sim.target.az, 150);
  assert.equal(sim.target.el, 0);
  runFor(sim, 1);
  assert.equal(sim.target.az, 180);
  assert.ok(sim.target.el > 59.8);
  runFor(sim, 1.2);
  assert.equal(sim.target.az, 210);
  assert.equal(sim.target.el, 0);
  runFor(sim, 0.3);
  assert.equal(sim.target.az, 210);
  assert.equal(sim.target.el, 0);
});

test("PID output and motor torque stay within saturation limits", () => {
  const sim = quiet(createSimulator());
  setTarget(sim, { az: 180, el: 45 });
  setFault(sim, "motorSaturation", true);
  stepSimulator(sim, 0.02);

  assert.ok(Math.abs(sim.axes.az.output) <= sim.config.pid.outputLimit * 0.3 + 1e-9);
  assert.ok(sim.axes.az.saturated);
  assert.ok(Math.abs(sim.axes.az.motorTorque) <= sim.axes.az.availableTorque + 1e-9);
});

test("conditional anti-windup prevents integral growth against a hard limit", () => {
  const limited = quiet(createSimulator(7));
  limited.config.mechanics.maxSpeed = 0.01;
  limited.config.mechanics.maxAcceleration = 0.01;
  limited.config.pid.ki = 0.5;
  limited.config.pid.integralLimit = 0.5;
  setTarget(limited, { az: 90, el: 45 });
  runFor(limited, 2);

  const unbounded = quiet(createSimulator(7));
  unbounded.config.mechanics.maxSpeed = 0.01;
  unbounded.config.mechanics.maxAcceleration = 0.01;
  unbounded.config.pid.ki = 0.5;
  unbounded.config.pid.integralLimit = 0.5;
  unbounded.config.pid.antiWindup = false;
  setTarget(unbounded, { az: 90, el: 45 });
  runFor(unbounded, 2);

  assert.equal(limited.axes.az.i, 0);
  assert.ok(unbounded.axes.az.i > 0.1);
  assert.ok(Math.abs(limited.axes.az.output) <= limited.config.pid.outputLimit);
});

test("encoder offset, seeded noise, and dropout are reflected in feedback validity", () => {
  const first = quiet(createSimulator(91));
  const second = quiet(createSimulator(91));
  for (const sim of [first, second]) {
    sim.config.encoder.offsetDeg = 1.23;
    sim.config.encoder.noiseDeg = 0.15;
    sim.config.pid.kp = 0;
    sim.config.pid.ki = 0;
    sim.config.pid.kd = 0;
    setTarget(sim, { az: 0, el: 45 });
    runFor(sim, 0.08);
  }

  assert.equal(first.axes.az.measured, second.axes.az.measured);
  assert.ok(Math.abs(first.axes.az.measured - first.axes.az.position - 1.23) < 0.2);
  const staleValue = first.axes.az.measured;
  setFault(first, "encoderDropout", true);
  stepSimulator(first, 0.1);
  assert.equal(first.axes.az.measuredValid, false);
  assert.equal(first.axes.az.measured, staleValue);

  runFor(first, 0.5);
  assert.equal(first.safety.state, "SAFE");
  assert.equal(first.axes.az.output, 0);
  assert.ok(first.events.some((event) => event.message.includes("encoder dropout")));
});

test("gearbox backlash delays motion after a direction reversal", () => {
  const sim = quiet(createSimulator());
  sim.config.gearbox.backlash = 2;
  setTarget(sim, { az: 80, el: 38 });
  runFor(sim, 1.5);
  assert.ok(sim.axes.az.velocity > 0);

  setTarget(sim, { az: 40, el: 38 });
  const positionAtReversal = sim.axes.az.position;
  runFor(sim, 0.02);

  assert.ok(sim.axes.az.backlashRemaining > 0);
  assert.ok(sim.axes.az.position >= positionAtReversal);
});

test("motor degradation reduces available torque", () => {
  const healthy = quiet(createSimulator());
  const degraded = quiet(createSimulator());
  degraded.config.motor.degradation = 0.6;
  setTarget(healthy, { az: 40, el: 45 });
  setTarget(degraded, { az: 40, el: 45 });
  stepSimulator(healthy, 0.02);
  stepSimulator(degraded, 0.02);

  assert.ok(degraded.axes.az.availableTorque < healthy.axes.az.availableTorque);
  assert.ok(Math.abs(degraded.axes.az.availableTorque - healthy.axes.az.availableTorque * 0.4) < 1e-9);
});

test("configured mechanical travel limits are hard stops", () => {
  const sim = quiet(createSimulator());
  sim.config.mechanics.azMin = 10;
  sim.config.mechanics.azMax = 20;
  sim.axes.az.position = 19.8;
  sim.axes.az.measured = 19.8;
  sim.axes.az._previousMeasured = 19.8;
  setTarget(sim, { az: 50, el: 45 });
  runFor(sim, 3);

  assert.ok(sim.axes.az.position <= 20);
  assert.equal(sim.axes.az.position, 20);
  assert.equal(sim.axes.az.velocity, 0);
});

test("elevation stop is visible, blocks outward command, then permits recovery", () => {
  const sim = quiet(createSimulator());
  sim.config.mechanics.elMax = 50;
  setTarget(sim, { el: 70 });
  runFor(sim, 5);

  assert.equal(sim.target.el, 70);
  assert.equal(sim.axes.el.position, 50);
  assert.equal(sim.axes.el.limitHit, true);
  assert.equal(sim.axes.el.output, 0);
  assert.equal(sim.safety.state, "WARNING");
  assert.equal(sim.events.filter((event) => event.message.includes("EL maximum travel limit")).length, 1);

  runFor(sim, 0.2);
  assert.equal(sim.axes.el.output, 0);
  assert.equal(sim.events.filter((event) => event.message.includes("EL maximum travel limit")).length, 1);

  setTarget(sim, { el: 40 });
  stepSimulator(sim, 0.02);
  assert.equal(sim.axes.el.limitHit, false);
  assert.ok(sim.axes.el.output < 0);
  runFor(sim, 0.5);
  assert.ok(sim.axes.el.position < 50);
  assert.equal(sim.safety.state, "NORMAL");
});

test("watchdog timeout commands zero and latches SAFE", () => {
  const sim = quiet(createSimulator());
  sim.config.safety.watchdogTimeout = 0.12;
  setTarget(sim, { az: 90, el: 45 });
  setFault(sim, "watchdogStall", true);
  runFor(sim, 0.2);

  assert.equal(sim.safety.state, "SAFE");
  assert.equal(sim.safety.latched, true);
  assert.equal(sim.safety.watchdogTimedOut, true);
  assert.equal(sim.axes.az.output, 0);
  runFor(sim, 0.1);
  assert.equal(sim.axes.az.output, 0);
  assert.equal(sim.health.overall, "RED");
  assert.equal(rearmSimulator(sim), false);
  setFault(sim, "watchdogStall", false);
  assert.equal(rearmSimulator(sim), true);
});

test("motor overtemperature reaches FAULT then SAFE with zero output", () => {
  const sim = quiet(createSimulator());
  sim.config.mechanics.maxSpeed = 0;
  setTarget(sim, { az: 90, el: 45 });
  while (sim.time < 30 && sim.safety.state !== "SAFE") stepSimulator(sim, 0.02);

  assert.equal(sim.safety.state, "SAFE");
  assert.ok(sim.axes.az.temperature >= 1);
  assert.equal(sim.axes.az.output, 0);
  assert.ok(sim.events.some((event) => event.message.startsWith("FAULT:")));
  assert.ok(sim.events.some((event) => event.message.startsWith("SAFE:")));
});

test("emergency stop latches until rearmed and critical faults block rearm", () => {
  const sim = quiet(createSimulator());
  emergencyStop(sim);
  assert.equal(sim.safety.state, "SAFE");
  assert.equal(sim.axes.az.output, 0);
  assert.equal(rearmSimulator(sim), true);
  assert.equal(sim.safety.latched, false);

  setFault(sim, "encoderDropout", true);
  runFor(sim, 0.5);
  assert.equal(rearmSimulator(sim), false);
  setFault(sim, "encoderDropout", false);
  assert.equal(rearmSimulator(sim), true);
});

test("seeded simulations reproduce motion and encoder noise", () => {
  const first = createSimulator(2026);
  const second = createSimulator(2026);
  setTarget(first, { az: 25, el: 50 });
  setTarget(second, { az: 25, el: 50 });
  runFor(first, 2);
  runFor(second, 2);

  assert.equal(first.time, second.time);
  assert.deepEqual(first.target, second.target);
  assert.deepEqual(first.axes, second.axes);
  assert.deepEqual(first.events, second.events);
});

test("reset restores deterministic initial state and optionally preserves config", () => {
  const sim = createSimulator(42);
  sim.config.motor.maxTorque = 4;
  setFault(sim, "increasedFriction", true);
  runFor(sim, 1);
  resetSimulator(sim);

  assert.equal(sim.time, 0);
  assert.equal(sim.config.motor.maxTorque, 4);
  assert.equal(sim.faults.increasedFriction, false);
  assert.equal(sim.axes.az.position, 48);

  resetSimulator(sim, false);
  assert.equal(sim.config.motor.maxTorque, 0.08);
});
