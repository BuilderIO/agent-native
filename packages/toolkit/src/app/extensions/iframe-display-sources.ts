import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  EXTENSION_IFRAME_DISPLAY_SOURCES_PATH,
  EXTENSION_IFRAME_META_CSP,
  extensionIframeMetaCspFromDisplaySources,
} from "@agent-native/core/extensions/html-shell";
import { useEffect, useState } from "react";

/**
 * Client-rendered extension frames (`ExtensionViewer` srcDoc,
 * `InlineExtensionFrame` transient frames) build their HTML in the browser, so
 * they read the deployment's `extensions.iframeImageSources` /
 * `iframeMediaSources` from the server instead of from app config. The lists
 * are validated again by `extensionIframeMetaCspFromDisplaySources`, and any
 * failure (network, non-OK status, malformed body, invalid source) falls back
 * to the default policy, which blocks remote images and media.
 */
let pending: Promise<string> | null = null;

export function loadExtensionIframeMetaCsp(): Promise<string> {
  if (!pending) {
    const request = fetch(
      agentNativePath(EXTENSION_IFRAME_DISPLAY_SOURCES_PATH),
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return extensionIframeMetaCspFromDisplaySources(await res.json());
      })
      .catch(() => {
        // Do not cache a failure: the next frame retries.
        if (pending === request) pending = null;
        return EXTENSION_IFRAME_META_CSP;
      });
    pending = request;
  }
  return pending;
}

/**
 * The meta CSP for a client-rendered frame, or `undefined` while it loads.
 * Callers wait for it rather than rendering with the default policy first, so
 * a frame is built once with the policy it keeps.
 */
export function useExtensionIframeMetaCsp(enabled = true): string | undefined {
  const [metaCsp, setMetaCsp] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadExtensionIframeMetaCsp().then((csp) => {
      if (!cancelled) setMetaCsp(csp);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? metaCsp : undefined;
}

export function resetExtensionIframeMetaCspForTests(): void {
  pending = null;
}
