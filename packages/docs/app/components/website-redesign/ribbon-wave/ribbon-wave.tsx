import { useEffect, useRef, useState } from "react";

import {
  paintRibbonPalette,
  readRibbonPalette,
  RIBBON_PALETTE_ROLES,
} from "./palette";
import {
  RIBBON_BREAKPOINT_QUERIES,
  RIBBON_FINISH,
  RIBBON_MOTION,
  RIBBON_PLACEMENTS,
  RIBBON_SURFACE,
} from "./presets";
import { RibbonWaveRenderer } from "./renderer";

/**
 * Knobs are CSS custom properties on the root (or any ancestor), read every
 * frame: `--b-hero-ribbon-{speed,displace,twist,glow,blur,grain,opacity}` and
 * the palette roles `--b-hero-ribbon-{edge,light,primary,secondary,accent,deep}`.
 */
const KNOB_PREFIX = "--b-hero-ribbon-";

const KNOB_DEFAULTS = {
  speed: 1,
  displace: RIBBON_MOTION.displaceAmount,
  twist: 1,
  glow: RIBBON_SURFACE.glowAmount,
  blur: RIBBON_FINISH.blurAngle,
  grain: RIBBON_FINISH.grain,
};

type Knob = keyof typeof KNOB_DEFAULTS;

export interface RibbonWaveProps {
  className?: string;
  /**
   * A square palette image to sample instead of painting one from the
   * `--b-hero-ribbon-*` colour tokens. u runs across the fold, v along it.
   */
  paletteSrc?: string;
}

export function RibbonWave({ className, paletteSrc }: RibbonWaveProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let renderer: RibbonWaveRenderer | null;
    try {
      renderer = RibbonWaveRenderer.create(canvas);
    } catch (error) {
      console.error("Could not start the hero ribbon", error);
      return;
    }
    // Without WebGL2 the hero keeps its plain page background.
    if (!renderer) return;
    const gl = renderer;

    const style = getComputedStyle(root);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const small = window.matchMedia(RIBBON_BREAKPOINT_QUERIES.small);
    const medium = window.matchMedia(RIBBON_BREAKPOINT_QUERIES.medium);

    let disposed = false;
    let failed = false;
    let paletteReady = false;
    let paletteKey = "";
    let onScreen = true;
    let raf = 0;
    let frame = 0;
    let lastTime: number | null = null;
    let clockMs: number = RIBBON_MOTION.startMs;
    let ease = 0;
    let reportedDrawn = false;

    const knob = (name: Knob) => {
      const raw = style.getPropertyValue(KNOB_PREFIX + name).trim();
      const value = raw === "" ? KNOB_DEFAULTS[name] : Number(raw);
      return Number.isFinite(value) ? value : KNOB_DEFAULTS[name];
    };

    const syncTokenPalette = () => {
      const colors = readRibbonPalette(style, KNOB_PREFIX);
      if (!colors) {
        throw new Error("The --b-hero-ribbon-* colour tokens are not set");
      }
      const key = RIBBON_PALETTE_ROLES.map((role) => colors[role]).join("|");
      if (key === paletteKey) return;
      paletteKey = key;
      gl.setPalette(paintRibbonPalette(colors));
      paletteReady = true;
    };

    const draw = () => {
      if (disposed || failed) return;
      try {
        if (!paletteSrc) syncTokenPalette();
        if (!paletteReady || gl.isLost) return;
        gl.draw({
          phase: clockMs * RIBBON_MOTION.phasePerMs,
          placement: small.matches
            ? RIBBON_PLACEMENTS.small
            : medium.matches
              ? RIBBON_PLACEMENTS.medium
              : RIBBON_PLACEMENTS.wide,
          displaceAmount: knob("displace"),
          twist: knob("twist"),
          glowAmount: knob("glow"),
          blurAngle: knob("blur"),
          grain: knob("grain"),
        });
      } catch (error) {
        failed = true;
        stop();
        console.error("The hero ribbon stopped drawing", error);
        return;
      }
      if (!reportedDrawn) {
        reportedDrawn = true;
        setDrawn(true);
      }
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      frame += 1;
      if (frame % RIBBON_MOTION.frameStride !== 0) return;
      if (lastTime !== null) {
        clockMs += (now - lastTime) * ease * knob("speed");
      }
      lastTime = now;
      draw();
      ease = Math.min(1, ease + RIBBON_MOTION.easeInPerFrame);
    };

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTime = null;
    }

    const schedule = () => {
      stop();
      if (reducedMotion.matches) {
        draw();
        return;
      }
      if (onScreen && !document.hidden) raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      gl.resize(box.width, box.height, Math.min(window.devicePixelRatio, 2));
      draw();
    };

    if (paletteSrc) {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        if (disposed) return;
        gl.setPalette(image);
        paletteReady = true;
        draw();
      };
      image.onerror = () => {
        console.error(`Could not load the hero ribbon palette ${paletteSrc}`);
      };
      image.src = paletteSrc;
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry?.isIntersecting ?? true;
        schedule();
      },
      { rootMargin: "20px 0px" },
    );
    intersection.observe(canvas);
    reducedMotion.addEventListener("change", schedule);
    document.addEventListener("visibilitychange", schedule);

    resize();
    schedule();

    return () => {
      disposed = true;
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      reducedMotion.removeEventListener("change", schedule);
      document.removeEventListener("visibilitychange", schedule);
      gl.dispose();
    };
  }, [paletteSrc]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={["pointer-events-none", className].filter(Boolean).join(" ")}
    >
      {/* The drawing box starts 76px above the hero, under the header, and on
          wide screens bleeds off the right edge of the content column. */}
      <div className="absolute inset-x-0 top-[-76px] bottom-0 flex justify-center">
        <div className="relative h-full w-full max-w-site">
          <canvas
            ref={canvasRef}
            data-drawn={drawn || undefined}
            className="absolute inset-y-0 left-0 h-full w-full opacity-0 transition-opacity duration-[250ms] ease-linear data-[drawn]:opacity-[var(--b-hero-ribbon-opacity,1)] min-[1264px]:left-[19.75%] min-[1264px]:w-[110%]"
          />
        </div>
      </div>
    </div>
  );
}
