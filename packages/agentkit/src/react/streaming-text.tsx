import {
  initialSmoothStreamingGraphemeCount,
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
  SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
} from "@agent-native/toolkit/agentkit";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface BufferedTextCacheEntry {
  targetText: string;
  visibleText: string;
}

const bufferedTextCache = new Map<string, BufferedTextCacheEntry>();
const maximumCacheEntries = 128;
const emptyGraphemes: string[] = [];

function cachedBufferedText(
  resetKey: string,
  targetText: string,
): string | undefined {
  const cached = bufferedTextCache.get(resetKey);
  if (!cached) return undefined;
  return targetText.startsWith(cached.targetText) &&
    targetText.startsWith(cached.visibleText)
    ? cached.visibleText
    : undefined;
}

function remember(
  resetKey: string,
  targetText: string,
  visibleText: string,
): void {
  bufferedTextCache.delete(resetKey);
  bufferedTextCache.set(resetKey, { targetText, visibleText });
  if (bufferedTextCache.size <= maximumCacheEntries) return;
  const oldest = bufferedTextCache.keys().next().value;
  if (oldest !== undefined) bufferedTextCache.delete(oldest);
}

function sliceGraphemes(
  targetText: string,
  graphemes: readonly string[],
  count: number,
): string {
  if (count >= graphemes.length) return targetText;
  if (count <= 0) return "";
  return graphemes.slice(0, count).join("");
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(media.matches);
    handleChange();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return prefersReducedMotion;
}

/** Advances one synthetic frame for non-React consumers and focused tests. */
export function advanceBufferedText(visible: string, target: string): string {
  if (!target.startsWith(visible)) return target;
  const targetGraphemes = splitStreamingTextGraphemes(target);
  const visibleCount = splitStreamingTextGraphemes(visible).length;
  const backlog = targetGraphemes.length - visibleCount;
  if (backlog <= 0) return target;
  const revealCount = smoothStreamingRevealCount({
    backlog,
    elapsedMs: SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
  });
  return sliceGraphemes(target, targetGraphemes, visibleCount + revealCount);
}

export interface UseBufferedAgentTextOptions {
  active: boolean;
  resetKey: string;
  frameMs?: number;
}

