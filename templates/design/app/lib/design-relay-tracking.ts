import { track, trackEvent } from "@agent-native/core/client/analytics";
import { isSyntheticTrafficValue } from "@agent-native/core/shared/test-traffic";

function isSyntheticPage(): boolean {
  return (
    typeof window !== "undefined" &&
    isSyntheticTrafficValue(
      (window as { __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: unknown })
        .__AGENT_NATIVE_SYNTHETIC_TRAFFIC__,
    )
  );
}

/**
 * Browser events recorded by the app server, so ad blockers cannot drop them.
 * The relay needs a signed-in session; pass `signedIn: false` for a signed-out
 * viewer and the event goes through the browser beacon instead.
 */
export function trackDesignRelay(
  name: string,
  properties: Record<string, unknown>,
  options: { signedIn?: boolean } = {},
): void {
  // These run inside export catch blocks and visibility handlers, so a throw
  // here would replace the user's real error or break the flow. Telemetry loss
  // is always preferable to affecting the flow it describes.
  try {
    const props = {
      ...properties,
      app_name: "design",
      template_name: "design",
    };
    if (options.signedIn === false) {
      trackEvent(name, props);
      return;
    }
    // The relay skips the browser-side synthetic check that trackEvent
    // applies; test identities are still dropped on the server.
    if (isSyntheticPage()) return;
    void track(name, props).catch(() => {
      // coercion-ok: a failed analytics send must never surface to the user.
    });
  } catch {
    // coercion-ok: a failed analytics send must never surface to the user.
  }
}

/**
 * Runs `callback` now if the tab is visible, otherwise on the next switch to
 * visible. The returned cleanup cancels a callback that has not run yet.
 */
export function runWhenTabVisible(callback: () => void): () => void {
  if (document.visibilityState === "visible") {
    callback();
    return () => {};
  }
  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    callback();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () =>
    document.removeEventListener("visibilitychange", onVisibilityChange);
}
