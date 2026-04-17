import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

export interface ConfettiHandle {
  /** Fire a new confetti burst. */
  burst: (opts?: { count?: number; origin?: { x: number; y: number } }) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
  alpha: number;
  gravity: number;
  age: number;
  life: number;
}

const COLORS = [
  "#625DF5",
  "#A78BFA",
  "#F472B6",
  "#F59E0B",
  "#10B981",
  "#FFFFFF",
];

export const ConfettiCanvas = forwardRef<ConfettiHandle>(
  function ConfettiCanvas(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      function resize() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(dpr, dpr);
      }
      resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let lastTs = performance.now();
      function tick(ts: number) {
        if (!canvas || !ctx) return;
        const dt = Math.min(50, ts - lastTs) / 1000;
        lastTs = ts;

        ctx.clearRect(
          0,
          0,
          canvas.width / (window.devicePixelRatio || 1),
          canvas.height / (window.devicePixelRatio || 1),
        );

        const live: Particle[] = [];
        for (const p of particlesRef.current) {
          p.age += dt;
          if (p.age >= p.life) continue;
          p.vy += p.gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rotation += p.rotationSpeed * dt;
          p.alpha = Math.max(0, 1 - p.age / p.life);

          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();

          live.push(p);
        }
        particlesRef.current = live;
        rafRef.current = window.requestAnimationFrame(tick);
      }
      rafRef.current = window.requestAnimationFrame(tick);
      return () => {
        if (rafRef.current !== null)
          window.cancelAnimationFrame(rafRef.current);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      burst(opts) {
        const count = opts?.count ?? 180;
        const ox =
          opts?.origin?.x ??
          (typeof window !== "undefined" ? window.innerWidth / 2 : 0);
        const oy =
          opts?.origin?.y ??
          (typeof window !== "undefined" ? window.innerHeight * 0.35 : 0);
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 300 + Math.random() * 500;
          particlesRef.current.push({
            x: ox,
            y: oy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 200,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 12,
            size: 8 + Math.random() * 8,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            alpha: 1,
            gravity: 900,
            age: 0,
            life: 1.6 + Math.random() * 0.6,
          });
        }
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-[98]"
        aria-hidden
      />
    );
  },
);
