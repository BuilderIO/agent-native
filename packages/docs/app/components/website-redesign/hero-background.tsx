import { useCallback, useEffect, useState } from "react";

import { HeroShaderBackground } from "./hero-shader-background";
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

    // Overlap the chunk fetch with the adapter request instead of waiting for
    // it. Gated on the namespace existing, so a browser without WebGPU still
    // never downloads the renderer -- it only stops the fetch and the probe
    // from running one after the other on browsers that will use it.
    if ("gpu" in navigator) void import("./ocean/hero-ocean-background");

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

  if (background === "ocean")
    return <HeroOceanBackground onError={handleOceanError} />;

  // Nothing at all while probing. The halftone is the *fallback*, not a
  // placeholder: showing it for the few hundred milliseconds before the ocean
  // fades in reads as a different background flashing up and being replaced.
  // The ocean starts fully transparent and its own zero tone resolves to
  // --b-bg-page, so an empty hero and a just-mounted ocean look identical.
  if (background === "probing") return null;

  return <HeroShaderBackground />;
}
