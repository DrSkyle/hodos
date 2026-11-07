# Hodos 2.0 Measurement & Sensing Model

**Status:** Phase 1 Verified (`@hodos/core` & `org.hodos.app.MotionDetector`)  
**Parity Guarantee:** Identical floating-point DSP pipeline across TypeScript (`packages/core`) and Android Java (`MotionDetector.java`), verified to $10^{-3}$ precision by [`parity.test.ts`](../../packages/core/src/parity.test.ts) and [`MotionDetectorTest.java`](../../apps/web/android/app/src/test/java/org/hodos/app/MotionDetectorTest.java).

---

## 1. Physical Signal Model

A smartphone mounted inside or carried on a vehicle experiences a 3-axis specific force vector $\mathbf{a}(t) = (a_x(t), a_y(t), a_z(t)) \in \mathbb{R}^3$ measured in $\text{m/s}^2$ by the MEMS accelerometer (`Sensor.TYPE_ACCELEROMETER`).

The measured vector is the sum of:
1. **Quasi-static gravitational acceleration** $\mathbf{g}(t)$ ($\|\mathbf{g}\| \approx 9.81\text{ m/s}^2$), whose direction in the phone frame depends on arbitrary phone orientation (flat on console, vertical dashboard cradle, angled handlebar mount, or pocket).
2. **Low-frequency vehicle dynamics** $\mathbf{a}_{\text{dyn}}(t)$ ($< 0.5\text{ Hz}$: braking, cornering, hill grade changes).
3. **Road-surface-induced suspension & tire transients** $\mathbf{a}_{\text{road}}(t)$ ($0.5\text{–}6.0\text{ Hz}$: potholes, speed bumps, expansion joints, rough pavement).
4. **High-frequency engine, drivetrain, and mount vibration** $\mathbf{a}_{\text{vib}}(t)$ ($> 6.0\text{ Hz}$).

---

## 2. Timestamp Integrity & Sampling Rate Estimation

### 2.1 Monotonic Sensor Timestamps (`HodosService.java`)
Android's `SensorEvent.timestamp` reports nanoseconds on the monotonic `SystemClock.elapsedRealtimeNanos()` clock, whereas `System.currentTimeMillis()` is subject to main-thread delivery jitter, garbage-collection pauses, and NTP wall-clock jumps.

`HodosService.resolveSensorTimestampMs(eventTimestampNs, wallClockMs)` anchors the monotonic sensor clock to UTC epoch milliseconds at trip start:
$$t_{\text{ms}} = t_{\text{wall,0}} + \operatorname{round}\!\left(\frac{t_{\text{sensor,ns}} - t_{\text{sensor,ns,0}}}{10^6}\right)$$
If a sensor hardware reset or >60 s monotonic gap occurs, the anchor is re-established cleanly. All windows are sorted non-decreasingly by $t_{\text{ms}}$ prior to DSP processing.

### 2.2 Median Sample Rate Estimation
Given $N$ samples with timestamps $t_0, \dots, t_{N-1}$, positive inter-sample intervals $\Delta t_i = t_i - t_{i-1} \in (0, 1000)\text{ ms}$ are collected. Using the **sample median** $\widetilde{\Delta t}$ (immune to occasional OS scheduling stalls):
$$f_s = \operatorname{clamp}\!\left(\frac{1000}{\widetilde{\Delta t}},\; 5\text{ Hz},\; 500\text{ Hz}\right)$$
Nominal operating rate in `HodosService` is `SENSOR_DELAY_GAME` ($\approx 50\text{ Hz}$).

---

## 3. Orientation-Independent Gravity & Axis Decomposition

Never assume the phone's $+Z$ axis is aligned with gravity.

### 3.1 3D Gravity Exponential Moving Average (EMA)
With time constant $\tau_g = 2.5\text{ s}$ and per-sample smoothing coefficient $\alpha_i = \frac{\Delta t_i}{\tau_g + \Delta t_i}$ (where $\Delta t_i = \operatorname{clamp}((t_i - t_{i-1})/1000, 1/500, 0.5)$):
$$\mathbf{g}_i = (1 - \alpha_i)\mathbf{g}_{i-1} + \alpha_i \mathbf{a}_i, \qquad \mathbf{g}_0 = \mathbf{a}_0$$
The instantaneous unit gravity vector is:
$$\hat{\mathbf{g}}_i = \frac{\mathbf{g}_i}{\|\mathbf{g}_i\|}$$

