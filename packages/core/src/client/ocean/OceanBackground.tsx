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
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced?.matches) {
      setBackground("fallback");
      return;
    }

    let cancelled = false;
    void probeWebgpuSupport().then((support) => {
      if (!cancelled)
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
