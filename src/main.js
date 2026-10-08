import { createSimulator, stepSimulator } from "./simulation/simulator.js?v=phase14-1";
import { createTelemetryCharts } from "./ui/charts.js?v=phase14-1";
import { createDashboard } from "./ui/dashboard.js?v=phase14-1";

const FIXED_STEP = 0.02;
const MAX_STEPS_PER_FRAME = 5;
const simulator = createSimulator();
const charts = createTelemetryCharts();
const dashboard = createDashboard(simulator, charts);

let accumulator = 0;
let previousFrame = 0;
let lastRender = 0;

function frame(timestamp) {
  if (!previousFrame) previousFrame = timestamp;
  const elapsed = Math.min(0.1, Math.max(0, (timestamp - previousFrame) / 1000));
  previousFrame = timestamp;

  if (dashboard.isRunning()) {
    accumulator += elapsed;
    let updates = 0;
    while (accumulator >= FIXED_STEP && updates < MAX_STEPS_PER_FRAME) {
      stepSimulator(simulator, FIXED_STEP);
      accumulator -= FIXED_STEP;
      updates += 1;
    }
    if (updates === MAX_STEPS_PER_FRAME && accumulator >= FIXED_STEP) accumulator = 0;
  }

  if (timestamp - lastRender >= 100) {
    dashboard.render(simulator.time);
    lastRender = timestamp;
  }
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  previousFrame = 0;
  accumulator = 0;
});

dashboard.render(simulator.time);
requestAnimationFrame(frame);
