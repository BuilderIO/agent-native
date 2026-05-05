import { useEffect, useRef, useState } from "react";

export interface DrawingCanvasProps {
  enabled: boolean;
  /** Seconds after which a stroke starts fading. Default 5. */
  fadeAfterSeconds?: number;
}

interface StrokePoint {
  x: number;
  y: number;
}

interface Stroke {
  id: number;
  color: string;
  thickness: number;
  points: StrokePoint[];
  createdAt: number;
}

const DEFAULT_COLOR = "#EF4444";

const COLORS = [
  DEFAULT_COLOR,
  "#F59E0B",
  "#10B981",
  "#3B82F6",
  "#111827",
  "#FFFFFF",
];

const THICKNESS_OPTIONS = [3, 6, 10];

export function DrawingCanvas({
  enabled,
  fadeAfterSeconds = 5,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const nextIdRef = useRef(1);

  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [thickness, setThickness] = useState<number>(THICKNESS_OPTIONS[1]);

  // Size the canvas to the viewport and handle DPR.
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

  // Render loop — redraws every frame so fading strokes animate smoothly.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function tick() {
      if (!canvas || !ctx) return;
      ctx.clearRect(
        0,
        0,
        canvas.width / (window.devicePixelRatio || 1),
        canvas.height / (window.devicePixelRatio || 1),
      );
      const now = performance.now();
      const remaining: Stroke[] = [];
      for (const stroke of strokesRef.current) {
        const age = (now - stroke.createdAt) / 1000;
        const fadeStart = fadeAfterSeconds;
        const fadeDuration = 0.8;
        let alpha = 1;
        if (age > fadeStart) {
          alpha = 1 - (age - fadeStart) / fadeDuration;
        }
        if (alpha <= 0) continue;

        ctx.strokeStyle = stroke.color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = stroke.thickness;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

        if (stroke.points.length < 2) {
          const p = stroke.points[0];
          ctx.beginPath();
          ctx.arc(p.x, p.y, stroke.thickness / 2, 0, Math.PI * 2);
          ctx.fillStyle = stroke.color;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          ctx.stroke();
        }
        remaining.push(stroke);
      }
      ctx.globalAlpha = 1;
      strokesRef.current = remaining;
      rafRef.current = window.requestAnimationFrame(tick);
    }

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [fadeAfterSeconds]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!enabled) return;
    const id = nextIdRef.current++;
    activeIdRef.current = id;
    strokesRef.current.push({
      id,
      color,
      thickness,
      points: [{ x: e.clientX, y: e.clientY }],
      createdAt: performance.now(),
    });
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!enabled) return;
    if (activeIdRef.current === null) return;
    const stroke = strokesRef.current.find((s) => s.id === activeIdRef.current);
    if (!stroke) return;
    stroke.points.push({ x: e.clientX, y: e.clientY });
    stroke.createdAt = performance.now(); // keep active stroke "fresh" until release
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    activeIdRef.current = null;
    (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="fixed inset-0 z-[85]"
        style={{
          pointerEvents: enabled ? "auto" : "none",
          cursor: enabled ? "crosshair" : "default",
        }}
      />
      {enabled && (
        <div className="fixed left-1/2 top-4 z-[96] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={
                  "h-5 w-5 rounded-full border-2 " +
                  (color === c
                    ? "border-foreground"
                    : "border-border/60 hover:border-foreground/50")
                }
                style={{ background: c }}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
          <div className="h-4 w-px bg-border/70" />
          <div className="flex items-center gap-1.5">
            {THICKNESS_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setThickness(t)}
                className={
                  "flex h-7 w-7 items-center justify-center rounded-full " +
                  (thickness === t
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent")
                }
                aria-label={`Thickness ${t}`}
                aria-pressed={thickness === t}
              >
                <span
                  className="block rounded-full bg-current"
                  style={{ width: t, height: t }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
