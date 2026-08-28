import { useCallback, useEffect, useState } from "react";

import { useShellSettled } from "../../shell-ready";
import { HeroShaderBackground } from "./hero-shader-background";
import { HeroOceanBackground } from "./ocean/hero-ocean-background";
import { probeWebgpuSupport, type WebgpuSupport } from "./ocean/webgpu-support";

type Background = "probing" | "ocean" | "fallback";

// Module scope, not per-mount. The hero remounts whenever its ancestor chain
// changes, and a second mount that went back through `probing` would render
// null for the length of another adapter request -- the hero blanking out and
// coming back. The decision is a property of this GPU, not of this mount.
let resolvedBackground: Background | undefined;
let pendingProbe: Promise<WebgpuSupport> | undefined;
// Same reasoning for the ocean's 700ms reveal: it is the page's introduction,
// so a remount must pick up where the last one left off rather than fade in a
// second time.
let oceanIntroPlayed = false;

function markOceanIntroPlayed() {
  oceanIntroPlayed = true;
}

/**
 * Picks the hero's background. The WebGPU ocean when the browser can actually
 * run it, the WebGL halftone field otherwise -- never nothing. A hero that
 * renders as an empty box is the failure this component exists to prevent, so
 * every GPU outcome that is not a working device lands on the fallback.
 */
export function HeroBackground() {
  const [background, setBackground] = useState<Background>("probing");
  // The root shell swaps its whole subtree in when the agent sidebar's chunk
  // resolves, which remounts everything below it. Starting before that means
  // building the GPU graph, throwing it away mid-fade, and building it again --
  // the hero visibly flashed between the two. Waiting costs a few hundred
  // milliseconds of plain background and buys a single, uninterrupted mount.
  const shellSettled = useShellSettled();

  useEffect(() => {
    if (!shellSettled) return;

    // Reduced motion short-circuits ahead of the probe: the fallback already
    // has a designed static draw, and a frozen ocean is a stalled simulation
    // rather than a composition.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced?.matches) {
      resolvedBackground = "fallback";
      setBackground("fallback");
      return;
    }

    let cancelled = false;

    // Overlap the chunk fetch with the adapter request instead of waiting for
    // it. Gated on the namespace existing, so a browser without WebGPU still
    // never downloads the renderer -- it only stops the fetch and the probe
    // from running one after the other on browsers that will use it.
    if ("gpu" in navigator) void import("./ocean/hero-ocean-background");

    pendingProbe ??= probeWebgpuSupport();
    void pendingProbe.then((support) => {
      resolvedBackground = support === "supported" ? "ocean" : "fallback";
      if (!cancelled) setBackground(resolvedBackground);
    });

    const demoteToFallback = () => {
      resolvedBackground = "fallback";
      if (!cancelled) setBackground("fallback");
    };
    reduced?.addEventListener("change", demoteToFallback);
    return () => {
      cancelled = true;
      reduced?.removeEventListener("change", demoteToFallback);
    };
  }, [shellSettled]);

  // A renderer that fails after a good probe -- device lost, shader compile,
  // out of memory -- is still a broken hero, so it demotes the same way, and
  // the demotion sticks: a remount must not retry a device that just died.
  const handleOceanError = useCallback(() => {
    resolvedBackground = "fallback";
    setBackground("fallback");
  }, []);

  if (background === "ocean")
    return (
      <HeroOceanBackground
        onError={handleOceanError}
        introPlayed={oceanIntroPlayed}
        onFirstFrame={markOceanIntroPlayed}
      />
    );

  // Nothing at all while probing. The halftone is the *fallback*, not a
  // placeholder: showing it for the few hundred milliseconds before the ocean
  // fades in reads as a different background flashing up and being replaced.
  // The ocean starts fully transparent and its own zero tone resolves to
  // --b-bg-page, so an empty hero and a just-mounted ocean look identical.
  if (background === "probing") return null;

  return <HeroShaderBackground />;
}
