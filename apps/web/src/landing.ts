import "./milestone.css";

// 1. Year provenance update
const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());

// 2. Interactive Real-Time Sensor Waveform Oscilloscope
const canvas = document.getElementById("sensor-canvas") as HTMLCanvasElement | null;
if (canvas) {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    let animationId: number;
    let t = 0;
    const history: number[] = new Array(80).fill(0);
    const noiseFloor = 0.35;

    const renderWaveform = () => {
      t += 0.05;
      // Normal chassis noise + occasional road pothole impulses
      const baseVibe = (Math.sin(t * 3) * 0.15 + (Math.random() - 0.5) * 0.2);
      const isSpike = Math.random() < 0.04;
      const spike = isSpike ? (Math.random() > 0.5 ? 1.8 : -1.8) * (0.8 + Math.random() * 0.6) : 0;
      const currentReading = baseVibe + spike;

      history.push(currentReading);
      if (history.length > 80) history.shift();

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.fillStyle = "#090B0D";
      ctx.fillRect(0, 0, width, height);

      // Draw Grid Lines (Survey Coordinate Grid)
      ctx.strokeStyle = "#1A2027";
      ctx.lineWidth = 1;
      for (let y = 20; y < height; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      for (let x = 20; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Draw MAD Noise Floor Bounds (Highway Chrome Yellow)
      const madUpper = centerY - noiseFloor * 40;
      const madLower = centerY + noiseFloor * 40;
      ctx.strokeStyle = "rgba(245, 184, 0, 0.4)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, madUpper);
      ctx.lineTo(width, madUpper);
      ctx.moveTo(0, madLower);
      ctx.lineTo(width, madLower);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Noise Floor Label
      ctx.fillStyle = "#F5B800";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillText("+MAD THRESHOLD (2.4 G/s)", 10, madUpper - 4);
      ctx.fillText("-MAD THRESHOLD (-2.4 G/s)", 10, madLower + 12);

      // Draw Zero Jerk Line
      ctx.strokeStyle = "#2D3748";
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Draw Accelerometer Signal Trace (White & Red Spike highlights)
      ctx.lineWidth = 2;
      ctx.beginPath();
      const stepX = width / (history.length - 1);

      for (let i = 0; i < history.length; i++) {
        const val = history[i] ?? 0;
        const x = i * stepX;
        const y = centerY - val * 40;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = "#F9FAFB";
      ctx.stroke();

      // Highlight threshold violations in Survey Red
      for (let i = 0; i < history.length; i++) {
        const val = history[i] ?? 0;
        if (Math.abs(val) > noiseFloor * 1.5) {
          const x = i * stepX;
          const y = centerY - val * 40;
          ctx.fillStyle = "#D9381E";
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "8px 'JetBrains Mono', monospace";
          ctx.fillText("POTHOLE", x - 18, val > 0 ? y - 8 : y + 14);
        }
      }

      animationId = requestAnimationFrame(renderWaveform);
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
