/**
 * Frame Communication (browser)
 *
 * Utilities for communicating with the parent frame via postMessage.
 * Provides typed request/response patterns and message sending.
 */

// ---------------------------------------------------------------------------
// Low-level parent messaging
// ---------------------------------------------------------------------------

/**
 * Send a typed message to the parent frame.
 * No-op if running at top level (no parent frame).
 */
export function sendToFrame(type: string, data?: any): void {
  if (typeof window === "undefined") return;
  const target = window.parent !== window ? window.parent : window;
  const targetOrigin = getFrameOrigin() || window.location.origin;
  target.postMessage({ type, data }, targetOrigin);
}

/**
 * Listen for a specific message type from the parent frame.
 * Returns a cleanup function.
 */
export function onFrameMessage(
  type: string,
  handler: (data: any) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: MessageEvent) => {
    // Validate origin: accept from frame origin, own origin, or same window
    const frame = getFrameOrigin();
    const ownOrigin = window.location.origin;
    if (
      event.source !== window &&
      event.origin !== ownOrigin &&
      frame &&
      event.origin !== frame
    ) {
      return;
    }
    if (event.data?.type === type) {
      handler(event.data.data ?? event.data.detail ?? event.data);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

// ---------------------------------------------------------------------------
// Frame Origin
// ---------------------------------------------------------------------------

let _harnessOrigin: string | null = null;

// Listen for frame origin message and cache it.
// Only accept from the direct parent frame, and only set once.
if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    if (
      event.data?.type === "builder.harnessOrigin" &&
      event.data.origin &&
      !_harnessOrigin &&
      event.source === window.parent
    ) {
      _harnessOrigin = event.data.origin;
    }
  });
}

/**
 * Get the frame origin (e.g. "http://localhost:3334").
 * Returns null if not running inside a frame iframe.
 */
export function getFrameOrigin(): string | null {
  return _harnessOrigin;
}

/**
 * Returns true if the app is running inside a frame iframe
 * (local dev frame, Builder.io, or any compatible frame).
 */
export function isInFrame(): boolean {
  return _harnessOrigin !== null;
}

/**
 * Get the best origin for OAuth callbacks — frame origin if available,
 * otherwise the current window origin.
 */
export function getCallbackOrigin(): string {
  return (
    _harnessOrigin ||
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

// ---------------------------------------------------------------------------
// User Info
// ---------------------------------------------------------------------------

export interface UserInfo {
  name?: string;
  email?: string;
}

/**
 * Request user info (name + email) from the parent frame.
 * Falls back to empty object if frame doesn't respond within timeout.
 */
export function requestUserInfo(timeoutMs = 1500): Promise<UserInfo> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || window.parent === window) {
      resolve({});
      return;
    }

    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener("message", handler);
        resolve({});
      }
    }, timeoutMs);

    function handler(event: MessageEvent) {
      if (!event.data || event.data.type !== "builder.userInfo") return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      const { name, email } = event.data.data ?? {};
      resolve({ name: name || undefined, email: email || undefined });
    }

    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "builder.getUserInfo" }, "*");
  });
}

// ---------------------------------------------------------------------------
// Selection Mode (visual editing)
// ---------------------------------------------------------------------------

/**
 * Enter visual editing selection mode for a specific element.
 */
export function enterStyleEditing(selector: string): void {
  sendToFrame("builder.enterStyleEditing", { selector });
}

/**
 * Enter text editing mode for a specific element.
 */
export function enterTextEditing(selector: string): void {
  sendToFrame("builder.enterTextEditing", { selector });
}

/**
 * Exit selection mode.
 */
export function exitSelectionMode(): void {
  sendToFrame("builder.exitSelectionMode");
}

// ---------------------------------------------------------------------------
// Backward compatibility aliases
// ---------------------------------------------------------------------------

/** @deprecated Use `sendToFrame` instead */
export const sendToHarness = sendToFrame;

/** @deprecated Use `onFrameMessage` instead */
export const onHarnessMessage = onFrameMessage;

/** @deprecated Use `getFrameOrigin` instead */
export const getHarnessOrigin = getFrameOrigin;

/** @deprecated Use `isInFrame` instead */
export const isInHarness = isInFrame;