### 3.2 Signed Vertical & Lateral Projections
Subtracting slow gravity yields the dynamic residual vector $\mathbf{d}_i = \mathbf{a}_i - \mathbf{g}_i$:
- **Signed vertical road residual** (positive = upward jolt against gravity):
  $$v_i = \mathbf{d}_i \cdot \hat{\mathbf{g}}_i$$
- **Horizontal/lateral residual** (perpendicular to gravity, capturing body roll, sway, and cornering):
  $$\mathbf{h}_i = \mathbf{d}_i - v_i \hat{\mathbf{g}}_i, \qquad l_i = \|\mathbf{h}_i\|$$

---

## 4. Zero-Phase Road Bandpass Filter ($0.5\text{–}6.0\text{ Hz}$)

To isolate road-surface impacts from quasi-static manoeuvres ($< 0.5\text{ Hz}$) and engine/mount buzz ($> 6.0\text{ Hz}$), the vertical residual $v_i$ is passed through a cascaded 2nd-order Butterworth high-pass ($f_{\text{HP}} = 0.5\text{ Hz}$, $Q = 1/\sqrt{2}$) and 2nd-order Butterworth low-pass ($f_{\text{LP}} = 6.0\text{ Hz}$, $Q = 1/\sqrt{2}$), applied **forward and backward** (`filtfilt` zero-phase filtering, 4th-order effective roll-off, zero group delay) with reflected edge padding ($M = \min(N-1, \lfloor 3 f_s \rfloor)$) to suppress window-boundary ringing.

---

## 5. Rolling MAD Noise Floor & Adaptive Hysteresis Detector

### 5.1 Rolling Median Absolute Deviation (MAD)
Over a sliding window of $W = \max(5, \operatorname{round}(5.0 \cdot f_s))$ samples ($\approx 5\text{ s}$), the robust baseline vertical roughness floor is estimated as:
$$\sigma_{\text{MAD},i} = \max\!\left(0.15\text{ m/s}^2,\; 1.4826 \cdot \operatorname{median}_{j \in W(i)} |y_j - \operatorname{median}_{k \in W(i)} y_k|\right)$$
where $y_i$ is the bandpass-filtered vertical signal and $1.4826$ scales MAD to the standard deviation of an equivalent Gaussian process.

### 5.2 Adaptive Hysteresis Thresholds
For vehicle mode (`noiseK = 3.5`, `floorAbs = 1.6 m/s²`, `exitK = 1.5`), coarse base pavement increases $\sigma_{\text{MAD},i}$. To prevent chronic false triggers on coarse chipseal while preserving sensitivity on smooth asphalt:
$$\text{floor}_{\text{eff},i} = \max\!\left(\text{floorAbs},\; 1.35 \cdot \sigma_{\text{MAD},i}\right)$$
$$K_{\text{eff},i} = K_{\text{noise}} + \operatorname{clamp}\!\left((\sigma_{\text{MAD},i} - 0.6) \cdot 0.5,\; 0,\; 1.0\right)$$
- **Entry threshold:** $T_{\text{enter},i} = \max(\text{floor}_{\text{eff},i},\; K_{\text{eff},i} \cdot \sigma_{\text{MAD},i})$
- **Exit threshold:** $T_{\text{exit},i} = \max(0.5 \cdot \text{floor}_{\text{eff},i},\; K_{\text{exit}} \cdot \sigma_{\text{MAD},i})$

Adjacent candidate envelopes separated by less than `refractoryMs` ($650\text{ ms}$ vehicle, $450\text{ ms}$ pedestrian) are merged into a single event window.

---

## 6. Shape Feature Extraction & Defect Classification

