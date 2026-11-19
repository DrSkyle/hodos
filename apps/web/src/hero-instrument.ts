import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } from "./site-constants";

/**
 * Interactive landing-page hero instrument.
 *
 * Replaces the static wireframe SVG with a live, tactile road-sensing preview:
 *   - Top-down scrolling road corridor with real-time vertical acceleration trace
 *   - Interactive impact triggers (Pothole, Speed bump, Rough stretch) so a
 *     visitor can see how @hodos/core separates discrete impacts from normal
 *     engine vibration and corroborates them
 *   - Honest live network strip queried from Appwrite (published hazards &
 *     active shop pins — never seeded or fabricated)
 */

type ImpactKind = "pothole" | "speed_bump" | "rough_pavement";

type RoadEvent = {
  kind: ImpactKind;
  /** Progress along the corridor: 0 = top (ahead), 1 = bottom (passed). */
  y: number;
  /** Whether the vehicle marker has already crossed this event. */
  hit: boolean;
  /** Peak vertical residual amplitude (m/s^2) for the waveform pulse. */
  peak: number;
  label: string;
};

const COLORS: Record<ImpactKind, string> = {
  pothole: "#e11d48",
  speed_bump: "#7c3aed",
  rough_pavement: "#d97706"
};

const LABELS: Record<ImpactKind, { title: string; detail: string; peak: number }> = {
  pothole: {
    title: "Pothole",
    detail: "Sharp vertical drop · severity 3 · queued for corroboration",
    peak: 0.92
  },
  speed_bump: {
    title: "Speed bump",
    detail: "Symmetric double pulse · severity 2 · matched at 28 km/h",
    peak: 0.68
  },
  rough_pavement: {
    title: "Rough stretch",
    detail: "Sustained chatter above noise floor · severity 2 · corridor scored",
    peak: 0.52
  }
};

async function fetchLiveCounts(): Promise<{ hazards: number; shops: number } | null> {
  const headers = { "X-Appwrite-Project": APPWRITE_PROJECT_ID };
  const limitQuery = encodeURIComponent(JSON.stringify({ method: "limit", values: [1] }));
  const pubQuery = encodeURIComponent(
    JSON.stringify({ method: "equal", attribute: "published", values: [true] })
  );
  try {
    const [hazRes, shopRes] = await Promise.all([
      fetch(
        `${APPWRITE_ENDPOINT}/tablesdb/hodos/tables/hazards/rows?queries[]=${pubQuery}&queries[]=${limitQuery}`,
        { headers }
      ),
      fetch(
        `${APPWRITE_ENDPOINT}/tablesdb/hodos/tables/partners/rows?queries[]=${limitQuery}`,
        { headers }
      )
    ]);
    if (!hazRes.ok || !shopRes.ok) return null;
    const [hazData, shopData] = await Promise.all([hazRes.json(), shopRes.json()]);
    const hazards = Number(hazData?.total ?? (Array.isArray(hazData?.rows) ? hazData.rows.length : 0));
    const shops = Number(shopData?.total ?? (Array.isArray(shopData?.rows) ? shopData.rows.length : 0));
    if (!Number.isFinite(hazards) || !Number.isFinite(shops)) return null;
    return { hazards, shops };
  } catch (_) {
    return null;
  }
}

