import { resetSimulator, setFault, setTarget, rearmSimulator } from "../simulation/simulator.js?v=phase14";

const PRESETS = {
  normal: {
    label: "Normal tracking",
    note: "Nominal model parameters and healthy sensors.",
    target: { az: 72, el: 38, profile: "step", speed: 4 },
  },
  "poor-pid": {
    label: "Poor PID tuning",
    note: "High proportional/integral gain, weak derivative, anti-windup off.",
    target: { az: 145, el: 58, profile: "step", speed: 4 },
    configure(sim) { Object.assign(sim.config.pid, { kp: 0.48, ki: 0.16, kd: 0.015, antiWindup: false }); },
  },
  backlash: {
    label: "Excessive backlash",
    note: "Transmission reversal clearance is increased fivefold.",
    target: { az: 20, el: 58, profile: "step", speed: 4 },
    configure(sim) { sim.config.gearbox.backlash = 1.4; setFault(sim, "excessiveBacklash", true); },
  },
  encoder: {
    label: "Encoder failure",
    note: "Feedback freezes invalid; the safety manager will latch SAFE.",
    target: { az: 145, el: 58, profile: "step", speed: 4 },
    configure(sim) { setFault(sim, "encoderDropout", true); },
  },
  motor: {
    label: "Motor degradation",
    note: "Available motor torque is reduced by 55 percent.",
    target: { az: 210, el: 68, profile: "step", speed: 4 },
    configure(sim) { sim.config.motor.degradation = 0.55; },
  },
  wind: {
    label: "Wind disturbance",
    note: "Oscillating wind torque is increased to challenge rejection.",
    target: { az: 135, el: 48, profile: "step", speed: 4 },
    configure(sim) { sim.config.environment.windTorque = 2.2; },
  },
  delay: {
    label: "Communication delay",
    note: "Feedback is delayed by 0.8 seconds in the closed loop.",
    target: { az: 160, el: 52, profile: "step", speed: 4 },
    configure(sim) { sim.config.communication.delay = 0.8; },
  },
  multi: {
    label: "Multi-fault",
    note: "Moderate bias, noise, backlash, motor loss, wind, and delay combine.",
    target: { az: 200, el: 62, profile: "step", speed: 4 },
    configure(sim) {
      sim.config.encoder.noiseDeg = 0.18;
      sim.config.encoder.offsetDeg = 0.35;
      sim.config.gearbox.backlash = 0.8;
      sim.config.motor.degradation = 0.35;
      sim.config.environment.windTorque = 1.1;
      sim.config.communication.delay = 0.25;
      setFault(sim, "excessiveBacklash", true);
    },
  },
};

export function applyPreset(sim, name) {
  const preset = PRESETS[name] ?? PRESETS.normal;
  resetSimulator(sim, false);
  preset.configure?.(sim);
  setTarget(sim, preset.target);
  sim.events.push({ time: sim.time, message: `Scenario loaded: ${preset.label}`, level: "INFO" });
  return preset.note;
}

export function clearFaults(sim) {
  setFault(sim, {
    encoderDropout: false,
    motorSaturation: false,
    watchdogStall: false,
    excessiveBacklash: false,
    increasedFriction: false,
  });
  sim.config.motor.degradation = 0;
  sim.config.gearbox.backlash = 0.25;
  sim.config.mechanics.friction = 0.08;
  sim.config.encoder.noiseDeg = 0.01;
  sim.config.encoder.offsetDeg = 0;
  sim.config.communication.delay = 0.04;
  sim.config.environment.disturbanceTorque = 0.12;
  sim.config.environment.windTorque = 0.18;
  sim.config.environment.randomDisturbance = 0.04;
  sim.events.push({ time: sim.time, message: "Injected faults cleared; reset or re-arm if SAFE", level: "INFO" });
}

export const DEMO_STEPS = [
  {
    title: "Healthy closed-loop tracking",
    copy: "Watch the true AZ/EL plant positions move toward their references. Compare command, measured feedback, and PID output.",
    apply(sim) { resetSimulator(sim, false); setTarget(sim, { az: 115, el: 52, profile: "step", speed: 5 }); },
  },
  {
    title: "Command a satellite-like pass",
    copy: "Switch to a time-varying target and observe how the tracking error responds to a moving reference.",
    apply(sim) { setTarget(sim, { az: 180, el: 55, profile: "pass", speed: 7 }); },
  },
  {
    title: "Add gearbox degradation",
    copy: "Backlash increases the reversal deadband. The controller changes direction, but load motion pauses while clearance is taken up.",
    apply(sim) { sim.config.gearbox.backlash = 1.2; setFault(sim, "excessiveBacklash", true); setTarget(sim, { az: 30, el: 55, profile: "step", speed: 5 }); },
  },
  {
    title: "Fail encoder feedback",
    copy: "Feedback becomes stale and invalid. Wait for the detection threshold; the safety manager should disable actuator output and latch SAFE.",
    apply(sim) { setFault(sim, "encoderDropout", true); },
    waitForSafe: true,
  },
  {
    title: "Recover and reset the controller",
    copy: "Clear the encoder fault, explicitly re-arm the safety latch, reset the controller state, and resume nominal tracking.",
    apply(sim) {
      setFault(sim, "encoderDropout", false);
      if (sim.safety.latched) rearmSimulator(sim);
      sim.axes.az.temperature = 0;
      sim.axes.el.temperature = 0;
      sim.axes.az.i = 0;
      sim.axes.el.i = 0;
      setTarget(sim, { az: 90, el: 45, profile: "step", speed: 5 });
    },
  },
  {
    title: "Compare degraded motor performance",
    copy: "Reduce available torque by 45 percent. Observe the longer tracking response, saturation/health indicators, and measured performance metrics.",
    apply(sim) { sim.config.motor.degradation = 0.45; setTarget(sim, { az: 190, el: 66, profile: "step", speed: 5 }); },
  },
  {
    title: "Review metrics and event history",
    copy: "Review rise and settling time, RMS and peak error, maximum control effort, and the sequence of detected events.",
    apply(sim) { sim.events.push({ time: sim.time, message: "Demo complete: review response metrics and event history", level: "INFO" }); },
  },
];
