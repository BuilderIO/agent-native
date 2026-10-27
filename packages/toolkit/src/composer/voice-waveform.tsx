import { useEffect, useRef, useState } from "react";

import { cn } from "../utils.js";

const WAVEFORM_BAR_COUNT = 9;
const WAVEFORM_MIN_SCALE = 0.15;
const WAVEFORM_STILL_SCALE = 0.4;
const WAVEFORM_SAMPLE_MS = 70;

type ReducedMotionQuery = Pick<MediaQueryList, "matches"> & // i18n-ignore -- type intersection, not UI text
  Partial<Pick<MediaQueryList, "addEventListener" | "removeEventListener">>;

/** jsdom and some WebViews have no matchMedia; Safari before 14 has no query events. */
function reducedMotionQuery(): ReducedMotionQuery | undefined {
  if (typeof window === "undefined") return undefined;
  const { matchMedia } = window as Partial<Pick<Window, "matchMedia">>;
  return matchMedia?.call(window, "(prefers-reduced-motion: reduce)");
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    Boolean(reducedMotionQuery()?.matches),
  );
  useEffect(() => {
    const query = reducedMotionQuery();
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/**
 * A short rolling history of an audio level, newest bar on the right. Bars are
 * written from an animation frame so the level never re-renders the composer;
 * reduced motion keeps the bars still and fades with the level instead.
 */
export function VoiceLevelWaveform({
  read,
  live,
  className,
}: {
  /** The current level, 0 to 1, sampled every few frames. */
  read: () => number;
  live: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const readRef = useRef(read);
  readRef.current = read;
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    const bars = barRefs.current;
    const rest = () => {
      for (const bar of bars) {
        if (bar) bar.style.transform = `scaleY(${WAVEFORM_MIN_SCALE})`;
      }
      if (container) container.style.opacity = "";
    };
    if (!live) {
      rest();
      return;
    }
    const history = new Array<number>(WAVEFORM_BAR_COUNT).fill(0);
    let frame = 0;
    let lastSample = -Infinity;
    const draw = (now: number) => {
      if (now - lastSample >= WAVEFORM_SAMPLE_MS) {
        lastSample = now;
        const level = readRef.current();
        if (reducedMotion) {
          if (container) container.style.opacity = String(0.45 + level * 0.55);
        } else {
          history.shift();
          history.push(level);
          history.forEach((value, index) => {
            const bar = bars[index];
            if (bar) {
              bar.style.transform = `scaleY(${WAVEFORM_MIN_SCALE + value * (1 - WAVEFORM_MIN_SCALE)})`;
            }
          });
        }
      }
      frame = requestAnimationFrame(draw);
    };
    if (reducedMotion) {
      for (const bar of bars) {
        if (bar) bar.style.transform = `scaleY(${WAVEFORM_STILL_SCALE})`;
      }
    }
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      rest();
    };
  }, [live, reducedMotion]);

  return (
    <span
      ref={containerRef}
      aria-hidden="true"
      data-voice-waveform=""
      className={cn(
        "flex h-3.5 shrink-0 items-center gap-0.5 transition-opacity duration-200 motion-reduce:transition-none",
        className,
      )}
    >
      {Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => (
        <span
          key={index}
          ref={(node) => {
            barRefs.current[index] = node;
          }}
          data-voice-waveform-bar=""
          className="h-full w-0.5 origin-center rounded-full bg-current transition-transform duration-75 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleY(${WAVEFORM_MIN_SCALE})` }}
        />
      ))}
    </span>
  );
}
