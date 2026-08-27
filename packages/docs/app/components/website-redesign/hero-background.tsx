import { useCallback, useEffect, useState } from "react";

import { HeroShaderBackground } from "./hero-shader-background";
// DEV-ONLY import -- remove with the ocean preset switcher.
import { useOceanPreset } from "./ocean/dev-preset-switcher";
import { HeroOceanBackground } from "./ocean/hero-ocean-background";
import { probeWebgpuSupport } from "./ocean/webgpu-support";

type Background = "probing" | "ocean" | "fallback";

/**
 * Picks the hero's background. The WebGPU ocean when the browser can actually
 * run it, the WebGL halftone field otherwise -- never nothing. A hero that
 * renders as an empty box is the failure this component exists to prevent, so
 * every GPU outcome that is not a working device lands on the fallback.
 */
export function HeroBackground() {
  const [background, setBackground] = useState<Background>("probing");
  // DEV-ONLY -- remove with the ocean preset switcher.
  const { remountKey } = useOceanPreset();

  useEffect(() => {
    // Reduced motion short-circuits ahead of the probe: the fallback already
    // has a designed static draw, and a frozen ocean is a stalled simulation
    // rather than a composition.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced?.matches) {
      setBackground("fallback");
      return;
    }

    let cancelled = false;
    void probeWebgpuSupport().then((support) => {
      if (cancelled) return;
      setBackground(support === "supported" ? "ocean" : "fallback");
    });

    const demoteToFallback = () => {
      if (!cancelled) setBackground("fallback");
    };
    reduced?.addEventListener("change", demoteToFallback);
    return () => {
      cancelled = true;
      reduced?.removeEventListener("change", demoteToFallback);
    };
  }, []);

  // A renderer that fails after a good probe -- device lost, shader compile,
  // out of memory -- is still a broken hero, so it demotes the same way.
  const handleOceanError = useCallback(() => setBackground("fallback"), []);

  if (background === "ocean") {
    return <HeroOceanBackground key={remountKey} onError={handleOceanError} />;
  }
  // "probing" renders the halftone too, so the hero is never bare while the
  // adapter request is in flight.
  return <HeroShaderBackground />;
}
