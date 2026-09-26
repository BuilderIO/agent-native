import { useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Tracks `prefers-reduced-motion: reduce`. Starts `null` (unresolved — SSR
 * and the first client paint have no answer yet) so autoplay stays off until
 * the browser preference is known. Pauses the video if reduce is enabled
 * during playback.
 */
export function usePrefersReducedMotion(
  videoRef: RefObject<HTMLVideoElement | null>,
): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      setReduced(false);
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    let wasReduced = query.matches;
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => {
      if (!wasReduced && event.matches) videoRef.current?.pause();
      wasReduced = event.matches;
      setReduced(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [videoRef]);

  return reduced;
}
