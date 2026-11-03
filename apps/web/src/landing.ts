import "./shadcn.css";
import {
  createIcons,
  ArrowRight,
  Download,
  Terminal,
  Copy,
  Check,
  Sun,
  Moon,
  Search,
  Activity,
  ShieldCheck,
  EyeOff,
  Layers,
  Scale,
  FileJson,
  ChevronDown,
  Navigation,
  Smartphone,
  MapPin,
  ExternalLink,
  Sparkles,
  Car,
  AlertTriangle,
  Waves,
  HelpCircle
} from "lucide";

// 1. Initialize Lucide Icons
function initLucide() {
  createIcons({
    icons: {
      ArrowRight,
      Download,
      Terminal,
      Copy,
      Check,
      Sun,
      Moon,
      Search,
      Activity,
      ShieldCheck,
      EyeOff,
      Layers,
      Scale,
      FileJson,
      ChevronDown,
      Navigation,
      Smartphone,
      MapPin,
      ExternalLink,
      Sparkles,
      Car,
      AlertTriangle,
      Waves,
      HelpCircle
    }
  });
}

// 2. Theme Toggle (Dark / Light)
const themeToggleBtn = document.getElementById("theme-toggle");
const html = document.documentElement;

function applyTheme(theme: "dark" | "light") {
  if (theme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
  initLucide();
}

// Initial Theme
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  applyTheme("dark");
} else {
  applyTheme("light");
}

themeToggleBtn?.addEventListener("click", () => {
  const isDark = html.classList.contains("dark");
  applyTheme(isDark ? "light" : "dark");
});

// 3. Tab Switching
const tabButtons = document.querySelectorAll(".tabs-trigger");
const tabContents = document.querySelectorAll(".tabs-content");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const targetId = btn.getAttribute("data-tab-target");
    tabContents.forEach((c) => {
      if (c.id === targetId) {
        c.classList.remove("hidden");
      } else {
        c.classList.add("hidden");
      }
    });
  });
});

// 4. Accordion Toggle
const accordionTriggers = document.querySelectorAll(".accordion-trigger");
accordionTriggers.forEach((btn) => {
  btn.addEventListener("click", () => {
    const item = btn.closest(".accordion-item");
    if (!item) return;
    const isOpen = item.getAttribute("data-state") === "open";
    item.setAttribute("data-state", isOpen ? "closed" : "open");
  });
});

// 5. Toast Notification
function showToast(message: string) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-emerald-500"></i><span>${message}</span>`;
  container.appendChild(toast);
  initLucide();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// 6. Copy Buttons
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const text = btn.getAttribute("data-copy") || "";
    if (text) {
      void navigator.clipboard.writeText(text);
      showToast("Copied to clipboard!");
    }
  });
});

// 7. Command Palette Modal (⌘K)
const commandBackdrop = document.getElementById("command-dialog");
const commandInput = document.getElementById("command-input") as HTMLInputElement | null;
const commandItems = document.querySelectorAll(".command-item");

function openCommandDialog() {
  commandBackdrop?.classList.remove("hidden");
  commandInput?.focus();
}

function closeCommandDialog() {
  commandBackdrop?.classList.add("hidden");
}

document.querySelectorAll("[data-command-trigger]").forEach((el) => {
  el.addEventListener("click", openCommandDialog);
});

commandBackdrop?.addEventListener("click", (e) => {
  if (e.target === commandBackdrop) closeCommandDialog();
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    if (commandBackdrop?.classList.contains("hidden")) {
      openCommandDialog();
    } else {
      closeCommandDialog();
    }
  }
  if (e.key === "Escape" && !commandBackdrop?.classList.contains("hidden")) {
    closeCommandDialog();
  }
});

commandInput?.addEventListener("input", () => {
  const q = commandInput.value.toLowerCase().trim();
  commandItems.forEach((item) => {
    const text = item.textContent?.toLowerCase() || "";
    if (text.includes(q)) {
      (item as HTMLElement).style.display = "flex";
    } else {
      (item as HTMLElement).style.display = "none";
    }
  });
});

commandItems.forEach((item) => {
  item.addEventListener("click", () => {
    const action = item.getAttribute("data-action");
    closeCommandDialog();
    if (action === "theme") {
      const isDark = html.classList.contains("dark");
      applyTheme(isDark ? "light" : "dark");
    } else if (action === "map") {
      window.location.href = "/map";
    } else if (action === "github") {
      window.open("https://github.com/DrSkyle/hodos", "_blank");
    } else if (action === "releases") {
      window.open("https://github.com/DrSkyle/hodos/releases", "_blank");
    } else if (action?.startsWith("#")) {
      const target = document.querySelector(action);
      target?.scrollIntoView({ behavior: "smooth" });
    }
  });
});

// 8. Real-Time Oscilloscope Waveform Canvas
const canvas = document.getElementById("sensor-canvas") as HTMLCanvasElement | null;
if (canvas) {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    let t = 0;
    const history: number[] = new Array(75).fill(0);
    const noiseFloor = 0.35;

    const render = () => {
      t += 0.05;
      const isDark = html.classList.contains("dark");

      // Road background vibration + pothole shockwave
      const baseVibe = Math.sin(t * 3.5) * 0.12 + (Math.random() - 0.5) * 0.16;
      const isSpike = Math.random() < 0.04;
      const spike = isSpike ? (Math.random() > 0.5 ? 1.6 : -1.6) * (0.8 + Math.random() * 0.5) : 0;
      const current = baseVibe + spike;

      history.push(current);
      if (history.length > 75) history.shift();

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.fillStyle = isDark ? "#09090b" : "#f4f4f5";
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
      ctx.lineWidth = 1;
      for (let y = 20; y < height; y += 25) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      for (let x = 20; x < width; x += 35) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Threshold lines
      const madUpper = centerY - noiseFloor * 38;
      const madLower = centerY + noiseFloor * 38;
      ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, madUpper);
      ctx.lineTo(width, madUpper);
      ctx.moveTo(0, madLower);
      ctx.lineTo(width, madLower);
      ctx.stroke();
      ctx.setLineDash([]);

      // Waveform line
      ctx.lineWidth = 2;
      ctx.strokeStyle = isDark ? "#fafafa" : "#18181b";
      ctx.beginPath();
      const stepX = width / (history.length - 1);
      for (let i = 0; i < history.length; i++) {
        const val = history[i] ?? 0;
        const x = i * stepX;
        const y = centerY - val * 38;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Pothole spikes in red
      for (let i = 0; i < history.length; i++) {
        const val = history[i] ?? 0;
        if (Math.abs(val) > noiseFloor * 1.4) {
          const x = i * stepX;
          const y = centerY - val * 38;
          ctx.fillStyle = "#ef4444";
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      requestAnimationFrame(render);
    };

    render();
  }
}

// 9. Footnote year
const yearEl = document.querySelector("[data-year]");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// Initialize icons on load
initLucide();
