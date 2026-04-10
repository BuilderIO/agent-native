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

let _frameOrigin: string | null = null;

// Listen for frame origin message and cache it.
// Only accept from the direct parent frame, and only set once.
if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    if (
      event.data?.type === "builder.frameOrigin" &&
      event.data.origin &&
      !_frameOrigin &&
      event.source === window.parent
    ) {
      _frameOrigin = event.data.origin;
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
