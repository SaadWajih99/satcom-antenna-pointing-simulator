const MAX_POINTS = 600;
const AXES = [
  { key: "az", label: "AZ", color: "#58d7d2", range: [0, 360] },
  { key: "el", label: "EL", color: "#e6ad5c", range: [0, 90] },
];
const CHARTS = [
  { id: "chart-position", fields: ["target", "true"] },
  { id: "chart-error", fields: ["error"] },
  { id: "chart-control", fields: ["output"] },
  { id: "chart-encoder", fields: ["true", "measured"] },
];

function boundsFor(chart, axis, samples) {
  if (chart.id === "chart-position" || chart.id === "chart-encoder") return axis.range;
  if (chart.id === "chart-control") return [-1, 1];
  const maximum = Math.max(2, ...samples.map((sample) => Math.abs(sample[`${axis.key}Error`] ?? 0)));
  return [-maximum, maximum];
}

function drawChart(canvas, chart, samples) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const left = 27;
  const right = rect.width - 7;
  const top = 6;
  const bottom = rect.height - 6;
  const bandHeight = (bottom - top) / 2;
  const visible = samples.slice(-MAX_POINTS);

  for (let axisIndex = 0; axisIndex < AXES.length; axisIndex += 1) {
    const axis = AXES[axisIndex];
    const yTop = top + axisIndex * bandHeight;
    const yBottom = yTop + bandHeight - 3;
    const [minimum, maximum] = boundsFor(chart, axis, visible);
    const span = Math.max(1e-6, maximum - minimum);
    context.strokeStyle = "#30414b";
    context.lineWidth = 1;
    for (let line = 0; line < 3; line += 1) {
      const y = yTop + ((yBottom - yTop) * line) / 2;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
    }
    context.fillStyle = axis.color;
    context.font = "700 8px sans-serif";
    context.fillText(axis.label, 3, yTop + 10);

    for (const field of chart.fields) {
      context.beginPath();
      context.strokeStyle = axis.color;
      context.globalAlpha = field === "measured" ? 0.55 : field === "target" ? 0.82 : 0.95;
      context.lineWidth = field === "true" || field === "output" || field === "error" ? 1.6 : 1.2;
      context.setLineDash(field === "target" ? [4, 3] : field === "measured" ? [2, 3] : []);
      let drawing = false;
      for (let index = 0; index < visible.length; index += 1) {
        const sample = visible[index];
        const value = sample[`${axis.key}${field[0].toUpperCase()}${field.slice(1)}`];
        if (!Number.isFinite(value)) {
          drawing = false;
          continue;
        }
        const x = left + (right - left) * (visible.length <= 1 ? 1 : index / (visible.length - 1));
        const y = yBottom - ((value - minimum) / span) * (yBottom - yTop);
        if (drawing) context.lineTo(x, y);
        else { context.moveTo(x, y); drawing = true; }
      }
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  context.setLineDash([]);
}

export function createTelemetryCharts() {
  const history = [];
  return {
    push(sample) {
      history.push(sample);
      if (history.length > MAX_POINTS) history.shift();
    },
    draw() {
      for (const chart of CHARTS) drawChart(document.getElementById(chart.id), chart, history);
    },
    clear() {
      history.length = 0;
      this.draw();
    },
    get length() { return history.length; },
  };
}
