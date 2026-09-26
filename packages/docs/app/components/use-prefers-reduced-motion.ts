import { useEffect, useState } from "react";
import type { RefObject } from "react";

type MotionPreference = {
  current: boolean | null;
  initial: boolean | null;
  autoplayStopped: boolean;
};

/**
 * Tracks `prefers-reduced-motion: reduce`. Starts `null` (unresolved — SSR
 * and the first client paint have no answer yet) so autoplay stays off until
 * the browser preference is known. A runtime change to `reduce` pauses and
 * stops autoplay for this page load.
 */
export function usePrefersReducedMotion(
  videoRef: RefObject<HTMLVideoElement | null>,
): MotionPreference {
  const [preference, setPreference] = useState<MotionPreference>({
    current: null,
    initial: null,
    autoplayStopped: false,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      setPreference({ current: false, initial: false, autoplayStopped: false });
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    let wasReduced = query.matches;
    setPreference({
      current: query.matches,
      initial: query.matches,
      autoplayStopped: query.matches,
    });
    const onChange = (event: MediaQueryListEvent) => {
      if (!wasReduced && event.matches) {
        videoRef.current?.pause();
        setPreference((current) => ({
          ...current,
          current: event.matches,
          autoplayStopped: true,
        }));
      } else {
        setPreference((current) => ({
          ...current,
          current: event.matches,
        }));
      }
      wasReduced = event.matches;
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [videoRef]);

  return preference;
}
