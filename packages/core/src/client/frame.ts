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
    if (!isTrustedFrameMessage(event)) return;
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

let _frameOrigin: string | null = null;

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isTrustedFrameMessage(event: MessageEvent): boolean {
  if (typeof window === "undefined") return false;

  const ownOrigin = window.location.origin;
  if (event.origin === ownOrigin) return true;

  const frameOrigin = getFrameOrigin();
  if (!frameOrigin || event.origin !== frameOrigin) return false;

  return event.source === window.parent || event.source === window;
}

// Listen for frame origin message and cache it.
// Only accept from the direct parent frame, and only set once.
if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    const origin = normalizeOrigin(event.data?.origin);
    if (
      event.data?.type === "agentNative.frameOrigin" &&
      origin &&
      origin === event.origin &&
      !_frameOrigin &&
      event.source === window.parent
    ) {
      _frameOrigin = origin;
    }
  });
}

/**
 * Get the frame origin (e.g. "http://localhost:3334").
 * Returns null if not running inside a frame iframe.
 */
export function getFrameOrigin(): string | null {
  return _frameOrigin;
}

/**
 * Returns true if the app is running inside a frame iframe
 * (local dev frame, Builder.io, or any compatible frame).
 */
export function isInFrame(): boolean {
  return _frameOrigin !== null;
}

/**
 * Get the origin for OAuth callbacks.
 * Always uses the app's own origin (window.location.origin), NOT the frame
 * origin. The redirect URI registered in Google Cloud Console (or any OAuth
 * provider) must match the template app's direct URL, not the dev frame's
 * proxy URL, so this must be consistent regardless of how the app is accessed.
 */
export function getCallbackOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
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
      if (!event.data || event.data.type !== "agentNative.userInfo") return;
      if (event.source !== window.parent) return;
      const frameOrigin = getFrameOrigin();
      if (frameOrigin && event.origin !== frameOrigin) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      const { name, email } = event.data.data ?? {};
      resolve({ name: name || undefined, email: email || undefined });
    }

    window.addEventListener("message", handler);
    window.parent.postMessage(
      { type: "agentNative.getUserInfo" },
      getFrameOrigin() ?? window.location.origin,
    );
  });
}

// ---------------------------------------------------------------------------
// Selection Mode (visual editing)
// ---------------------------------------------------------------------------

/**
 * Enter visual editing selection mode for a specific element.
 */
export function enterStyleEditing(selector: string): void {
  sendToFrame("agentNative.enterStyleEditing", { selector });
}

/**
 * Enter text editing mode for a specific element.
 */
export function enterTextEditing(selector: string): void {
  sendToFrame("agentNative.enterTextEditing", { selector });
}

/**
 * Exit selection mode.
 */
export function exitSelectionMode(): void {
  sendToFrame("agentNative.exitSelectionMode");
}
