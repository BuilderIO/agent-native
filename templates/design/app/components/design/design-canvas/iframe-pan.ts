const MAX_IFRAME_PAN_COORDINATE = 100_000;
const MAX_MOUSE_BUTTONS_MASK = 31;

export type EmbeddedCanvasPanPhase = "start" | "move" | "end" | "cancel";

export interface EmbeddedCanvasPanSession {
  pointerId: number;
  button: 0 | 1;
}

interface EmbeddedCanvasPanMessage {
  type: "embedded-canvas-pan";
  phase: EmbeddedCanvasPanPhase;
  pointerId: number;
  button: 0 | 1;
  buttons: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ForwardEmbeddedCanvasPanResult {
  handled: boolean;
  session: EmbeddedCanvasPanSession | null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseEmbeddedCanvasPanMessage(
  value: unknown,
): EmbeddedCanvasPanMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "embedded-canvas-pan") return null;
  const phase = candidate.phase;
  if (
    phase !== "start" &&
    phase !== "move" &&
    phase !== "end" &&
    phase !== "cancel"
  ) {
    return null;
  }
  const pointerId = finiteNumber(candidate.pointerId);
  const rawButton = finiteNumber(candidate.button);
  const buttons = finiteNumber(candidate.buttons);
  const clientX = finiteNumber(candidate.clientX);
  const clientY = finiteNumber(candidate.clientY);
  if (
    pointerId === null ||
    !Number.isInteger(pointerId) ||
    pointerId < 0 ||
    pointerId > 0x7fffffff ||
    (rawButton !== 0 && rawButton !== 1) ||
    buttons === null ||
    clientX === null ||
    clientY === null
  ) {
    return null;
  }
  return {
    type: "embedded-canvas-pan",
    phase,
    pointerId,
    button: rawButton,
    buttons: clamp(Math.trunc(buttons), 0, MAX_MOUSE_BUTTONS_MASK),
    clientX: clamp(
      clientX,
      -MAX_IFRAME_PAN_COORDINATE,
      MAX_IFRAME_PAN_COORDINATE,
    ),
    clientY: clamp(
      clientY,
      -MAX_IFRAME_PAN_COORDINATE,
      MAX_IFRAME_PAN_COORDINATE,
    ),
    ctrlKey: Boolean(candidate.ctrlKey),
    metaKey: Boolean(candidate.metaKey),
    shiftKey: Boolean(candidate.shiftKey),
    altKey: Boolean(candidate.altKey),
  };
}

/**
 * Replays a trusted iframe bridge pan message through the parent document's
 * existing mouse-drag path. The synthetic mousedown bubbles from the iframe
 * element, so single-screen DesignCanvas and overview MultiScreenCanvas keep
 * one authoritative pan implementation; move/end events go to `window`, where
 * both implementations already install their lifetime drag listeners.
 *
 * The caller owns `session` and must only call this after validating the
 * MessageEvent's source window + origin. Session matching rejects injected or
 * reordered move/end packets before they can disturb another active gesture.
 */
export function forwardEmbeddedCanvasPanMessage({
  data,
  iframe,
  hostWindow,
  session,
}: {
  data: unknown;
  iframe: HTMLIFrameElement;
  hostWindow: Window;
  session: EmbeddedCanvasPanSession | null;
}): ForwardEmbeddedCanvasPanResult {
  const message = parseEmbeddedCanvasPanMessage(data);
  if (!message) return { handled: false, session };

  if (message.phase === "start") {
    if (session) return { handled: false, session };
  } else if (
    !session ||
    session.pointerId !== message.pointerId ||
    session.button !== message.button
  ) {
    return { handled: false, session };
  }

  const frameRect = iframe.getBoundingClientRect();
  const scaleX =
    iframe.clientWidth > 0 && Number.isFinite(frameRect.width)
      ? frameRect.width / iframe.clientWidth
      : 1;
  const scaleY =
    iframe.clientHeight > 0 && Number.isFinite(frameRect.height)
      ? frameRect.height / iframe.clientHeight
      : 1;
  const clientX = frameRect.left + message.clientX * scaleX;
  const clientY = frameRect.top + message.clientY * scaleY;
  const eventType =
    message.phase === "start"
      ? "mousedown"
      : message.phase === "move"
        ? "mousemove"
        : "mouseup";
  const HostMouseEvent = (hostWindow as Window & typeof globalThis).MouseEvent;
  const forwarded = new HostMouseEvent(eventType, {
    bubbles: true,
    cancelable: true,
    view: hostWindow,
    button: message.button,
    buttons:
      message.phase === "end" || message.phase === "cancel"
        ? 0
        : message.buttons,
    clientX,
    clientY,
    ctrlKey: message.ctrlKey,
    metaKey: message.metaKey,
    shiftKey: message.shiftKey,
    altKey: message.altKey,
  });

  if (message.phase === "start") {
    iframe.dispatchEvent(forwarded);
    return {
      handled: true,
      session: { pointerId: message.pointerId, button: message.button },
    };
  }

  hostWindow.dispatchEvent(forwarded);
  return {
    handled: true,
    session: message.phase === "move" ? session : null,
  };
}
