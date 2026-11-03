import "./telemetry.css";

// 1. Footer Year
const year = document.querySelector("[data-year]");
if (year) {
  year.textContent = String(new Date().getFullYear());
}

// 2. Interactive Real-Time Accelerometer & MAD Waveform Oscilloscope
const canvas = document.getElementById("sensor-canvas") as HTMLCanvasElement | null;
if (canvas) {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    let t = 0;
    const history: number[] = new Array(70).fill(0);
    const noiseFloor = 0.38;

    const renderWaveform = () => {
      t += 0.05;
      // Normal chassis vibration + occasional road pothole jerk spike
      const baseVibe = Math.sin(t * 3.2) * 0.12 + (Math.random() - 0.5) * 0.18;
      const isSpike = Math.random() < 0.04;
      const spike = isSpike ? (Math.random() > 0.5 ? 1.6 : -1.6) * (0.8 + Math.random() * 0.5) : 0;
      const currentReading = baseVibe + spike;

      history.push(currentReading);
      if (history.length > 70) history.shift();

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.fillStyle = "#07090D";
      ctx.fillRect(0, 0, width, height);

      // Draw Telemetry Coordinate Grid
      ctx.strokeStyle = "#121824";
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

      // Draw MAD Noise Floor Envelope (Amber)
      const madUpper = centerY - noiseFloor * 36;
      const madLower = centerY + noiseFloor * 36;
      ctx.strokeStyle = "rgba(245, 158, 11, 0.45)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, madUpper);
      ctx.lineTo(width, madUpper);
      ctx.moveTo(0, madLower);
      ctx.lineTo(width, madLower);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Baseline Zero Line
      ctx.strokeStyle = "#1E293B";
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Draw Sensor Jerk Curve
      ctx.lineWidth = 2;
      ctx.beginPath();
      const stepX = width / (history.length - 1);

      for (let i = 0; i < history.length; i++) {
        const val = history[i] ?? 0;
        const x = i * stepX;
        const y = centerY - val * 36;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = "#38BDF8";
      ctx.stroke();

      // Highlight Threshold Violations (Pothole Impacts in Signal Coral)
      for (let i = 0; i < history.length; i++) {
        const val = history[i] ?? 0;
        if (Math.abs(val) > noiseFloor * 1.4) {
          const x = i * stepX;
          const y = centerY - val * 36;
          ctx.fillStyle = "#FF4D36";
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "9px 'JetBrains Mono', monospace";
          ctx.fillText("HAZARD", x - 18, val > 0 ? y - 8 : y + 14);
        }
      }

      requestAnimationFrame(renderWaveform);
    };

    renderWaveform();
  }
}

// 3. Invalidate retired service workers
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((items) =>
    Promise.all(items.map((item) => item.unregister()))
  ).catch(() => {});
}

if ("caches" in window) {
  void caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k.startsWith("hodos-")).map((k) => caches.delete(k)))
  ).catch(() => {});
}
