import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/theme';

/**
 * The hero sea: ridge lines of a perspective wave field, drawn far-to-near with
 * occlusion, and a converted tanker riding the swell with its racks blinking.
 * Colours come from the active palette, so the sea re-inks itself on theme change.
 */
export function OceanCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let visible = true;
    let colors = read();
    let W = 0;
    let H = 0;
    let dpr = 1;

    function read() {
      const s = getComputedStyle(document.documentElement);
      return {
        bg: s.getPropertyValue('--bg').trim(),
        ink: s.getPropertyValue('--ink').trim(),
        accent: s.getPropertyValue('--accent').trim(),
        sea: s.getPropertyValue('--sea-3').trim(),
      };
    }

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(4);
    });
    ro.observe(canvas);
    const mo = new MutationObserver(() => {
      colors = read();
      if (reduced) draw(4);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !reduced) loop();
    });
    io.observe(canvas);

    const LINES = 46;
    const FOCAL = 1.2;

    const height = (x: number, z: number, t: number) =>
      0.55 * Math.sin(x * 0.55 + t * 0.9 + z * 0.35) +
      0.32 * Math.sin(x * 1.3 - t * 1.4 + z * 0.8) +
      0.18 * Math.sin(x * 2.9 + t * 2.1 - z * 1.3) +
      0.42 * Math.sin(z * 0.9 - t * 1.1);

    function draw(t: number) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const horizon = H * (W < 700 ? 0.62 : 0.47);
      const cx = W * 0.5;
      const amp = Math.min(H, 900) * 0.055;
      const step = Math.max(6, W / 150);

      const lineAt = (z: number) => {
        const pts: Array<[number, number]> = [];
        const scale = FOCAL / z;
        const base = horizon + (H - horizon) * scale * 0.9;
        for (let sx = -step; sx <= W + step; sx += step) {
          const xw = ((sx - cx) / W) * z * 6;
          pts.push([sx, base - height(xw, z, t) * amp * scale * 2.2]);
        }
        return pts;
      };

      for (let i = 0; i < LINES; i++) {
        const z = 30 - (i / (LINES - 1)) * 28.4; // far (30) → near (1.6)
        const pts = lineAt(z);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], H);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.lineTo(pts[pts.length - 1][0], H);
        ctx.closePath();
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.beginPath();
        pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = colors.ink;
        ctx.globalAlpha = 0.12 + 0.75 * (1 - z / 30) ** 1.6;
        ctx.lineWidth = 0.6 + 1.1 * (1 - z / 30);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // The vessel sits on the ridge at z ≈ 7.
        if (Math.abs(z - 7.2) < 28.4 / (LINES - 1) / 2) drawVessel(t, z, horizon, cx, amp);
      }
    }

    function drawVessel(t: number, z: number, horizon: number, cx: number, amp: number) {
      const scale = FOCAL / z;
      const vx = W * 0.62;
      const xw = ((vx - cx) / W) * z * 6;
      const base = horizon + (H - horizon) * scale * 0.9;
      const h0 = height(xw - 0.4, z, t);
      const h1 = height(xw + 0.4, z, t);
      const y = base - ((h0 + h1) / 2) * amp * scale * 2.2;
      const roll = Math.atan2((h0 - h1) * amp * scale * 0.9, 120) * 0.6;
      const L = Math.min(W * 0.36, 520);
      const s = L / 330;

      ctx.save();
      ctx.translate(vx, y + 6 * s);
      ctx.rotate(roll);
      ctx.fillStyle = colors.ink;
      ctx.strokeStyle = colors.ink;

      // Hull (side elevation, bow to the left).
      ctx.beginPath();
      ctx.moveTo(-L / 2, -14 * s);
      ctx.lineTo(L / 2 - 6 * s, -14 * s);
      ctx.lineTo(L / 2, -6 * s);
      ctx.lineTo(L / 2 - 4 * s, 10 * s);
      ctx.lineTo(-L / 2 + 18 * s, 10 * s);
      ctx.quadraticCurveTo(-L / 2 - 4 * s, 4 * s, -L / 2 - 10 * s, -16 * s);
      ctx.closePath();
      ctx.fill();

      // Compute modules: four tiers of containers with rack LEDs.
      const modules = 9;
      const mw = (L * 0.62) / modules;
      for (let m = 0; m < modules; m++) {
        const tiers = m === 0 || m === modules - 1 ? 2 : 3;
        for (let k = 0; k < tiers; k++) {
          const x0 = -L / 2 + 26 * s + m * mw;
          const y0 = -14 * s - (k + 1) * 9 * s;
          ctx.fillStyle = colors.ink;
          ctx.fillRect(x0 + 1, y0 + 1, mw - 2, 9 * s - 2);
          // Rack LEDs: deterministic blink pattern per container.
          const on = Math.sin(t * 3 + m * 1.7 + k * 2.3) > -0.2;
          ctx.fillStyle = on ? colors.accent : colors.sea;
          for (let d = 0; d < 3; d++)
            ctx.fillRect(x0 + 4 + d * (mw / 3.4), y0 + 4 * s, 2.2 * s, 1.6 * s);
        }
      }
      // Accommodation block, bridge windows and helideck aft.
      ctx.fillStyle = colors.ink;
      const ax = L / 2 - 64 * s;
      ctx.fillRect(ax, -54 * s, 44 * s, 40 * s);
      ctx.fillRect(ax - 6 * s, -58 * s, 56 * s, 4 * s);
      ctx.fillStyle = colors.bg;
      for (let w = 0; w < 5; w++) ctx.fillRect(ax + 4 * s + w * 8 * s, -48 * s, 5 * s, 3 * s);
      ctx.fillStyle = colors.ink;
      ctx.fillRect(ax + 18 * s, -72 * s, 2 * s, 14 * s);
      // Mast light.
      ctx.fillStyle = Math.sin(t * 2) > 0 ? colors.accent : colors.ink;
      ctx.beginPath();
      ctx.arc(ax + 19 * s, -73 * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
      // Turret at the bow and mooring lines into the sea.
      ctx.fillStyle = colors.ink;
      ctx.fillRect(-L / 2 + 6 * s, -26 * s, 12 * s, 12 * s);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = colors.ink;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(vx - L / 2 + 10 * s, y + 12 * s);
      ctx.lineTo(vx - L / 2 - 80 * s, H);
      ctx.moveTo(vx - L / 2 + 14 * s, y + 12 * s);
      ctx.lineTo(vx - L / 2 + 40 * s, H);
      ctx.stroke();
      ctx.restore();

      // Floating wind turbines on the horizon.
      for (const [fx, fz] of [
        [0.16, 22],
        [0.24, 26],
        [0.86, 20],
        [0.93, 24],
      ]) {
        const sc = FOCAL / fz;
        const bx = W * fx;
        const by = horizon + (H - horizon) * sc * 0.9 - 2;
        const th = 120 * sc * (H / 700) * 6;
        ctx.strokeStyle = colors.ink;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx, by - th);
        const a = t * 0.8 + fx * 10;
        for (let b = 0; b < 3; b++) {
          const ang = a + (b * Math.PI * 2) / 3;
          ctx.moveTo(bx, by - th);
          ctx.lineTo(bx + Math.cos(ang) * th * 0.45, by - th + Math.sin(ang) * th * 0.45);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    const start = performance.now();
    function loop() {
      cancelAnimationFrame(raf);
      const frame = () => {
        if (!visible || document.hidden) return;
        draw((performance.now() - start) / 1000);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    const onVis = () => !document.hidden && !reduced && loop();
    document.addEventListener('visibilitychange', onVis);

    if (reduced) draw(4);
    else loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reduced]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
