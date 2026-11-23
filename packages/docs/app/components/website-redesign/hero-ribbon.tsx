import { useEffect, useRef, type CSSProperties } from "react";

import {
  DEFAULT_RIBBON_SETTINGS,
  RIBBON_POSES,
  RibbonRenderer,
  type RibbonSettings,
} from "./hero-ribbon-renderer";

/**
 * Swappable palette: an image URL mapped across the ribbon (x along its width,
 * y along its length). Null paints the procedural palette from the
 * `--ribbon-color-*` variables below.
 */
export const RIBBON_PALETTE_SRC: string | null = null;

const PALETTE_COLOR_VARS = [
  "--ribbon-color-1",
  "--ribbon-color-2",
  "--ribbon-color-3",
  "--ribbon-color-4",
  "--ribbon-color-5",
] as const;

const SETTING_VARS: Record<keyof RibbonSettings, string> = {
  speed: "--ribbon-speed",
  displace: "--ribbon-displace",
  twistX: "--ribbon-twist-x",
  twistY: "--ribbon-twist-y",
  twistZ: "--ribbon-twist-z",
  glow: "--ribbon-glow",
  hue: "--ribbon-hue",
  saturation: "--ribbon-saturation",
  blur: "--ribbon-blur",
  grain: "--ribbon-grain",
};

const KNOB_DEFAULTS = {
  ...Object.fromEntries(
    Object.entries(SETTING_VARS).map(([key, cssVar]) => [
      cssVar,
      String(DEFAULT_RIBBON_SETTINGS[key as keyof RibbonSettings]),
    ]),
  ),
  "--ribbon-color-1": "var(--c-blue-500)",
  "--ribbon-color-2": "var(--c-violet-400)",
  "--ribbon-color-3": "var(--c-blue-200)",
  "--ribbon-color-4": "var(--c-green-400)",
  "--ribbon-color-5": "var(--c-blue-600)",
} as CSSProperties;

/** Blob layout of the procedural palette: [x, y, radius, colour index], in 0..1. */
const PALETTE_BLOBS: ReadonlyArray<[number, number, number, number]> = [
  [0.06, 0.3, 0.3, 1],
  [0.1, 0.82, 0.28, 1],
  [0.28, 0.22, 0.26, 0],
  [0.3, 0.66, 0.28, 2],
  [0.48, 0.42, 0.22, 2],
  [0.62, 0.18, 0.26, 3],
  [0.66, 0.72, 0.24, 0],
  [0.88, 0.34, 0.24, 1],
  [0.86, 0.86, 0.2, 3],
  [0.74, 0.5, 0.11, 4],
];

const PALETTE_SIZE = 256;

function paintPalette(colors: readonly string[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PALETTE_SIZE;
  canvas.height = PALETTE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const s = PALETTE_SIZE;
  ctx.fillStyle = "#e8fbff";
  ctx.fillRect(0, 0, s, s);
  for (const [x, y, radius, colorIndex] of PALETTE_BLOBS) {
    const gradient = ctx.createRadialGradient(
      x * s,
      y * s,
      0,
      x * s,
      y * s,
      radius * s,
    );
    const color = colors[colorIndex] || colors[0];
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.45, color);
    gradient.addColorStop(1, "transparent");
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, s, s);
  }
  ctx.globalAlpha = 1;
  const edges = ctx.createLinearGradient(0, 0, s, 0);
  edges.addColorStop(0, "rgba(240, 252, 255, 0.5)");
  edges.addColorStop(0.05, "rgba(240, 252, 255, 0)");
  edges.addColorStop(0.95, "rgba(240, 252, 255, 0)");
  edges.addColorStop(1, "rgba(240, 252, 255, 0.5)");
  ctx.fillStyle = edges;
  ctx.fillRect(0, 0, s, s);
  for (const streakX of [0.48, 0.52]) {
    const streak = ctx.createLinearGradient(
      (streakX - 0.012) * s,
      0,
      (streakX + 0.012) * s,
      0,
    );
    streak.addColorStop(0, "rgba(255, 255, 255, 0)");
    streak.addColorStop(0.5, "rgba(255, 255, 255, 0.45)");
    streak.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = streak;
    ctx.fillRect(0, 0, s, s);
  }
  return canvas;
}

function readNumber(
  style: CSSStyleDeclaration,
  cssVar: string,
  fallback: number,
) {
  const value = Number.parseFloat(style.getPropertyValue(cssVar));
  return Number.isFinite(value) ? value : fallback;
}

function readSettings(style: CSSStyleDeclaration): RibbonSettings {
  const settings = { ...DEFAULT_RIBBON_SETTINGS };
  for (const key of Object.keys(SETTING_VARS) as (keyof RibbonSettings)[]) {
    settings[key] = readNumber(
      style,
      SETTING_VARS[key],
      DEFAULT_RIBBON_SETTINGS[key],
    );
  }
  return settings;
}

