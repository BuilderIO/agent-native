import { useCallback, useEffect, useState } from "react";

import { HeroOceanBackground } from "./ocean/hero-ocean-background.js";
import { probeWebgpuSupport } from "./ocean/webgpu-support.js";
import { WebGlWaveBackground } from "./WebGlWaveBackground.js";

type Background = "probing" | "ocean-loading" | "ocean" | "fallback";

export interface WaveBackgroundProps {
  className?: string;
}

export function WaveBackground({ className = "" }: WaveBackgroundProps) {
  const [background, setBackground] = useState<Background>("probing");

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced?.matches) {
      setBackground("fallback");
      return;
    }

    let cancelled = false;
    void probeWebgpuSupport().then((support) => {
      if (!cancelled) {
        setBackground(support === "supported" ? "ocean-loading" : "fallback");
      }
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

  const handleOceanError = useCallback(() => setBackground("fallback"), []);
  const handleOceanReady = useCallback(() => setBackground("ocean"), []);

  return (
    <>
      {background !== "ocean" ? (
        <WebGlWaveBackground
          className={className}
          style={{ opacity: "var(--b-hero-shader-opacity, 0.3)" }}
        />
      ) : null}
      {background === "ocean-loading" || background === "ocean" ? (
        <HeroOceanBackground
          className={className}
          onError={handleOceanError}
          onReady={handleOceanReady}
        />
      ) : null}
    </>
  );
}
