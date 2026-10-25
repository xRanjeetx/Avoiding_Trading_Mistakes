import { useEffect, useRef } from "react";

const CANDLE_W = 16;
const GAP = 10;
const STEP = CANDLE_W + GAP;

function nextCandle(prevClose, drift) {
  const open = prevClose;
  const close = open + (Math.random() - 0.5 + drift) * 22;
  const high = Math.max(open, close) + Math.random() * 12;
  const low = Math.min(open, close) - Math.random() * 12;
  return { open, close, high, low };
}

// Decorative background: drifting particles with faint links, and a slowly scrolling candlestick chart.
export default function MarketBackdrop() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, last = performance.now();
    let particles = [], candles = [], offset = 0, drift = 0.04, colors = readColors();

    function readColors() {
      const s = getComputedStyle(document.documentElement);
      return {
        up: s.getPropertyValue("--good").trim() || "#10b981",
        down: s.getPropertyValue("--bad").trim() || "#f43f5e",
        dot: s.getPropertyValue("--primary").trim() || "#6366f1",
        dark: document.documentElement.dataset.theme !== "light",
      };
    }

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(70, (w * h) / 22000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.8 + 0.6,
      }));
      const need = Math.ceil(w / STEP) + 3;
      candles = [];
      let c = 0;
      for (let i = 0; i < need; i++) {
        const k = nextCandle(c, drift);
        candles.push(k);
        c = k.close;
      }
    }

    function draw(now) {
      const dt = Math.min(now - last, 50);
      last = now;
      ctx.clearRect(0, 0, w, h);

      // --- candles (lower part of the screen) ---
      if (!reduced) offset += dt * 0.018;
      while (offset >= STEP) {
        offset -= STEP;
        candles.shift();
        const prev = candles[candles.length - 1].close;
        if (Math.abs(prev) > 140) drift = -Math.sign(prev) * 0.05;
        else if (Math.random() < 0.08) drift = (Math.random() - 0.5) * 0.14;
        candles.push(nextCandle(prev, drift));
      }
      const base = h * 0.78;
      const alpha = colors.dark ? 0.2 : 0.22;
      ctx.lineWidth = 1.5;
      let first = true;
      ctx.beginPath();
      candles.forEach((k, i) => {
        const x = i * STEP - offset + CANDLE_W / 2;
        if (first) { ctx.moveTo(x, base - k.close); first = false; } else ctx.lineTo(x, base - k.close);
      });
      ctx.strokeStyle = colors.dot + "55";
      ctx.stroke();

      candles.forEach((k, i) => {
        const x = i * STEP - offset;
        const up = k.close >= k.open;
        const col = up ? colors.up : colors.down;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x + CANDLE_W / 2, base - k.high);
        ctx.lineTo(x + CANDLE_W / 2, base - k.low);
        ctx.stroke();
        const top = base - Math.max(k.open, k.close);
        const body = Math.max(3, Math.abs(k.close - k.open));
        ctx.beginPath();
        ctx.roundRect(x, top, CANDLE_W, body, 3);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // --- particles ---
      for (const p of particles) {
        if (!reduced) {
          p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06;
          if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
          if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
        }
      }
      ctx.fillStyle = colors.dot;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.283); ctx.fill();
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 130) {
            ctx.globalAlpha = (1 - d / 130) * 0.22;
            ctx.strokeStyle = colors.dot;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      if (!reduced) raf = requestAnimationFrame(draw);
    }

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => { resize(); if (reduced) raf = requestAnimationFrame(draw); });
    ro.observe(canvas);
    const mo = new MutationObserver(() => { colors = readColors(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); };
  }, []);

  return <canvas ref={ref} className="lp-canvas" aria-hidden="true" />;
}
