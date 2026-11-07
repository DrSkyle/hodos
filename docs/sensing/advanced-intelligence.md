# Advanced Road Intelligence, Calibration & Maintenance Prioritization (Phase 5)

**Status:** Phase 5 Implemented (`@hodos/core/analytics`)

---

## 1. Municipal Maintenance Prioritization (`prioritizeMaintenanceSegments`)

Municipal public works departments and corridor maintenance teams require a transparent, deterministic dispatch ranking rather than an unranked cloud of pins.

[`packages/core/src/analytics.ts`](../../packages/core/src/analytics.ts) computes a composite `priorityScore ∈ [0, 100]` for every corroborated road segment (`RoadSegmentSummary`):

$$\text{Priority} = \min(100,\; S_{\text{defect}} + S_{\text{recurrence}} + S_{\text{roughness}} + S_{\text{exposure}})$$

1. **Defect Severity & Density ($S_{\text{defect}} \in [0, 40]$):**
   $$S_{\text{defect}} = \min(40,\; 9 \cdot \text{maxSeverity} + 6.5 \cdot N_{\text{open}})$$
2. **Structural Recurrence ($S_{\text{recurrence}} \in [0, 20]$):**
   $$S_{\text{recurrence}} = \min(20,\; 12 \cdot N_{\text{reappeared}})$$
   Defects that were marked repaired ($\ge 2$ fix votes or $\ge 3$ silent passes) and subsequently re-emerged indicate base-layer drainage or subgrade failure rather than a surface pothole, warranting structural rehabilitation.
3. **Surface Roughness Proxy ($S_{\text{roughness}} \in [0, 20]$):**
   $$S_{\text{roughness}} = \min(20,\; \max(0,\; (\text{roughnessProxy} - 1.5) \cdot 3.2))$$
4. **Traffic Exposure & Confidence ($S_{\text{exposure}} \in [0, 20]$):**
   $$S_{\text{exposure}} = \min\!\left(20,\; 3.5 \cdot \log_2(1 + N_{\text{passes}}) \cdot \max(0.4, \text{confidence})\right)$$

Each ranked segment emits an explicit human-auditable `rationale` string and an urgency tier (`critical`, `high`, `moderate`, `routine`).

---

## 2. Temporal Deterioration & Resurfacing Analytics (`evaluateTemporalDeterioration`)

By comparing a segment's baseline snapshot against a recent window over $\Delta D$ days, `evaluateTemporalDeterioration` computes:
- **Normalized 30-day roughness drift:**
  $$\Delta R_{30} = \frac{R_{\text{recent}} - R_{\text{baseline}}}{\max(1, \Delta D)} \times 30$$
- **Trend classification:**
  - `resurfaced_or_repaired`: all open hazards resolved or $\Delta R_{30} \le -0.8$.
  - `rapid_deterioration`: $\Delta R_{30} \ge 1.2$ or $\ge 2$ new corroborated hazards (e.g., monsoon washout or freeze-thaw failure).
  - `gradual_wear`: $\Delta R_{30} \ge 0.35$ or $1$ new corroborated hazard.
  - `stable`: otherwise.

---

## 3. Vehicle Suspension & Mount Calibration Profiles (`VEHICLE_CALIBRATION_PROFILES`)

Different vehicle classes transfer road profile excitations differently through their unsprung mass, tire sidewall stiffness, and suspension damping:
- `passenger_car_rigid` (`verticalGainFactor: 1.00`, `bandRatioAdjustment: 1.00`): Reference baseline.
- `passenger_car_soft` (`verticalGainFactor: 1.12`, `bandRatioAdjustment: 1.05`): Compensates for pocket/cupholder high-frequency attenuation.
- `heavy_bus_or_truck` (`verticalGainFactor: 1.28`, `bandRatioAdjustment: 0.88`): Compensates for long-wheelbase leaf/air suspension attenuation of sharp impulses.
- `motorcycle_or_two_wheeler` (`verticalGainFactor: 0.72`, `bandRatioAdjustment: 1.18`): Normalizes higher peak vertical accelerations from stiff front forks.

---

## 4. Machine Learning Policy & Baseline Gate

In accordance with Hodos engineering principles:
- **Deterministic DSP First:** The 10-feature physical classifier (`classify.ts` / `MotionDetector.java`) requires zero GPU/NPU overhead, runs in $< 1\text{ ms}$ per 2-second window on low-end Android devices, and is 100% interpretable.
- **ML Promotion Gate:** No neural or gradient-boosted model may replace the deterministic classifier unless evaluated through [`evaluateFieldValidation`](../../packages/core/src/validation.ts) on multi-vehicle ground-truth runs demonstrating:
  1. Higher macro-$F_1$ across `pothole`, `speed_bump`, and `rough_pavement`.
  2. Expected Calibration Error $\text{ECE} \le 0.08$.
  3. Zero regression in battery consumption or false-positive rate during phone handling.
