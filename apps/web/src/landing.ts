import "./landing.css";

// ---------------------------------------------------------------------------
// 1. Dynamic Year & Service Worker Cleanup
// ---------------------------------------------------------------------------
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((items) => Promise.all(items.map((item) => item.unregister())))
    .catch(() => {});
}
if ("caches" in window) {
  caches
    .keys()
    .then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("hodos-")).map((k) => caches.delete(k)))
    )
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// 2. Interactive On-Device Sensor Simulator (Oscilloscope)
// ---------------------------------------------------------------------------
interface SimProfile {
  name: string;
  duration: number; // in frames
  generator: (t: number) => number; // returns G value (gravity = 1.0)
  stateText: string;
  stateClass: "ok" | "alert" | "warn";
  packet: { type: string; severity: string; score: number };
}

const smoothProfile: SimProfile = {
  name: "Smooth Road",
  duration: 0,
  generator: () => 1.0 + (Math.random() - 0.5) * 0.08,
  stateText: "CRUISING (NORMAL)",
  stateClass: "ok",
  packet: { type: "clear", severity: "none", score: 0.0 }
};

const profiles: Record<string, SimProfile> = {
  pothole: {
    name: "Pothole",
    duration: 50,
    generator: (t) => {
      if (t < 12) return 1.0 - (t / 12) * 0.75;
      if (t < 22) return 0.25 + ((t - 12) / 10) * 3.15;
      const decay = Math.exp(-(t - 22) / 10);
      return 1.0 + Math.sin((t - 22) * 0.5) * 1.4 * decay;
    },
    stateText: "POTHOLE DETECTED",
    stateClass: "alert",
    packet: { type: "pothole", severity: "high", score: 0.94 }
  },
  bump: {
    name: "Speed Bump",
    duration: 60,
    generator: (t) => {
      if (t < 30) return 1.0 + Math.sin((t / 30) * Math.PI) * 1.1;
      const decay = Math.exp(-(t - 30) / 12);
      return 1.0 - Math.sin(((t - 30) / 30) * Math.PI) * 0.5 * decay;
    },
    stateText: "SPEED BUMP DETECTED",
    stateClass: "warn",
    packet: { type: "speed_bump", severity: "medium", score: 0.82 }
  },
  rough: {
    name: "Rough Road",
    duration: 120,
    generator: (t) => {
      return 1.0 + Math.sin(t * 0.7) * 0.45 + (Math.random() - 0.5) * 0.5;
    },
    stateText: "ROUGH PAVEMENT",
    stateClass: "warn",
    packet: { type: "roughness", severity: "medium", score: 0.71 }
  },
  smooth: smoothProfile
};

