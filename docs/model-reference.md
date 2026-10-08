# Model Reference

This document describes the behavior implemented in `src/simulation/simulator.js`. Values and thresholds are illustrative software-model settings, not specifications for a real antenna.

## Time and Repeatability

- The plant advances at a fixed `0.02 s` integration step (50 Hz). Each requested step is internally subdivided to no more than `0.02 s`.
- The browser scheduler caps elapsed wall time and limits catch-up work after a slow frame. Rendering and simulation time are intentionally separate.
- Encoder noise and random disturbance share a seeded xorshift generator. Resetting the simulation reuses the original seed, so the same inputs reproduce the same trace.
- The simulator starts at AZ `48°`, EL `31°`, with a step reference of AZ `72°`, EL `38°`.

## Signal Path

Each axis follows the same independent loop:

1. A step, ramp, sinusoid, or synthetic pass generates the AZ/EL reference. The pass is a constructed sweep, not an orbit solution.
2. A sampled encoder supplies quantized position with configurable resolution, noise, zero offset, and delivery delay. Missing data is marked invalid; the last measurement is retained for display but is not treated as valid feedback.
3. A PID controller computes proportional, integral, and filtered derivative contributions. Conditional anti-windup prevents integral growth when saturated output would drive farther into saturation.
4. A first-order motor response drives a speed-limited motor and a gearbox. Torque is reduced by configured degradation, high temperature, and high motor speed. Backlash temporarily absorbs motion after drive direction reversals.
5. Load torque is reduced by friction and deterministic environmental disturbance. Inertia converts load torque to angular acceleration; acceleration and angular-speed limits are enforced before position integration.
6. Configured partial travel ranges are hard stops. A full-turn azimuth range wraps at north; elevation remains bounded to the horizon/zenith interval.

This lumped model omits motor electrical dynamics, flexible structures, bearing detail, RF pointing geometry, and real-time hardware interfaces. It should be read as an interactive control-systems teaching model rather than a validated digital twin.

## Default Parameters

| Subsystem | Defaults |
| --- | --- |
| PID | `Kp 0.16`, `Ki 0.035`, `Kd 0.10`, derivative filter `0.12 s`, output limit `0.9`, integral limit `0.4`, anti-windup on |
| Mechanics | AZ inertia `18 kg·m²`, EL inertia `14 kg·m²`, max speed `10°/s`, max acceleration `18°/s²`, friction `0.08 N·m` |
| AZ / EL travel | AZ `0–360°` (wrap), EL `0–90°` |
| Gearbox | Ratio `60:1`, efficiency `0.82`, backlash `0.25°` |
| Motor | Max torque `0.08 N·m`, max speed `120 rpm`, response time `0.16 s`, degradation `0%` |
| Encoder | Resolution `0.05°` (7200 counts/revolution), noise amplitude `0.01°`, offset `0°`, sample rate `20 Hz` |
| Environment | Disturbance torque `0.12 N·m`, wind torque `0.18 N·m`, random disturbance amplitude `0.04 N·m` |
| Communications | Feedback delay `0.04 s` |
| Watchdog | Timeout `2 s` |

The dashboard permits changing these values while running. Values in this table are the simulator's startup configuration; scenarios may override them.

## Faults and Safety

| Fault / condition | Modeled effect | Safety behavior |
| --- | --- | --- |
| Encoder dropout | Stops new samples; displayed feedback becomes invalid/stale | Latches SAFE after invalid feedback persists longer than `0.4 s` |
| Motor saturation | Caps available controller output at 30% of the configured output limit | Marks degraded operation; does not by itself latch SAFE |
| Watchdog stall | Stops refreshing the simulated heartbeat | Latches SAFE after the configured watchdog timeout |
| Excessive backlash | Multiplies configured backlash by five | Marks mechanical health degraded; no automatic trip |
| Increased friction | Multiplies configured friction by five | Marks mechanical health degraded; no automatic trip |
| Motor overtemperature | Thermal proxy rises under commanded effort and affects available torque | Latches SAFE at temperature proxy `1.0` |
| Emergency stop | Immediately latches the software safety state | Commands zero actuator output until re-armed |
| Travel limit | Blocks outward motion at a configured hard stop | Reports WARNING while the stop is active; inward recovery remains possible |

The emergency-stop/re-arm mechanism, watchdog, and fault thresholds are simulated software behavior only. They do not replace independent hardware safety circuits. A critical condition must be cleared before re-arm is accepted. The user may reset the motor thermal proxy from the actuator panel after removing the cause of an overtemperature condition.

## Health Criteria

Health uses a rolling five-second window for combined AZ/EL tracking error and controller saturation, allowing nominal health to recover after an initial step transient. The error measure is `sqrt((AZ error² + EL error²) / 2)`.

| Measure | GREEN | YELLOW | ORANGE | RED |
| --- | ---: | ---: | ---: | ---: |
| Rolling RMS tracking error | `≤0.75°` | `≤2°` | `≤5°` | `>5°` |
| Rolling controller saturation fraction | `≤5%` | `≤20%` | `≤50%` | `>50%` |
| Motor degradation fraction | `≤5%` | `≤20%` | `≤45%` | `>45%` |
| Motor thermal proxy | `≤0.65` | `≤0.82` | `≤0.98` | `>0.98` |

Encoder health is GREEN when valid, YELLOW during a short invalid interval, and RED after the dropout trip threshold. Mechanical health is ORANGE while excessive backlash, increased friction, or substantial backlash take-up is active. Overall health reports the worst subsystem status; a latched safety event forces overall health to RED. These are model presentation thresholds, not equipment alarm settings.

## Performance Metrics

- **Rise time:** elapsed time from the 10% to 90% progress crossings for each axis after a step. The displayed value is the slower active axis.
- **Overshoot:** largest positive progress beyond the final commanded position, expressed as a percentage of the original step magnitude.
- **Settling time:** time from the step command until both axes remain within `max(0.5°, 2% of that axis's initial step error)` for at least one second.
- **Steady-state error:** mean combined AZ/EL error magnitude over the most recent one-second window.
- **RMS error / maximum error:** combined error RMS and peak since the performance window was reset (or since simulation start).
- **Maximum effort:** peak absolute normalized PID output observed since the performance window was reset.

Response metrics are available for step references; for moving references they are intentionally not presented as step-response results. Resetting the performance window clears cumulative error/effort metrics and step-response results, but does not reset the plant or health state. A subsequent step command begins a new response measurement.

## Verification Scope

The Node.js suite verifies deterministic plant motion, target profiles, PID limits and anti-windup, encoder quantization/noise/dropout behavior, backlash, torque degradation, hard stops, safe-state transitions, thermal trip, recovery gating, seeded repeatability, reset behavior, and nominal health/performance recovery. Browser checks separately exercise the dashboard at desktop and phone widths and verify the emergency-stop, encoder-fault, and recovery flow. Neither check qualifies this model for use with real equipment.