For each candidate event window $[s, e]$ padded by $\pm \lfloor 0.25 f_s \rfloor$ context samples, `@hodos/core` and `MotionDetector.java` compute 10 physical shape features:
1. `peak` ($\text{m/s}^2$): $\max |y_i|$ in the core event window.
2. `rms` ($\text{m/s}^2$): Root-mean-square of $y_i$ across the core window.
3. `crest`: Crest factor $\text{peak} / \text{rms}$ (high for sharp impulses, low for sustained vibration).
4. `durationMs` ($\text{ms}$): Envelope duration above threshold.
5. `ZeroCrossings`: Sign changes of $y_i$ within the core window.
6. `skew`: Signed asymmetry $\frac{y_{\max} + y_{\min}}{\max(|y_{\max}|, |y_{\min}|)} \in [-1, 1]$ (negative for downward wheel drop into a cavity; positive for upward compression over a hump).
7. `bandRatio`: Spectral energy ratio $E_{\text{low}}(0.5\text{–}3.0\text{ Hz}) / E_{\text{high}}(3.0\text{–}6.0\text{ Hz})$.
8. `staLta`: Short-Term Average ($0.12\text{ s}$) to Long-Term Average ($1.2\text{ s}$) energy ratio.
9. `verticalDominance`: $\frac{\text{RMS}(v)}{\text{RMS}(v) + \text{RMS}(l)} \in [0, 1]$ (rejects phone handling, door slams, and lateral swerves when $< 0.55$).
10. `kurtosis`: Excess 4th central moment $\frac{\mu_4}{\sigma^4} - 3$ across the padded context window (distinguishes localized transient shocks from stationary vibration).

### Decision Boundary Summary
| Class | Physical Signature | Key Criteria |
| :--- | :--- | :--- |
| **Rejected (`null`)** | Phone handling / lateral sway / micro-bump | `verticalDominance < 0.55` or `peak < 1.8 m/s²` or (`durationMs < 35 ms` and `peak < 3.0 m/s²`) |
| **Rejected (`null`)** | Continuous chassis/engine shudder | `durationMs > 450 ms`, `crest < 2.15`, `kurtosis < 0.2`, `staLta < 2.2` |
| **`speed_bump`** | Low-frequency symmetric/upward compression-rebound | `durationMs ∈ [180, 1400] ms`, `bandRatio > 1.05`, `skew > -0.35`, `zeroCrossings ≤ 6`, `speed < 65 km/h` |
| **`rough_pavement`** | Sustained multi-oscillation surface degradation | `durationMs > 650 ms` & `zeroCrossings ≥ 5`, or (`durationMs > 380 ms`, `crest < 2.4`, `zeroCrossings ≥ 4`, `kurtosis < 1.5`) |
| **`pothole`** | Sharp high-crest wheel drop / transient impact | `durationMs ≤ 550 ms` and passes transient impulse criteria (`crest ≥ 1.85` or `staLta ≥ 2.0` or `kurtosis ≥ 0.5` or `skew < -0.15`) |

---

## 7. Orientation-Independent Roughness Proxy vs. Calibrated IRI

### 7.1 Scientific Honesty Policy
True **International Roughness Index (IRI)** (ASTM E1926 / World Bank Technical Paper 46) is defined as the accumulated suspension motion of a mathematical Golden Quarter-Car model divided by profile distance ($\text{m/km}$), requiring either a laser inertial profilometer or a vehicle-specific calibrated transfer function (accounting for sprung/unsprung mass, tire stiffness, suspension damping, mount compliance, and speed).

Unadorned smartphone vertical RMS cannot be claimed as a calibrated ASTM E1926 IRI measurement. Accordingly:
- [`packages/core/src/iri.ts`](../../packages/core/src/iri.ts) computes `estimateRoughnessProxy` (with `estimateIRI` retained as a backwards-compatible alias).
- Every result explicitly carries `calibrated: false` and `roughnessProxy` ($\text{m/km}$ equivalent scale) alongside `verticalRms` ($\text{m/s}^2$).
- Instead of assuming `sample.z - 9.81` is vertical, `estimateRoughnessProxy` projects 3D acceleration onto the gravity EMA vector (`residuals(samples)`) and applies the $0.5\text{–}6.0\text{ Hz}$ road bandpass filter before computing $\text{RMS}(y)$, guaranteeing identical readings whether the phone sits flat or in a vertical dashboard cradle.

---

## 8. Field Validation Harness (`@hodos/core/validation`)

[`packages/core/src/validation.ts`](../../packages/core/src/validation.ts) provides a deterministic evaluation harness `evaluateFieldValidation(runs, matchRadiusMeters)` for annotated ground-truth runs:
- **Greedy nearest-neighbor spatial matching** within `matchRadiusMeters` (default $20\text{ m}$) for matching defect labels.
- **Overall & per-class metrics:** Precision, Recall, $F_1$ score, and mean localization error ($\text{m}$).
- **Confidence Calibration:** 5-bin Expected Calibration Error ($\text{ECE} = \sum_b \frac{n_b}{N} |\text{acc}_b - \text{conf}_b|$) to verify that reported confidence scores match empirical true-positive rates.
