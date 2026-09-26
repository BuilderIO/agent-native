import { useEffect, useRef, useState } from "react";

import { readOceanColors } from "./brand-colors";
import type { OceanRenderer } from "./renderer";
import { OCEAN_TUNING } from "./tuning";

const FADE_IN_MS = 700;

export interface HeroOceanBackgroundProps {
  onError: (error: unknown) => void;
  frameRate?: number;
}

type PointerTarget = readonly [number, number, number];

export function HeroOceanBackground({
  onError,
  frameRate = 30,
}: HeroOceanBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let renderer: OceanRenderer | undefined;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    let pointerTarget: PointerTarget = [0, 0, 0];
    let lastPointer: readonly [number, number] | undefined;

    const updatePointer = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const inside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;

      pointerTarget = [
        (x / rect.width) * 2 - 1,
        1 - (y / rect.height) * 2,
        inside ? 1 : 0,
      ];
      renderer?.setPointer(pointerTarget);
    };

    const handleMouseMove = (event: MouseEvent) => {
      lastPointer = [event.clientX, event.clientY];
      updatePointer(event.clientX, event.clientY);
    };

    const handleScroll = () => {
      if (!lastPointer) return;
      updatePointer(lastPointer[0], lastPointer[1]);
    };

    const fadePointer = () => {
      lastPointer = undefined;
      pointerTarget = [pointerTarget[0], pointerTarget[1], 0];
      renderer?.setPointer(pointerTarget);
    };

    document.body.addEventListener("mousemove", handleMouseMove, {
      passive: true,
    });
    document.body.addEventListener("mouseleave", fadePointer, {
      passive: true,
    });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("blur", fadePointer);
    cleanups.push(() => {
      document.body.removeEventListener("mousemove", handleMouseMove);
      document.body.removeEventListener("mouseleave", fadePointer);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("blur", fadePointer);
    });

    // Imported here rather than at module scope: the homepage is prerendered,
    void import("./renderer")
      .then(({ createRenderer }) => {
        if (cancelled) return;
        renderer = createRenderer({
          canvas,
          colors: readOceanColors(container),
          fps: frameRate,
          onError: (error) => onErrorRef.current(error),
        });
        renderer.setPointer(pointerTarget);

        void renderer.firstFrame
          .then(() => {
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

  const { bottomFadeStartPercent } = OCEAN_TUNING;
  const mask =
    bottomFadeStartPercent >= 100
      ? undefined
      : `linear-gradient(to bottom, #000 ${bottomFadeStartPercent}%, transparent 100%)`;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 z-[-1]"
      style={{
        opacity: ready ? "var(--b-hero-ocean-opacity)" : 0,
        transition: `opacity ${FADE_IN_MS}ms ease-out`,
        ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}),
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