function currentPose() {
  if (window.matchMedia("(max-width: 639px)").matches)
    return RIBBON_POSES.small;
  if (window.matchMedia("(max-width: 1263px)").matches)
    return RIBBON_POSES.medium;
  return RIBBON_POSES.wide;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Ribbon palette failed to load: ${src}`));
    image.src = src;
  });
}

const INTRO_STEP = 0.016;

export interface HeroRibbonProps {
  className?: string;
  /** Overrides {@link RIBBON_PALETTE_SRC}. */
  paletteSrc?: string | null;
  /** Holds the clock at this many ms (0 is the resting pose). */
  frozenAtMs?: number;
}

/**
 * A folded, twisting ribbon drawn with WebGL2 behind the hero copy. Every
 * parameter is a `--ribbon-*` custom property on the root, read each frame.
 */
export function HeroRibbon({
  className,
  paletteSrc = RIBBON_PALETTE_SRC,
  frozenAtMs,
}: HeroRibbonProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let renderer: RibbonRenderer | null = null;
    try {
      renderer = RibbonRenderer.create(canvas);
    } catch (error) {
      console.error(error);
    }
    if (!renderer) {
      root.dataset.ribbonState = "fallback";
      return;
    }
    const ribbon = renderer;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let paletteKey = "";
    let paletteReady = false;
    let visible = true;
    let frameId = 0;
    let tick = 0;
    let clockMs = frozenAtMs ?? 0;
    let intro = frozenAtMs === undefined && !reducedMotion.matches ? 0 : 1;
    let lastTime: number | null = null;
    let disposed = false;

    const syncPalette = (style: CSSStyleDeclaration) => {
      if (paletteSrc) return;
      const colors = PALETTE_COLOR_VARS.map((name) =>
        style.getPropertyValue(name).trim(),
      );
      const key = colors.join("|");
      if (key === paletteKey) return;
      paletteKey = key;
      ribbon.setPalette(paintPalette(colors), "linear");
      paletteReady = true;
    };

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ribbon.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
    };

    const drawFrame = () => {
      if (!paletteReady) return;
      const style = getComputedStyle(root);
      syncPalette(style);
      ribbon.draw(clockMs, currentPose(), readSettings(style));
      root.dataset.ribbonState = "drawn";
    };

    const animate = (now: number) => {
      frameId = requestAnimationFrame(animate);
      tick += 1;
      if (tick % 2 !== 0) return;
      const style = getComputedStyle(root);
      if (lastTime !== null) {
        clockMs +=
          (now - lastTime) * intro * readNumber(style, SETTING_VARS.speed, 1);
      }
      lastTime = now;
      drawFrame();
      intro = Math.min(1, intro + INTRO_STEP);
    };

    const shouldAnimate = () =>
      visible &&
      !document.hidden &&
      !reducedMotion.matches &&
      frozenAtMs === undefined;

    const sync = () => {
      cancelAnimationFrame(frameId);
      lastTime = null;
      if (shouldAnimate()) frameId = requestAnimationFrame(animate);
      else drawFrame();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { rootMargin: "20px 0px" },
    );
    const resizeObserver = new ResizeObserver(() => {
      resize();
      drawFrame();
    });

    resize();
    syncPalette(getComputedStyle(root));
    if (paletteSrc) {
      loadImage(paletteSrc).then(
        (image) => {
          if (disposed) return;
          ribbon.setPalette(image, "srgb");
          paletteReady = true;
          drawFrame();
        },
        (error) => {
          console.error(error);
          root.dataset.ribbonState = "fallback";
        },
      );
    }
    observer.observe(root);
    resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    sync();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      ribbon.dispose();
    };
  }, [paletteSrc, frozenAtMs]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-agent-native-node-id="hero-ribbon"
      data-agent-native-layer-name="Ribbon effect"
      data-ribbon-state="loading"
      className={["group pointer-events-none overflow-hidden", className]
        .filter(Boolean)
        .join(" ")}
      style={KNOB_DEFAULTS}
    >
      <div className="absolute -top-[64px] left-[calc(50%_-_min(var(--site-max-width),100%)/2_+_250px)] h-[calc(100%_+_64px)] w-[calc(min(var(--site-max-width),100%)*1.1)] max-[1263px]:left-0 max-[1263px]:w-full">
        <div
          data-agent-native-node-id="hero-ribbon-fallback"
          data-agent-native-layer-name="Ribbon fallback"
          className="absolute inset-0 group-data-[ribbon-state=drawn]:hidden"
        >
          <div className="absolute left-[18%] top-[-20%] h-[150%] w-[26%] rotate-[-38deg] rounded-full bg-[linear-gradient(to_bottom,var(--ribbon-color-3),var(--ribbon-color-1),var(--ribbon-color-2),var(--ribbon-color-4))] opacity-60 blur-[48px]" />
        </div>
        <canvas
          ref={canvasRef}
          data-agent-native-node-id="hero-ribbon-canvas"
          data-agent-native-layer-name="Ribbon canvas"
          className="absolute inset-0 size-full"
        />
      </div>
    </div>
  );
}
