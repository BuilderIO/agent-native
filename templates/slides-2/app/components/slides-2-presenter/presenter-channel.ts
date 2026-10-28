import { useCallback, useEffect, useRef, useState } from "react";

export type PresenterBlackout = "black" | "white" | null;

export type Slides2PresenterState = {
  index: number;
  total: number;
  blackout: PresenterBlackout;
  startedAt: number;
  stepIndex?: number;
  stepCount?: number | null;
};

export type Slides2PresenterMessage =
  | { type: "state"; state: Slides2PresenterState }
  | { type: "request-state" }
  | { type: "goto"; index: number }
  | { type: "switch-deck"; deckId: string }
  | { type: "next" }
  | { type: "prev" }
  | { type: "toggle-blackout"; mode: Exclude<PresenterBlackout, null> };

type MessageHandler = (message: Slides2PresenterMessage) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPresenterState(value: unknown): value is Slides2PresenterState {
  if (!isRecord(value)) return false;
  const hasStepIndex = value.stepIndex !== undefined;
  const hasStepCount = value.stepCount !== undefined;
  const hasValidStepState =
    (!hasStepIndex && !hasStepCount) ||
    (hasStepIndex &&
      hasStepCount &&
      Number.isSafeInteger(value.stepIndex) &&
      Number(value.stepIndex) >= 0 &&
      Number(value.stepIndex) <= 500 &&
      (value.stepCount === null ||
        (Number.isSafeInteger(value.stepCount) &&
          Number(value.stepCount) >= Number(value.stepIndex) &&
          Number(value.stepCount) <= 500)));
  return (
    Number.isSafeInteger(value.index) &&
    Number.isSafeInteger(value.total) &&
    Number.isFinite(value.startedAt) &&
    hasValidStepState &&
    (value.blackout === null ||
      value.blackout === "black" ||
      value.blackout === "white")
  );
}

export function isSlides2PresenterMessage(
  value: unknown,
): value is Slides2PresenterMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "state":
      return isPresenterState(value.state);
    case "request-state":
    case "next":
    case "prev":
      return true;
    case "switch-deck":
      return (
        typeof value.deckId === "string" &&
        value.deckId.trim().length !== 0 &&
        value.deckId.length <= 512
      );
    case "goto":
      return Number.isSafeInteger(value.index);
    case "toggle-blackout":
      return value.mode === "black" || value.mode === "white";
    default:
      return false;
  }
}

export function clampPresenterIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, Number.isFinite(index) ? index : 0));
}

export function useSlides2PresenterChannel(
  deckId: string,
  onMessage?: MessageHandler,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (
      !deckId ||
      typeof window === "undefined" ||
      typeof BroadcastChannel === "undefined"
    ) {
      setAvailable(false);
      return;
    }

    const channel = new BroadcastChannel(`slides-2:presenter:${deckId}`);
    channelRef.current = channel;
    setAvailable(true);
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (isSlides2PresenterMessage(event.data)) {
        onMessageRef.current?.(event.data);
      }
    };
    channel.addEventListener("message", handleMessage);

    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
      setAvailable(false);
    };
  }, [deckId]);

  const send = useCallback((message: Slides2PresenterMessage) => {
    const channel = channelRef.current;
    if (!channel) return false;
    channel.postMessage(message);
    return true;
  }, []);

  return { available, send };
}