function initSensorSimulator() {
  const canvas = document.getElementById("sensorCanvas") as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = (canvas.width = canvas.parentElement?.clientWidth || 400);
  let height = (canvas.height = canvas.parentElement?.clientHeight || 160);

  const resizeHandler = () => {
    width = canvas.width = canvas.parentElement?.clientWidth || 400;
    height = canvas.height = canvas.parentElement?.clientHeight || 160;
  };
  window.addEventListener("resize", resizeHandler);

  const historyLength = 180;
  const history: number[] = new Array<number>(historyLength).fill(1.0);

  let activeProfile: SimProfile = smoothProfile;
  let profileFrame = 0;

  const hudAccel = document.getElementById("hudAccel");
  const hudJerk = document.getElementById("hudJerk");
  const hudState = document.getElementById("hudState");
  const hudPacket = document.getElementById("hudPacket");
  const simButtons = document.querySelectorAll(".sim-btn");

  const setTrigger = (key: string) => {
    const selected = profiles[key];
    if (!selected) return;
    activeProfile = selected;
    profileFrame = 0;
    simButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-trigger") === key);
    });

    if (activeProfile !== smoothProfile && hudPacket) {
      hudPacket.innerHTML = `<span>[OUTBOX] Queued observation:</span> <strong>{"type":"${activeProfile.packet.type}","sev":"${activeProfile.packet.severity}","score":${activeProfile.packet.score}}</strong>`;
    } else if (hudPacket) {
      hudPacket.innerHTML = `<span>[OUTBOX] Passive standby:</span> <strong>Sensor stream in local RAM only</strong>`;
    }
  };

  simButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const trigger = btn.getAttribute("data-trigger");
      if (trigger) setTrigger(trigger);
    });
  });

  let prevG = 1.0;

  function render() {
    if (!ctx) return;

    let currentG = 1.0;
    if (activeProfile === smoothProfile) {
      currentG = activeProfile.generator(0);
    } else {
      currentG = activeProfile.generator(profileFrame);
      profileFrame++;
      if (profileFrame >= activeProfile.duration) {
        setTrigger("smooth");
      }
    }

    history.shift();
    history.push(currentG);

    const jerk = Math.abs(currentG - prevG) * 9.8 * 50;
    prevG = currentG;

    if (hudAccel) hudAccel.textContent = `${currentG.toFixed(2)} G`;
    if (hudJerk) hudJerk.textContent = `${jerk.toFixed(1)} m/s³`;
    if (hudState) {
      hudState.textContent = activeProfile.stateText;
      hudState.className = `hud-val ${activeProfile.stateClass}`;
    }

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#142c22";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    const baselineY = height * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(width, baselineY);
    ctx.stroke();

    const thresholdUpperY = baselineY - height * 0.35;
    ctx.strokeStyle = "rgba(220, 38, 38, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, thresholdUpperY);
    ctx.lineTo(width, thresholdUpperY);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.beginPath();
    const step = width / (historyLength - 1);
    for (let i = 0; i < history.length; i++) {
      const g = history[i] ?? 1.0;
      const y = baselineY - (g - 1.0) * (height * 0.28);
      const x = i * step;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    const strokeColor =
      activeProfile.stateClass === "alert"
        ? "#ef4444"
        : activeProfile.stateClass === "warn"
          ? "#f59e0b"
          : "#10b981";
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    const lastX = width - 2;
    const lastY = baselineY - (currentG - 1.0) * (height * 0.28);
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// 3. Interactive Hazard Map Inspector
// ---------------------------------------------------------------------------
interface Hazard {
  id: string;
  name: string;
  road: string;
  type: "pothole" | "bump" | "repaired";
  severity: "High" | "Medium" | "Resolved";
  severityTag: "danger" | "warn" | "fixed";
  passes: number;
  devices: number;
  impactG: string;
  coords: string;
  status: string;
  pinX: number;
  pinY: number;
}

const defaultHazard: Hazard = {
  id: "h1",
  name: "Deep Asphalt Pothole",
  road: "North Ring Road, Outer Lane",
  type: "pothole",
  severity: "High",
  severityTag: "danger",
  passes: 14,
  devices: 9,
  impactG: "4.8 G vertical rebound",
  coords: "37.7842° N, 122.4089° W",
  status: "Active · Multiple independent trips confirmed",
  pinX: 130,
  pinY: 140
};

const hazardsData: Hazard[] = [
  defaultHazard,
  {
    id: "h2",
    name: "Sunken Trench Patch",
    road: "Market & 4th Street Crossing",
    type: "pothole",
    severity: "Medium",
    severityTag: "danger",
    passes: 8,
    devices: 5,
    impactG: "2.6 G vertical drop",
    coords: "37.7858° N, 122.4065° W",
    status: "Active · Recent observations recorded",
    pinX: 250,
    pinY: 220
  },
  {
    id: "h3",
    name: "Unmarked Asphalt Speed Bump",
    road: "Highland Parkway, Eastbound",
    type: "bump",
    severity: "Medium",
    severityTag: "warn",
    passes: 28,
    devices: 16,
    impactG: "2.1 G smooth compression",
    coords: "37.7811° N, 122.4140° W",
    status: "Active · Permanent road feature candidate",
    pinX: 340,
    pinY: 130
  },
  {
    id: "h4",
    name: "Resurfaced Utility Cut",
    road: "Pine Valley Connector",
    type: "repaired",
    severity: "Resolved",
    severityTag: "fixed",
    passes: 19,
    devices: 11,
    impactG: "0.15 G (baseline)",
    coords: "37.7890° N, 122.4110° W",
    status: "Repaired · Verified smooth by 6 subsequent journeys",
    pinX: 200,
    pinY: 340
  }
];

function initHazardMapInspector() {
  const hazardList = document.getElementById("hazardList");
  const filterButtons = document.querySelectorAll<HTMLButtonElement>(".map-filter-btn");
  const inspectorDetail = document.getElementById("inspectorDetail");

  let activeFilter = "all";
  let selectedHazardId = "h1";

  function renderList() {
    if (!hazardList) return;
    const filtered = hazardsData.filter((h) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "pothole") return h.type === "pothole";
      if (activeFilter === "bump") return h.type === "bump";
      if (activeFilter === "repaired") return h.type === "repaired";
      return true;
    });

    hazardList.innerHTML = filtered
      .map(
        (h) => `
      <div class="hazard-item ${h.id === selectedHazardId ? "selected" : ""}" data-id="${h.id}">
        <div class="hazard-icon-badge ${h.severityTag}">
          ${h.type === "pothole" ? "🕳️" : h.type === "bump" ? "〰️" : "✓"}
        </div>
        <div class="hazard-info">
          <div class="hazard-title-row">
            <span class="hazard-title">${h.name}</span>
            <span class="hazard-tag ${h.severityTag}">${h.severity}</span>
          </div>
          <div class="hazard-meta">${h.road}</div>
          <div class="hazard-meta" style="margin-top:2px;">${h.passes} passes · ${h.devices} devices</div>
        </div>
      </div>
    `
      )
      .join("");

    hazardList.querySelectorAll(".hazard-item").forEach((item) => {
      item.addEventListener("click", () => {
        const id = item.getAttribute("data-id");
        if (id) selectHazard(id);
      });
    });

    updateMapPins();
    updateInspectorDetail();
  }

  function selectHazard(id: string) {
    selectedHazardId = id;
    document.querySelectorAll(".hazard-item").forEach((el) => {
      el.classList.toggle("selected", el.getAttribute("data-id") === id);
    });
    updateMapPins();
    updateInspectorDetail();
  }

  function updateInspectorDetail() {
    if (!inspectorDetail) return;
    const h = hazardsData.find((item) => item.id === selectedHazardId) ?? defaultHazard;
    inspectorDetail.innerHTML = `
      <div style="padding: 18px 24px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="hazard-tag ${h.severityTag}">${h.severity}</span>
          <span style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">${h.coords}</span>
        </div>
        <h4 style="margin:0; font-size:16px;">${h.name}</h4>
        <p style="margin:0; font-size:13px; color:var(--text-muted);">${h.road}</p>
        
        <div style="background:var(--bg-card-subtle); border-radius:8px; padding:10px 12px; font-size:12px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div><strong style="color:var(--text-main); font-size:14px;">${h.passes}</strong><span style="color:var(--text-muted); display:block;">Total passes</span></div>
          <div><strong style="color:var(--text-main); font-size:14px;">${h.devices}</strong><span style="color:var(--text-muted); display:block;">Independent phones</span></div>
        </div>
        <div style="font-size:12px; color:var(--forest); font-family:var(--font-mono);">Evidence: ${h.impactG}</div>
        <div style="font-size:12px; color:var(--text-muted);">${h.status}</div>

        <div style="display:flex; gap:8px; margin-top:4px;">
          <button class="btn btn-outline" id="btnConfirmHazard" style="flex:1; padding:8px 12px; font-size:12px;">Confirm Still Here</button>
          <button class="btn btn-subtle" id="btnReportFixed" style="flex:1; padding:8px 12px; font-size:12px;">Report Repaired ✓</button>
        </div>
      </div>
    `;

    document.getElementById("btnConfirmHazard")?.addEventListener("click", () => {
      alert(`Observation submitted: You corroborated "${h.name}" on ${h.road}. Thank you!`);
    });
    document.getElementById("btnReportFixed")?.addEventListener("click", () => {
      alert(`Repair report queued: Thank you for helping keep the neighborhood map clean!`);
    });
  }

  function updateMapPins() {
    const pinsGroup = document.getElementById("mapPinsGroup");
    if (!pinsGroup) return;

    const filtered = hazardsData.filter((h) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "pothole") return h.type === "pothole";
      if (activeFilter === "bump") return h.type === "bump";
      if (activeFilter === "repaired") return h.type === "repaired";
      return true;
    });

    pinsGroup.innerHTML = filtered
      .map((h) => {
        const isSelected = h.id === selectedHazardId;
        const color =
          h.severityTag === "danger"
            ? "#dc2626"
            : h.severityTag === "warn"
              ? "#d97706"
              : "#059669";
        return `
        <g class="hazard-pin ${isSelected ? "selected" : ""}" data-id="${h.id}" transform="translate(${h.pinX}, ${h.pinY})">
          <circle class="outer" r="${isSelected ? 16 : 12}" fill="${color}" fill-opacity="${isSelected ? "0.28" : "0.18"}" />
          <circle r="${isSelected ? 8 : 6}" fill="${color}" stroke="#ffffff" stroke-width="2.5" />
          ${isSelected ? `<text y="-18" text-anchor="middle" font-size="11" font-weight="700" fill="#104e3f" font-family="var(--font-sans)">${h.name}</text>` : ""}
        </g>
      `;
      })
      .join("");

    pinsGroup.querySelectorAll(".hazard-pin").forEach((pin) => {
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = pin.getAttribute("data-id");
        if (id) selectHazard(id);
      });
    });
  }

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.getAttribute("data-filter") || "all";
      renderList();
    });
  });

  renderList();
}

// ---------------------------------------------------------------------------
// Run on DOM ready
// ---------------------------------------------------------------------------
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initSensorSimulator();
    initHazardMapInspector();
  });
} else {
  initSensorSimulator();
  initHazardMapInspector();
}
