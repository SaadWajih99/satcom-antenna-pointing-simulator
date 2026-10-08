# Testing Guide

The automated tests exercise the deterministic simulation module directly. Browser rendering and layout still require a manual smoke check; there is no browser automation dependency or build step.

## Requirements

- Node.js 18 or newer for the built-in Node test runner.
- A modern browser and Python 3 only if you want to run the dashboard locally.
- No package installation is required; the project has no runtime or development dependencies.

## Automated Tests

From the repository root, run:

```bash
npm test
```

The equivalent command, which does not require npm, is:

```bash
node --test tests/simulator.test.js
```

The suite uses Node's built-in `node:test` and strict assertions. Its 16 cases cover target tracking and profiles, startup state, response/health metrics, output saturation and anti-windup, encoder offset/noise/dropout, backlash, motor degradation, travel stops and recovery, watchdog and thermal safety trips, emergency stop/re-arm gating, seeded repeatability, and reset behavior. The `quiet()` helper disables disturbances when a test needs a controlled baseline; fault and repeatability tests deliberately retain the relevant signals.

## Manual Browser Smoke Check

Serve the repository root locally:

```bash
python -m http.server 8000
```

Open <http://localhost:8000> and check the following:

1. The dashboard loads with no JavaScript errors. Simulation time advances; AZ/EL true position begins moving toward its target, and the antenna view and plots update.
2. Change the target and switch between Step, Ramp, Sinusoidal, and Satellite pass. The command controls stay synchronized and the target remains distinct from the true antenna position.
3. Pause and resume the simulation. Press **Emergency stop** and confirm the system reports `SAFE` and actuator output is zero. With no active critical fault, **Re-arm** should clear the latch.
4. Load the **Encoder failure** scenario. After the invalid-feedback threshold, the encoder should show stale/invalid and the safety manager should latch `SAFE`. Clear injected faults, allow valid feedback to return, and re-arm.
5. Load other presets or change a model parameter; confirm the event log and subsystem-health indicators respond. **Reset simulation** should restore nominal conditions and clear graph history.
6. Check a narrow phone-sized viewport (about 390 px wide): panels should stack, controls remain usable, and the document should not scroll horizontally.

These checks verify the demonstration interface and software model only. Neither automated tests nor browser checks establish suitability for controlling real equipment.