/** Smooths irregular transport chunks into animation-frame-paced text. */
export function useBufferedAgentText(
  text: string,
  {
    active,
    resetKey,
    frameMs = SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
  }: UseBufferedAgentTextOptions,
): string {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(() => {
    if (!active || prefersReducedMotion) return text;
    const cached = cachedBufferedText(resetKey, text);
    if (cached !== undefined) return cached;
    const targetGraphemes = splitStreamingTextGraphemes(text);
    return sliceGraphemes(
      text,
      targetGraphemes,
      initialSmoothStreamingGraphemeCount(targetGraphemes),
    );
  });
  const visibleRef = useRef(visible);
  const targetRef = useRef(text);
  const targetGraphemesRef = useRef<string[]>(emptyGraphemes);
  const visibleCountRef = useRef(-1);
  if (visibleCountRef.current < 0) {
    if (active && !prefersReducedMotion) {
      targetGraphemesRef.current = splitStreamingTextGraphemes(text);
      visibleCountRef.current = splitStreamingTextGraphemes(visible).length;
    } else {
      visibleCountRef.current = 0;
    }
  }
  const frameRef = useRef<number | null>(null);
  const lastCommitAtRef = useRef(0);
  const pauseUntilRef = useRef(0);
  const inputDoneRef = useRef(false);
  const resetKeyRef = useRef(resetKey);
  const cacheKeyRef = useRef(resetKey);
  const cacheActiveRef = useRef(active);
  const cacheReducedMotionRef = useRef(prefersReducedMotion);
  const stepRef = useRef<(time: number) => void>(() => {});

  cacheKeyRef.current = resetKey;
  cacheActiveRef.current = active;
  cacheReducedMotionRef.current = prefersReducedMotion;

  const commitVisibleCount = useCallback((nextCount: number) => {
    const targetGraphemes = targetGraphemesRef.current;
    const boundedCount = Math.max(
      0,
      Math.min(nextCount, targetGraphemes.length),
    );
    const nextText = sliceGraphemes(
      targetRef.current,
      targetGraphemes,
      boundedCount,
    );
    visibleCountRef.current = boundedCount;
    if (visibleRef.current !== nextText) {
      visibleRef.current = nextText;
      setVisible(nextText);
    }
    if (cacheActiveRef.current && !cacheReducedMotionRef.current) {
      remember(cacheKeyRef.current, targetRef.current, nextText);
    }
  }, []);

  const cancelFrame = useCallback(() => {
    if (
      frameRef.current !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
    pauseUntilRef.current = 0;
  }, []);

  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      commitVisibleCount(targetGraphemesRef.current.length);
      return;
    }
    frameRef.current = window.requestAnimationFrame((time) => {
      frameRef.current = null;
      stepRef.current(time);
    });
  }, [commitVisibleCount]);

  stepRef.current = (time) => {
    const targetGraphemes = targetGraphemesRef.current;
    const backlog = targetGraphemes.length - visibleCountRef.current;
    if (backlog <= 0) {
      pauseUntilRef.current = 0;
      return;
    }
    if (pauseUntilRef.current > time) {
      scheduleFrame();
      return;
    }

    const lastCommitAt = lastCommitAtRef.current || time - frameMs;
    if (time - lastCommitAt < frameMs && backlog > 1) {
      scheduleFrame();
      return;
    }
    const revealCount = smoothStreamingRevealCount({
      backlog,
      elapsedMs: Math.min(120, Math.max(8, time - lastCommitAt)),
      inputDone: inputDoneRef.current,
    });
    if (revealCount > 0) {
      commitVisibleCount(visibleCountRef.current + revealCount);
      lastCommitAtRef.current = time;
      const nextBacklog = targetGraphemes.length - visibleCountRef.current;
      const pauseMs = smoothStreamingPunctuationDelayMs(
        targetGraphemes[visibleCountRef.current - 1],
        nextBacklog,
      );
      pauseUntilRef.current = pauseMs > 0 ? time + pauseMs : 0;
    }
    if (visibleCountRef.current < targetGraphemes.length) {
      scheduleFrame();
    } else {
      pauseUntilRef.current = 0;
    }
  };

  useEffect(() => {
    targetRef.current = text;
    const keyChanged = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;
    const targetGraphemes = splitStreamingTextGraphemes(text);
    const shouldDrain =
      !keyChanged &&
      !active &&
      !prefersReducedMotion &&
      visibleRef.current.length > 0 &&
      visibleRef.current !== text &&
      text.startsWith(visibleRef.current);

    if (shouldDrain) {
      targetGraphemesRef.current = targetGraphemes;
      inputDoneRef.current = true;
      scheduleFrame();
      return;
    }

    if (!active || prefersReducedMotion) {
      cancelFrame();
      inputDoneRef.current = false;
      targetGraphemesRef.current = emptyGraphemes;
      visibleCountRef.current = 0;
      if (visibleRef.current !== text) {
        visibleRef.current = text;
        setVisible(text);
      }
      return;
    }

    targetGraphemesRef.current = targetGraphemes;
    inputDoneRef.current = false;
    const visibleNoLongerMatches =
      visibleRef.current.length > 0 && !text.startsWith(visibleRef.current);
    if (
      keyChanged ||
      visibleNoLongerMatches ||
      visibleCountRef.current > targetGraphemes.length
    ) {
      commitVisibleCount(initialSmoothStreamingGraphemeCount(targetGraphemes));
      lastCommitAtRef.current = 0;
      pauseUntilRef.current = 0;
    }
    if (visibleCountRef.current < targetGraphemes.length) scheduleFrame();
  }, [
    active,
    cancelFrame,
    commitVisibleCount,
    prefersReducedMotion,
    resetKey,
    scheduleFrame,
    text,
  ]);

  useEffect(() => {
    if (!active || prefersReducedMotion) return;
    remember(resetKey, text, visible);
  }, [active, prefersReducedMotion, resetKey, text, visible]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== "visible" ||
        !active ||
        prefersReducedMotion
      ) {
        return;
      }
      const targetGraphemes = targetGraphemesRef.current;
      const backlog = targetGraphemes.length - visibleCountRef.current;
      if (backlog <= 2_000) return;
      commitVisibleCount(Math.max(0, targetGraphemes.length - 200));
      lastCommitAtRef.current = 0;
      pauseUntilRef.current = 0;
      scheduleFrame();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [active, commitVisibleCount, prefersReducedMotion, scheduleFrame]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return visible;
}

export interface AgentStreamingTextProps {
  text: string;
  active: boolean;
  resetKey: string;
  frameMs?: number;
  children?: (visibleText: string) => ReactNode;
}

export function AgentStreamingText({
  text,
  active,
  resetKey,
  frameMs,
  children,
}: AgentStreamingTextProps) {
  const visibleText = useBufferedAgentText(text, {
    active,
    resetKey,
    frameMs,
  });
  return children ? children(visibleText) : <Fragment>{visibleText}</Fragment>;
}
