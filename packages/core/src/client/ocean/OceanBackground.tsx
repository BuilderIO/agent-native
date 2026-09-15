import { useCallback, useEffect, useState } from "react";

import { StarfieldBackground } from "../StarfieldBackground.js";
import { HeroOceanBackground } from "./hero-ocean-background.js";
import { probeWebgpuSupport } from "./webgpu-support.js";

type Background = "probing" | "ocean" | "fallback";

export function OceanBackground({
  className,
  frameRate = 30,
}: {
  className: string;
  frameRate?: number;
}) {
  const [background, setBackground] = useState<Background>("probing");

  useEffect(() => {
    let cancelled = false;
    let probeId = 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const probe = () => {
      const currentProbe = ++probeId;
      if (reduced?.matches) {
        setBackground("fallback");
        return;
      }

      setBackground("probing");
      void probeWebgpuSupport().then((support) => {
        if (!cancelled && currentProbe === probeId && !reduced?.matches)
          setBackground(support === "supported" ? "ocean" : "fallback");
      });
    };

    const handleReducedMotionChange = () => probe();
    if (reduced) {
      if (typeof reduced.addEventListener === "function")
        reduced.addEventListener("change", handleReducedMotionChange);
      else reduced.addListener(handleReducedMotionChange);
    }

    probe();
    return () => {
      cancelled = true;
      if (!reduced) return;
      if (typeof reduced.removeEventListener === "function")
        reduced.removeEventListener("change", handleReducedMotionChange);
      else reduced.removeListener(handleReducedMotionChange);
    };
  }, []);

  const handleOceanError = useCallback(() => setBackground("fallback"), []);

  if (background === "ocean") {
    return (
      <HeroOceanBackground
        className={className}
        frameRate={frameRate}
        onError={handleOceanError}
      />
    );
  }

  return <StarfieldBackground className={className} frameRate={frameRate} />;
}
