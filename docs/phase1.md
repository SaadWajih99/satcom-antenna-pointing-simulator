# Phase 1: Antenna Visualization

## Scope

Establish the static web application shell and a legible AZ/EL antenna pointing view. No physical dynamics or control behavior is in scope in this phase.

## Visual data model

- Target AZ and EL are operator-entered reference angles.
- Antenna AZ and EL are independently operator-entered schematic pose angles.
- AZ compass vectors use a north-clockwise bearing convention.
- Elevation is drawn in a side view from the horizon toward zenith.
- AZ error is the shortest signed wrapped difference: `((target - antenna + 540) mod 360) - 180`.
- EL error is the direct difference: `target - antenna`.

These differences describe geometry only. They are not control errors from sensor feedback.

## Verification checklist

- [x] Sliders and numeric fields are bounded and synchronized.
- [x] Target and displayed pose are independent.
- [x] AZ wraps through north for the displayed shortest signed difference.
- [x] Elevation dish orientation changes with the displayed pose.
- [x] Layout has responsive desktop and phone breakpoints.
- [ ] Validate browser interaction at desktop and phone viewport sizes before Phase 2.

## Next phase

Phase 2 adds a single-axis plant with state updated from deterministic simulation time. The visualization will then display a physically evolving position rather than a manually set pose.
