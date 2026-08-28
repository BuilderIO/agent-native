import { useEffect, useRef, useState } from "react";

import { readOceanColors } from "./brand-colors";
// Type-only, so this import is erased and the renderer stays off the static
// graph. Importing any *value* from ./renderer here (or from brand-colors)
// pulls the whole vgpu runtime into the homepage entry chunk -- which is
// exactly the regression ocean-colors.ts exists to prevent.
import type { OceanRenderer } from "./renderer";
import { OCEAN_TUNING } from "./tuning";

/** Matches the halftone shader's own intro fade so the two read as one system. */
const FADE_IN_MS = 700;

export interface HeroOceanBackgroundProps {
  /** Called on any GPU failure so the caller can swap in the fallback. */
  onError: (error: unknown) => void;
  /**
   * The intro fade belongs to the page load, not to the mount, so the caller
   * owns the flag: replaying it on a remount is the "fades in, then flashes,
   * then fades in again" the reconciler used to cause. Mirrors the halftone
   * fallback's `shaderEpoch`.
   */
  introPlayed?: boolean;
  /** Fired once the GPU has actually drawn, so the caller can set that flag. */
  onFirstFrame?: () => void;
  frameRate?: number;
}

// Same box as HeroShaderBackground so the two are swappable without a layout
// shift: absolutely filling the hero's `position: relative` PageSection, behind
// the page-grid column dividers.
export function HeroOceanBackground({
  onError,
  introPlayed = false,
  onFirstFrame,
  frameRate = 30,
}: HeroOceanBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Held for the life of the mount, so the flag flipping under us cannot turn
  // the transition back on halfway through this canvas's own reveal.
  const skipIntro = useRef(introPlayed).current;
  const [ready, setReady] = useState(skipIntro);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;

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

        // firstFrame, not ready: `ready` only means initialize() returned, so
        // the loop is registered but has not drawn yet, and it also fulfils
        // after a failed init. Fading on it shows an empty -- or dead --
        // canvas. It rejects on failure, which onError already handles.
        void renderer.firstFrame
          .then(() => {
            onFirstFrameRef.current?.();
            if (!cancelled) setReady(true);
          })
          .catch(() => {});

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
      // Opacity is inline rather than a class because it animates between 0
      // and a token value; the halftone underneath is still painting until
      // this reaches full, so the hero never shows a bare background.
      className="absolute inset-0 z-[-1]"
      style={{
        opacity: ready ? "var(--b-hero-ocean-opacity)" : 0,
        transition: skipIntro ? undefined : `opacity ${FADE_IN_MS}ms ease-out`,
        ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}),
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