export function mountHeroInstrument(isNepal: boolean): void {
  const root = document.getElementById("hero-instrument");
  if (!root) return;

  const canvas = root.querySelector<HTMLCanvasElement>("#hero-canvas");
  const readoutTitle = root.querySelector<HTMLElement>("#hero-readout-title");
  const readoutDetail = root.querySelector<HTMLElement>("#hero-readout-detail");
  const regionLabel = root.querySelector<HTMLElement>("#hero-region-label");
  const liveCountEl = root.querySelector<HTMLElement>("#hero-live-counts");
  const triggerButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-trigger]"));

  if (regionLabel) {
    regionLabel.textContent = isNepal ? "Nepal · Live road sensor" : "Live road sensor";
  }

  // Query real backend totals quietly; never fabricate a number if empty or offline.
  void fetchLiveCounts().then((counts) => {
    if (!liveCountEl) return;
    if (!counts) {
      liveCountEl.textContent = "Live map · corroborated passes only";
      return;
    }
    if (counts.hazards === 0 && counts.shops === 0) {
      liveCountEl.textContent = isNepal
        ? "Live map ready · first Kathmandu corridor passes open"
        : "Live map ready · corroborated passes only, zero fake pins";
      return;
    }
    const hText = `${counts.hazards} corroborated hazard${counts.hazards === 1 ? "" : "s"}`;
    const sText = `${counts.shops} live shop pin${counts.shops === 1 ? "" : "s"}`;
    liveCountEl.textContent = `${hText} · ${sText}`;
  });

  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const VEHICLE_Y = 0.68;
  const WAVE_LEN = 120;
  const wave: number[] = new Array(WAVE_LEN).fill(0);
  const waveColors: (string | null)[] = new Array(WAVE_LEN).fill(null);

  let events: RoadEvent[] = [
    { kind: "pothole", y: 0.24, hit: false, peak: LABELS.pothole.peak, label: LABELS.pothole.title },
    { kind: "speed_bump", y: -0.22, hit: false, peak: LABELS.speed_bump.peak, label: LABELS.speed_bump.title }
  ];

  let activePulse = 0;
  let activeColor: string | null = null;
  let activeKind: ImpactKind = "pothole";
  let roadOffset = 0;
  let phase = 0;
  let lastAutoSpawn = performance.now();
  let lastFrame = performance.now();
  let autoIndex = 0;
  const autoOrder: ImpactKind[] = ["rough_pavement", "pothole", "speed_bump"];

  function setReadout(kind: ImpactKind) {
    activeKind = kind;
    const info = LABELS[kind];
    if (readoutTitle) {
      readoutTitle.textContent = info.title;
      readoutTitle.style.color = COLORS[kind];
    }
    if (readoutDetail) {
      readoutDetail.textContent = info.detail;
    }
    for (const btn of triggerButtons) {
      btn.setAttribute("aria-pressed", String(btn.dataset.trigger === kind));
    }
  }

  function spawn(kind: ImpactKind, immediate = false) {
    const info = LABELS[kind];
    events.push({
      kind,
      y: immediate ? 0.14 : -0.06,
      hit: false,
      peak: info.peak,
      label: info.title
    });
    if (events.length > 6) events = events.slice(-6);
    setReadout(kind);
    if (reducedMotion) {
      // In reduced-motion mode, immediately reflect the selected impact in the static frame.
      events = [{ kind, y: 0.42, hit: false, peak: info.peak, label: info.title }];
      renderStatic();
    }
  }

  for (const btn of triggerButtons) {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.trigger as ImpactKind | undefined;
      if (!kind || !(kind in LABELS)) return;
      lastAutoSpawn = performance.now();
      spawn(kind, true);
    });
  }

  setReadout("pothole");

  function resize(): { w: number; h: number } {
    const rect = canvas!.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(280, Math.round(rect.width));
    const h = Math.max(220, Math.round(rect.height));
    if (canvas!.width !== w * dpr || canvas!.height !== h * dpr) {
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function drawScene(w: number, h: number) {
    const roadH = h * 0.72;
    const waveTop = roadH;
    const waveH = h - roadH;

    // 1. Background terrain (deep warm asphalt slate)
    ctx!.fillStyle = "#171614";
    ctx!.fillRect(0, 0, w, h);

    // Subtle contour bands on the shoulders
    ctx!.strokeStyle = "rgba(250, 248, 242, 0.04)";
    ctx!.lineWidth = 1;
    for (let x = 28; x < w; x += 48) {
      ctx!.beginPath();
      ctx!.moveTo(x, 0);
      ctx!.lineTo(x, roadH);
      ctx!.stroke();
    }

    // 2. Road corridor
    const roadW = Math.min(184, w * 0.42);
    const roadLeft = (w - roadW) / 2;
    const roadRight = roadLeft + roadW;

    ctx!.fillStyle = "#211f1c";
    ctx!.fillRect(roadLeft, 0, roadW, roadH);

    // Road shoulders
    ctx!.strokeStyle = "rgba(250, 248, 242, 0.14)";
    ctx!.lineWidth = 1.5;
    ctx!.beginPath();
    ctx!.moveTo(roadLeft, 0);
    ctx!.lineTo(roadLeft, roadH);
    ctx!.moveTo(roadRight, 0);
    ctx!.lineTo(roadRight, roadH);
    ctx!.stroke();

    // Dashed centerline scrolling down
    ctx!.strokeStyle = "rgba(250, 248, 242, 0.18)";
    ctx!.lineWidth = 2;
    ctx!.setLineDash([14, 16]);
    ctx!.lineDashOffset = -roadOffset;
    ctx!.beginPath();
    ctx!.moveTo(w / 2, 0);
    ctx!.lineTo(w / 2, roadH);
    ctx!.stroke();
    ctx!.setLineDash([]);

    // 3. Road events (hazards moving toward & past the rider)
    const cx = w / 2;
    for (const ev of events) {
      const py = ev.y * roadH;
      if (py < -24 || py > roadH + 24) continue;
      const color = COLORS[ev.kind];

      if (ev.kind === "rough_pavement") {
        ctx!.strokeStyle = color;
        ctx!.globalAlpha = ev.hit ? 0.45 : 0.85;
        ctx!.lineWidth = 6;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(cx - roadW * 0.28, py - 18);
        ctx!.lineTo(cx - roadW * 0.28, py + 18);
        ctx!.moveTo(cx + roadW * 0.28, py - 14);
        ctx!.lineTo(cx + roadW * 0.28, py + 20);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      } else if (ev.kind === "speed_bump") {
        ctx!.strokeStyle = color;
        ctx!.globalAlpha = ev.hit ? 0.45 : 0.9;
        ctx!.lineWidth = 5;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(roadLeft + 14, py);
        ctx!.lineTo(roadRight - 14, py);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      } else {
        // Pothole marker with corroboration ring
        ctx!.beginPath();
        ctx!.arc(cx + 16, py, ev.hit ? 14 : 11, 0, Math.PI * 2);
        ctx!.strokeStyle = color;
        ctx!.globalAlpha = ev.hit ? 0.35 : 0.5;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();

        ctx!.beginPath();
        ctx!.arc(cx + 16, py, 6, 0, Math.PI * 2);
        ctx!.fillStyle = color;
        ctx!.globalAlpha = 1;
        ctx!.fill();
        ctx!.strokeStyle = "#171614";
        ctx!.lineWidth = 2;
        ctx!.stroke();
      }

      // Crisp mono tag to the right of the corridor
      const tagX = roadRight + 14;
      if (tagX + 70 < w) {
        ctx!.font = '600 10px "Overpass Mono Variable", "Overpass Mono", monospace';
        ctx!.fillStyle = ev.hit ? "rgba(250, 248, 242, 0.45)" : color;
        ctx!.fillText(ev.label.toUpperCase(), tagX, py + 3);
      }
    }

    // 4. Vehicle / phone sensor beacon
    const vy = roadH * VEHICLE_Y;
    const pulseRadius = 18 + Math.min(12, activePulse * 14);
    ctx!.beginPath();
    ctx!.arc(cx, vy, pulseRadius, 0, Math.PI * 2);
    ctx!.fillStyle = activeColor
      ? `${activeColor}28`
      : "rgba(217, 119, 6, 0.14)";
    ctx!.fill();

    ctx!.beginPath();
    ctx!.arc(cx, vy, 7.5, 0, Math.PI * 2);
    ctx!.fillStyle = "#faf8f2";
    ctx!.fill();
    ctx!.strokeStyle = activeColor || "#d97706";
    ctx!.lineWidth = 2.5;
    ctx!.stroke();

    // 5. Divider & live vertical-acceleration waveform strip
    ctx!.fillStyle = "#12110f";
    ctx!.fillRect(0, waveTop, w, waveH);
    ctx!.strokeStyle = "rgba(250, 248, 242, 0.08)";
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    ctx!.moveTo(0, waveTop + 0.5);
    ctx!.lineTo(w, waveTop + 0.5);
    ctx!.stroke();

    const midY = waveTop + waveH * 0.54;
    const amp = waveH * 0.38;

    // Adaptive MAD noise-floor threshold lines
    ctx!.strokeStyle = "rgba(250, 248, 242, 0.12)";
    ctx!.setLineDash([4, 4]);
    ctx!.beginPath();
    ctx!.moveTo(14, midY - amp * 0.34);
    ctx!.lineTo(w - 14, midY - amp * 0.34);
    ctx!.moveTo(14, midY + amp * 0.34);
    ctx!.lineTo(w - 14, midY + amp * 0.34);
    ctx!.stroke();
    ctx!.setLineDash([]);

    // Waveform trace
    const padX = 14;
    const spanX = w - padX * 2;
    const stepX = spanX / (WAVE_LEN - 1);

    for (let i = 1; i < WAVE_LEN; i += 1) {
      const x0 = padX + (i - 1) * stepX;
      const y0 = midY - wave[i - 1]! * amp;
      const x1 = padX + i * stepX;
      const y1 = midY - wave[i]! * amp;
      ctx!.strokeStyle = waveColors[i] || "rgba(250, 248, 242, 0.55)";
      ctx!.lineWidth = waveColors[i] ? 2.2 : 1.5;
      ctx!.beginPath();
      ctx!.moveTo(x0, y0);
      ctx!.lineTo(x1, y1);
      ctx!.stroke();
    }

    // Small mono legend inside the trace
    ctx!.font = '600 9.5px "Overpass Mono Variable", "Overpass Mono", monospace';
    ctx!.fillStyle = "rgba(181, 175, 162, 0.72)";
    ctx!.fillText("Z-RESIDUAL · ADAPTIVE NOISE FLOOR", 14, waveTop + 15);
  }

  function renderStatic() {
    const { w, h } = resize();
    for (let i = 0; i < WAVE_LEN; i += 1) {
      const n = Math.sin(i * 0.45) * 0.08;
      const spike = i > 68 && i < 80 ? Math.sin(((i - 68) / 12) * Math.PI * 2) * LABELS[activeKind].peak : 0;
      wave[i] = n + spike;
      waveColors[i] = Math.abs(spike) > 0.3 ? COLORS[activeKind] : null;
    }
    drawScene(w, h);
  }

  if (reducedMotion) {
    renderStatic();
    window.addEventListener("resize", renderStatic, { passive: true });
    return;
  }

  function tick(now: number) {
    const dt = Math.min(0.05, Math.max(0.004, (now - lastFrame) / 1000));
    lastFrame = now;
    phase += dt * 16;
    roadOffset = (roadOffset + dt * 96) % 30;

    // Gentle auto-cycle when the visitor hasn't clicked recently
    if (now - lastAutoSpawn > 3600) {
      lastAutoSpawn = now;
      const next = autoOrder[autoIndex % autoOrder.length]!;
      autoIndex += 1;
      spawn(next, false);
    }

    // Advance road events
    for (const ev of events) {
      ev.y += dt * 0.27;
      if (!ev.hit && ev.y >= VEHICLE_Y) {
        ev.hit = true;
        activePulse = ev.peak;
        activeColor = COLORS[ev.kind];
        setReadout(ev.kind);
      }
    }
    events = events.filter((ev) => ev.y < 1.25);

    // Compute next waveform sample
    const baseNoise = Math.sin(phase) * 0.06 + Math.sin(phase * 2.3) * 0.04;
    let sample = baseNoise;
    let sampleColor: string | null = null;
    if (activePulse > 0.05) {
      const sign = Math.sin(phase * 2.8) >= 0 ? 1 : -1;
      sample += sign * activePulse;
      if (Math.abs(sample) > 0.32) sampleColor = activeColor;
      activePulse *= Math.pow(0.06, dt);
    } else {
      activePulse = 0;
      activeColor = null;
    }

    wave.shift();
    wave.push(Math.max(-1, Math.min(1, sample)));
    waveColors.shift();
    waveColors.push(sampleColor);

    const { w, h } = resize();
    drawScene(w, h);
    window.requestAnimationFrame(tick);
  }

  window.requestAnimationFrame(tick);
}
