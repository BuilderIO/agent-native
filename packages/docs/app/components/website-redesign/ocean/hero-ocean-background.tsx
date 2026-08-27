import { useEffect, useRef } from "react";

import { readOceanColors } from "./brand-colors";
// Type-only, so this import is erased and the renderer stays off the static
// graph. Importing any *value* from ./renderer here (or from brand-colors)
// pulls the whole vgpu runtime into the homepage entry chunk -- which is
// exactly the regression ocean-colors.ts exists to prevent.
import type { OceanRenderer } from "./renderer";
import { OCEAN_TUNING } from "./tuning";

export interface HeroOceanBackgroundProps {
  /** Called on any GPU failure so the caller can swap in the fallback. */
  onError: (error: unknown) => void;
  frameRate?: number;
}

// Same box as HeroShaderBackground so the two are swappable without a layout
// shift: absolutely filling the hero's `position: relative` PageSection, behind
// the page-grid column dividers.
export function HeroOceanBackground({
  onError,
  frameRate = 30,
}: HeroOceanBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let renderer: OceanRenderer | undefined;
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    // Imported here rather than at module scope: the homepage is prerendered,
    // and the vgpu runtime is ~100x the size of this component. Nothing
    // downloads it until a browser has proven it can run it.
    void import("./renderer")
      .then(({ createRenderer }) => {
        if (cancelled) return;
        renderer = createRenderer({
          canvas,
          colors: readOceanColors(container),
          fps: frameRate,
          onError: (error) => onErrorRef.current(error),
        });

        const themeObserver = new MutationObserver(() => {
          renderer?.setColors(readOceanColors(container));
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme"],
        });
        cleanups.push(() => themeObserver.disconnect());

        // The hero scrolls out of view within one screen. An unpaused ocean
        // would keep a 512x512 IFFT and half a million particles running for
        // the whole rest of the page.
        const visibility = new IntersectionObserver(
          ([entry]) => renderer?.setPaused(!(entry?.isIntersecting ?? true)),
          { threshold: 0 },
        );
        visibility.observe(container);
        cleanups.push(() => visibility.disconnect());
      })
      .catch((error: unknown) => {
        if (!cancelled) onErrorRef.current(error);
      });

    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
      renderer?.dispose();
    };
  }, [frameRate]);

  // Inline because the stop position is a tuning value, and no Tailwind mask
  // utility takes an arbitrary percentage from a runtime constant. 100 means
  // the preset wants the canvas to reach the section edge unmasked.
  const { bottomFadeStartPercent } = OCEAN_TUNING;
  const mask =
    bottomFadeStartPercent >= 100
      ? undefined
      : `linear-gradient(to bottom, #000 ${bottomFadeStartPercent}%, transparent 100%)`;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 z-[-1] opacity-[var(--b-hero-ocean-opacity)]"
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
