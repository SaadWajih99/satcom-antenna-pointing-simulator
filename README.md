# SATCOM Antenna Pointing Test Bench

A browser-native, GitHub Pages-ready portfolio simulator for exploring a simplified two-axis SATCOM ground antenna. Development is being delivered in controlled phases rather than as one unverified implementation.

> This is a simplified electromechanical simulation intended for engineering education, control-system experimentation and portfolio demonstration. It is not a certified SATCOM control system.

## Current Phase: 1 of 14

Phase 1 establishes the static-site project structure and interactive antenna visualization. The operator can independently set a target direction and the displayed antenna pose. A side elevation view and a north-referenced azimuth compass show both values and their angular differences.

This phase is intentionally **not a physical simulation**: the displayed antenna pose is manually adjustable and does not track the target. There is no controller, actuator, mechanical plant, encoder feedback, fault monitor, or safety state machine yet.

## Run Locally

No install or build step is required. From the project folder, start any static web server, for example:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Modern browsers require a local server for JavaScript modules; opening `index.html` directly as a `file://` URL is not the supported run method.

## Deploy to GitHub Pages

1. Push the contents of this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)`, then save.
5. Open the Pages URL shown in that settings panel after deployment completes.

The site uses relative asset paths and has no backend, package manager, build tool, external library, or API dependency.

## Phase 1 Project Structure

```text
satcom-antenna-simulator/
├── index.html
├── README.md
├── LICENSE
├── .gitignore
├── docs/
│   └── phase1.md
└── src/
    ├── main.js
    ├── styles.css
    └── ui/
        └── antennaView.js
```

The project uses native HTML, CSS, JavaScript ES modules, and inline SVG. This keeps the Phase 1 deploy path transparent and avoids framework/build overhead. Later engineering subsystems should be added as separate modules as their phases are implemented and tested.

## Phase Roadmap

1. Project structure and antenna visualization **(implemented)**
2. Single-axis physical simulation
3. PID controller
4. Encoder model
5. Motor, gearbox, and backlash
6. Two-axis AZ/EL operation
7. Real-time graphs
8. Fault injection
9. Health monitoring
10. Safety manager and watchdog
11. Performance analysis
12. Professional dashboard controls
13. Testing and validation
14. Engineering documentation and GitHub Pages deployment

## Phase 1 Manual Check

- Move target AZ and EL sliders; dashed compass and elevation vectors should move and readouts should update.
- Move antenna AZ and EL sliders; the solid vectors and dish orientation should move independently from the target.
- Enter values in the numeric fields; values should stay within AZ `0–360°` and EL `0–90°`.
- Compare the AZ readout near north (for example target `2°`, antenna `358°`); the visual delta should be the shortest signed angular difference (`+4°`).
- Use **Reset view**; all four angles should return to their initial display values.
- Narrow the browser to phone width; controls and readouts should stack without horizontal page scrolling.

## Assumptions and Limitations

- Azimuth is displayed as a compass bearing measured clockwise from north, with `000°` and `360°` representing the same direction.
- Elevation is bounded from the horizon (`0°`) to zenith (`90°`). No below-horizon position is represented.
- The drawing is schematic and not to scale; its elevation side view and plan-view compass are two complementary projections of the same two-axis antenna.
- The displayed pose is an operator-set visualization value, not an encoder reading or simulated physical position.
- No mechanical, electrical, RF, orbital, environmental, controller, or safety performance is implied by this visualization.

## Screenshots

Screenshots will be added after the interactive simulation phases stabilize.
