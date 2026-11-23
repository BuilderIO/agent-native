import { useEffect, useRef, type CSSProperties } from "react";

import {
  createRibbonRenderer,
  RIBBON_BACKDROP_VAR,
  RIBBON_COLOR_VARS,
  RIBBON_KNOBS,
  type RibbonKnob,
} from "./folded-ribbon-renderer";

/**
 * Colour stops for the ribbon's soft palette, from the brand tokens. Swap any
 * entry (or override the matching `--ribbon-color-N` property) to recolour it.
 */
export const RIBBON_PALETTE = [
  "var(--c-blue-300)",
  "var(--c-violet-400)",
  "var(--c-blue-600)",
  "var(--c-green-400)",
  "var(--c-blue-100)",
  "var(--c-blue-900)",
] as const;

export interface FoldedRibbonProps {
  className?: string;
  palette?: readonly string[];
  /** Overrides for the `--ribbon-*` knobs; anything omitted keeps its default. */
  knobs?: Partial<Record<RibbonKnob, number>>;
}

export function FoldedRibbon({
  className,
  palette = RIBBON_PALETTE,
  knobs,
}: FoldedRibbonProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: ReturnType<typeof createRibbonRenderer> = null;
    try {
      renderer = createRibbonRenderer(canvas, { knobSource: root, still });
    } catch {
      renderer = null;
    }
    if (!renderer) {
      root.dataset.ribbon = "unavailable";
      return;
    }
    root.dataset.ribbon = "drawn";
    const active = renderer;

    let resizeTimer = 0;
    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => active.resize(), 300);
    });
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(
      ([entry]) => active.setVisible(Boolean(entry?.isIntersecting)),
      { rootMargin: "20px 0px" },
    );
    intersection.observe(root);

    return () => {
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      intersection.disconnect();
      active.dispose();
    };
  }, []);

  const style: Record<string, string | number> = {
    [RIBBON_BACKDROP_VAR]: "var(--b-bg-page)",
  };
  for (const [name, value] of Object.entries(RIBBON_KNOBS)) {
    style[name] = knobs?.[name as RibbonKnob] ?? value;
  }
  RIBBON_COLOR_VARS.forEach((name, index) => {
    const color = palette[index];
    if (color) style[name] = color;
  });

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={["pointer-events-none", className].filter(Boolean).join(" ")}
      style={style as CSSProperties}
    >
      <div className="relative mx-auto h-full w-full max-w-site">
        {/* Starts right of centre and overflows past the right edge, so the
            fold sweeps in from the upper right and exits below the fold. */}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-[250px] h-full w-[110%] max-[639px]:left-0"
        />
      </div>
    </div>
  );
}
