# SATCOM Antenna Pointing Test Bench

A browser-native, fixed-step simulator for exploring a simplified two-axis satellite-communications ground antenna. It couples AZ/EL plant dynamics, PID control, motor and gearbox behavior, encoder feedback, disturbances, fault injection, health monitoring, safety interlocks, and response metrics in one interactive dashboard.

> For engineering education, control-system experimentation, and portfolio demonstration only. This simplified model is not a certified SATCOM control system and must not be used to control real equipment.

**Live demo:** <https://saadwajih99.github.io/satcom-antenna-pointing-simulator/>  
**Source:** <https://github.com/SaadWajih99/satcom-antenna-pointing-simulator>

## Run and Test

No install, build, external library, backend, or API key is required. Serve the project directory with any static web server; for example:

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. A local server is needed for browser ES modules; opening `index.html` directly as a `file://` URL is unsupported.

Run the deterministic simulator tests with Node.js:

```bash
node --test tests/simulator.test.js
```

The tests cover nominal tracking, target profiles, PID saturation and anti-windup, encoder error and dropout, backlash, torque degradation, hard travel limits, watchdog behavior, thermal shutdown, emergency stop/re-arm, seeded repeatability, and reset behavior.

## Operator Guide

- Set target azimuth and elevation with sliders or numeric inputs. The dashed amber vectors show the reference; solid cyan vectors show simulated true plant position.
- Choose a step, ramp, sinusoidal, or satellite-pass reference and adjust its speed.
- Pause/resume the fixed-step simulation, reset it, or latch an emergency stop. Re-arm is enabled only after a stop; critical faults must first be removed.
- Load normal tracking, poor PID tuning, excessive backlash, encoder failure, motor degradation, wind, communication delay, or multi-fault presets.
- Expand model-configuration sections to tune gains, mechanics, actuator limits, encoder behavior, delay, and disturbances, or enable individual fault injections.
- Compare AZ/EL position, measured feedback, tracking error, PID output, health, safety state, event history, and performance metrics. Clear chart history or reset the performance window independently.
- Start the guided demonstration to see nominal tracking, a moving pass, backlash, encoder-triggered SAFE state, recovery, motor degradation, and final metric review.

## Model at a Glance

The simulation advances in deterministic `0.02 s` steps. Browser rendering uses `requestAnimationFrame` independently of the model clock, so motion and telemetry do not depend on display refresh rate. A seeded pseudo-random generator makes disturbance and encoder-noise sequences repeatable. See [Model Reference](docs/model-reference.md) for the equations, default parameters, thresholds, metrics, and limitations.

The modules are intentionally small and dependency-free:

```text
index.html                 Dashboard structure and SVG antenna view
src/main.js                Fixed-step scheduler and render loop
src/simulation/simulator.js Plant, control, feedback, faults, health, safety, metrics
src/ui/antennaView.js      Responsive AZ compass and EL side view
src/ui/charts.js           Bounded live telemetry history and Canvas plots
src/ui/dashboard.js        Controls, telemetry, health, events, and metrics
src/ui/scenarios.js        Fault presets and guided demonstration
src/styles.css             Responsive dashboard styling
tests/simulator.test.js    Deterministic Node.js verification
docs/model-reference.md   Model, thresholds, and engineering caveats
```

## Phase Status

1. Project structure and antenna visualization — complete
2. Physical plant model — complete
3. PID controller — complete
4. Encoder model — complete
5. Motor, gearbox, and backlash — complete
6. Two-axis AZ/EL operation — complete
7. Real-time telemetry graphs — complete
8. Fault injection — complete
9. Subsystem health monitoring — complete
10. Safety manager and watchdog — complete
11. Performance analysis — complete
12. Dashboard controls and scenarios — complete
13. Automated testing and responsive browser validation — complete
14. Engineering documentation and GitHub Pages deployment — complete

## Deploy to GitHub Pages

The site is a static root-directory deployment with relative paths. In repository **Settings → Pages**, select **Deploy from a branch**, then choose `main` and `/ (root)`. After the Pages action completes, open the URL displayed in those settings. No build step is required.

## Assumptions and Limitations

- Azimuth is a clockwise compass bearing from north; a full-turn AZ range wraps through `360°`. A configured partial AZ range instead uses hard stops.
- Elevation uses a `0–90°` horizon-to-zenith convention. No below-horizon pose is modeled.
- Motor torque, inertia, friction, wind, temperature, backlash, encoder error, and communication delay are illustrative lumped parameters, not measurements of a particular antenna.
- The satellite-pass profile is a synthetic moving reference; there is no orbital propagation, ephemeris, RF link budget, polarization, acquisition, or pointing-loss calculation.
- Health thresholds and the thermal proxy are demonstration criteria, not hardware alarm limits or a safety certification.
- This application runs entirely in the browser. It sends no telemetry to a server and does not persist simulation state after the page is closed.

## License

MIT. See [LICENSE](LICENSE).
