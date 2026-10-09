import { useCallback, useEffect, useState } from "react";

import { HeroOceanBackground } from "./ocean/hero-ocean-background.js";
import { probeWebgpuSupport } from "./ocean/webgpu-support.js";

type Background = "probing" | "ocean-loading" | "ocean" | "empty";

export interface WaveBackgroundProps {
  className?: string;
}

export function WaveBackground({ className = "" }: WaveBackgroundProps) {
  const [background, setBackground] = useState<Background>("probing");

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let cancelled = false;
    let probeId = 0;

    const checkSupport = async () => {
      const currentProbe = ++probeId;
      if (reduced?.matches) {
        setBackground("empty");
        return;
      }

      setBackground("probing");
      try {
        const support = await probeWebgpuSupport();
        if (cancelled || currentProbe !== probeId) return;
        if (support === "supported") {
          setBackground("ocean-loading");
          return;
        }
        if (support === "probe-failed") {
          console.error(
            "Could not check WebGPU support for the wave background",
          );
        }
        setBackground("empty");
      } catch (error) {
        if (cancelled || currentProbe !== probeId) return;
        console.error(
          "Could not check WebGPU support for the wave background",
          error,
        );
        setBackground("empty");
      }
    };

    const handleMotionPreferenceChange = () => {
      void checkSupport();
    };

    void checkSupport();
    reduced?.addEventListener("change", handleMotionPreferenceChange);
    return () => {
      cancelled = true;
      reduced?.removeEventListener("change", handleMotionPreferenceChange);
    };
  }, []);

  const handleOceanError = useCallback((error: unknown) => {
    console.error("Could not start the ocean wave background", error);
    setBackground("empty");
  }, []);
  const handleOceanReady = useCallback(() => setBackground("ocean"), []);

  if (background !== "ocean-loading" && background !== "ocean") return null;

  return (
    <HeroOceanBackground
      className={className}
      onError={handleOceanError}
      onReady={handleOceanReady}
    />
  );
}
