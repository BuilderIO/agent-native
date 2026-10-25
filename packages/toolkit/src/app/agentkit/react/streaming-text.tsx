import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

// The pacer module itself, not the agentkit barrel: markdown renderers import
// this file, and the barrel would drag the composer into every one of them.
import {
  SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
  StreamingRevealPacer,
} from "../../../streaming-text-smoothing.js";

interface BufferedTextCacheEntry {
  targetText: string;
  visibleText: string;
}

// Grouped message parts are rebuilt as tool calls arrive, so a text part can
// unmount and mount again with the same identity. Keeping the reveal position
// outside that subtree lets a structural update continue from where it was
// instead of replaying the opening sentence.
const bufferedTextCache = new Map<string, BufferedTextCacheEntry>();
const maximumCacheEntries = 128;
const backgroundCatchUpCharacters = 2_000;
const backgroundTailCharacters = 200;

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

export function usePrefersReducedMotion(): boolean {
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

/**
 * The character offset from which newly revealed text fades in, or null when
 * nothing should animate. It is fixed the first time the text is seen
 * streaming, so text already on screen at mount (history, a remount mid-stream)
 * never fades again, and stays fixed after the stream ends so the rendered
 * structure does not change when it does.
 */
export function useStreamingRevealOrigin(
  visibleLength: number,
  streaming: boolean,
): number | null {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [origin, setOrigin] = useState<number | null>(() =>
    streaming && !prefersReducedMotion ? visibleLength : null,
  );
  if (origin === null && streaming && !prefersReducedMotion) {
    setOrigin(visibleLength);
  }
  return prefersReducedMotion ? null : origin;
}

/** Advances `visible` toward `target` by one animation frame of reveal. */
export function advanceBufferedText(
  visible: string,
  target: string,
  { inputDone = false }: { inputDone?: boolean } = {},
): string {
  if (!target.startsWith(visible)) return target;
  const pacer = new StreamingRevealPacer();
  pacer.setTarget(target, { inputDone });
  pacer.restoreVisibleLength(visible.length);
  pacer.step(SMOOTH_STREAMING_COMMIT_INTERVAL_MS);
  return pacer.visibleText;
}

export interface UseBufferedAgentTextOptions {
  active: boolean;
  resetKey: string;
  frameMs?: number;
}

export function useBufferedAgentText(
  text: string,
  {
    active,
    resetKey,
    frameMs = SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
  }: UseBufferedAgentTextOptions,
): string {
  // Reduced motion drops the fade and the scroll glide, not this pacing: an
  // unpaced reveal lands a whole network chunk at once and jumps the pinned
  // transcript by several lines.
  const [visible, setVisible] = useState(() => {
    if (!active) return text;
    return cachedBufferedText(resetKey, text) ?? "";
  });
  const visibleRef = useRef(visible);
  const pacerRef = useRef<StreamingRevealPacer | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastCommitAtRef = useRef<number | null>(null);
  const resetKeyRef = useRef(resetKey);
  const cacheKeyRef = useRef(resetKey);
  const cacheActiveRef = useRef(active);
  const stepRef = useRef<(time: number) => void>(() => {});

  cacheKeyRef.current = resetKey;
  cacheActiveRef.current = active;

  const pacer = () => {
    pacerRef.current ??= new StreamingRevealPacer();
    return pacerRef.current;
  };

  const commitVisible = useCallback((nextText: string) => {
    if (visibleRef.current !== nextText) {
      visibleRef.current = nextText;
      setVisible(nextText);
    }
    const target = pacerRef.current?.target ?? nextText;
    if (cacheActiveRef.current) {
      remember(cacheKeyRef.current, target, nextText);
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
  }, []);

  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      pacerRef.current?.revealAll();
      commitVisible(pacerRef.current?.visibleText ?? "");
      return;
    }
    frameRef.current = window.requestAnimationFrame((time) => {
      frameRef.current = null;
      stepRef.current(time);
    });
  }, [commitVisible]);

  stepRef.current = (time) => {
    const current = pacerRef.current;
    // step() can settle the pacer, so this check must not leave
    // `current.settled` narrowed to false for the one after it.
    const settledBefore = current?.settled ?? true;
    if (!current || settledBefore) return;
    const lastCommitAt = lastCommitAtRef.current;
    if (lastCommitAt !== null && time - lastCommitAt < frameMs - 1) {
      scheduleFrame();
      return;
    }
    lastCommitAtRef.current = time;
    // Rendered inside the frame, so each step paints on its own; a deferred
    // render would merge several steps' words into one frame.
    if (current.step(time)) {
      flushSync(() => commitVisible(current.visibleText));
    }
    if (!current.settled) scheduleFrame();
  };

  useEffect(() => {
    const keyChanged = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;
    const shouldDrain =
      !keyChanged &&
      !active &&
      visibleRef.current.length > 0 &&
      visibleRef.current !== text &&
      text.startsWith(visibleRef.current);

    if (!shouldDrain && !active) {
      cancelFrame();
      pacerRef.current = null;
      lastCommitAtRef.current = null;
      if (visibleRef.current !== text) {
        visibleRef.current = text;
        setVisible(text);
      }
      return;
    }

    let current = pacer();
    if (keyChanged || !text.startsWith(visibleRef.current)) {
      current = new StreamingRevealPacer();
      pacerRef.current = current;
      lastCommitAtRef.current = null;
      current.setTarget(text, { inputDone: shouldDrain });
      commitVisible("");
    } else {
      const fresh = current.target === "" && visibleRef.current.length > 0;
      current.setTarget(text, { inputDone: shouldDrain });
      if (fresh) current.restoreVisibleLength(visibleRef.current.length);
      if (current.visibleText !== visibleRef.current) {
        commitVisible(current.visibleText);
      }
    }
    if (!current.settled) scheduleFrame();
  }, [active, cancelFrame, commitVisible, resetKey, scheduleFrame, text]);

  useEffect(() => {
    if (!active) return;
    remember(resetKey, text, visible);
  }, [active, resetKey, text, visible]);

  // A background tab pauses animation frames while text keeps arriving.
  // Replaying minutes of backlog on return would make the reader wait, so only
  // the last few lines animate in.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      const current = pacerRef.current;
      if (document.visibilityState !== "visible" || !current) return;
      if (
        current.target.length - current.visibleLength <=
        backgroundCatchUpCharacters
      ) {
        return;
      }
      current.jumpNearEnd(backgroundTailCharacters);
      commitVisible(current.visibleText);
      scheduleFrame();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [commitVisible, scheduleFrame]);

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
