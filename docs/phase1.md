# Phase 1: Antenna Visualization (Historical)

This document records the original visualization-only milestone. The current implementation has since added a coupled plant, controller, feedback, fault, health, safety, and performance model; use the root [README](../README.md) and [Model Reference](model-reference.md) for current behavior.

## Original Scope

Establish the static web application shell and a legible AZ/EL antenna pointing view. No physical dynamics or control behavior is in scope in this phase.

## Visual data model

- Target AZ and EL are operator-entered reference angles.
- Antenna AZ and EL are independently operator-entered schematic pose angles.
- AZ compass vectors use a north-clockwise bearing convention.
- Elevation is drawn in a side view from the horizon toward zenith.
- AZ error is the shortest signed wrapped difference: `((target - antenna + 540) mod 360) - 180`.
- EL error is the direct difference: `target - antenna`.

These differences describe geometry only. They are not control errors from sensor feedback.

## Original Verification Checklist

- [x] Sliders and numeric fields are bounded and synchronized.
- [x] Target and displayed pose are independent.
- [x] AZ wraps through north for the displayed shortest signed difference.
- [x] Elevation dish orientation changes with the displayed pose.
- [x] Layout has responsive desktop and phone breakpoints.
- [x] Validate browser interaction at desktop and phone viewport sizes in the completed dashboard.

## Historical Next Phase

Phase 2 added a deterministic plant, later extended to two-axis AZ/EL control and the other subsystems described in the current documentation.
