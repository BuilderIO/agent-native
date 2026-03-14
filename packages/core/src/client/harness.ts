/**
 * Harness Communication (browser)
 *
 * Utilities for communicating with the parent harness frame via postMessage.
 * Provides typed request/response patterns and message sending.
 */

// ---------------------------------------------------------------------------
// Low-level parent messaging
// ---------------------------------------------------------------------------

/**
 * Send a typed message to the parent harness frame.
 * No-op if running at top level (no parent frame).
 */
export function sendToHarness(type: string, data?: any): void {
  if (typeof window === "undefined") return;
  const target = window.parent !== window ? window.parent : window;
  target.postMessage({ type, data }, "*");
}

/**
 * Listen for a specific message type from the parent harness.
 * Returns a cleanup function.
 */
export function onHarnessMessage(
  type: string,
  handler: (data: any) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: MessageEvent) => {
    if (event.data?.type === type) {
      handler(event.data.data ?? event.data.detail ?? event.data);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

// ---------------------------------------------------------------------------
// User Info
// ---------------------------------------------------------------------------

export interface UserInfo {
  name?: string;
  email?: string;
}

/**
 * Request user info (name + email) from the parent harness.
 * Falls back to empty object if harness doesn't respond within timeout.
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
  sendToHarness("builder.enterStyleEditing", { selector });
}

/**
 * Enter text editing mode for a specific element.
 */
export function enterTextEditing(selector: string): void {
  sendToHarness("builder.enterTextEditing", { selector });
}

/**
 * Exit selection mode.
 */
export function exitSelectionMode(): void {
  sendToHarness("builder.exitSelectionMode");
}
