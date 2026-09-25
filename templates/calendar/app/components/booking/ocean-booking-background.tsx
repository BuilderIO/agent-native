import { StarfieldBackground } from "@agent-native/core/client/ui";
import { useCallback, useEffect, useState } from "react";

import { HeroOceanBackground } from "./ocean/hero-ocean-background";
import { probeWebgpuSupport } from "./ocean/webgpu-support";

type Background = "probing" | "ocean" | "fallback";

export function OceanBookingBackground({ className }: { className: string }) {
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
      <HeroOceanBackground className={className} onError={handleOceanError} />
    );
  }

  if (background === "probing") return null;

  return (
    <StarfieldBackground
      className={`${className} opacity-[0.3] dark:opacity-[0.15]`}
    />
  );
}
