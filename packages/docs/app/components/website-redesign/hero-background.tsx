import { useCallback, useEffect, useState } from "react";

import { useShellSettled } from "../../shell-ready";
import { HeroShaderBackground } from "./hero-shader-background";
import { HeroOceanBackground } from "./ocean/hero-ocean-background";
import { probeWebgpuSupport } from "./ocean/webgpu-support";

type Background = "probing" | "ocean" | "fallback";

export function HeroBackground() {
  const [background, setBackground] = useState<Background>("probing");
  const shellSettled = useShellSettled();

  useEffect(() => {
    if (!shellSettled) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced?.matches) {
      setBackground("fallback");
      return;
    }

    let cancelled = false;

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
  }, [shellSettled]);

  const handleOceanError = useCallback(() => setBackground("fallback"), []);

  if (background === "ocean")
    return <HeroOceanBackground onError={handleOceanError} />;

  if (background === "probing") return null;

  return <HeroShaderBackground />;
}
