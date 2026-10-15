import { track } from "@agent-native/core/client/analytics";
import { isSyntheticTrafficValue } from "@agent-native/core/shared/test-traffic";

/**
 * Browser events recorded by the app server, so ad blockers cannot drop them.
 * The relay needs a signed-in session; signed-out viewers use `trackEvent`.
 */
export function trackSlidesRelay(
  name: string,
  properties: Record<string, unknown>,
): void {
  // These run inside export catch blocks and unload handlers, so a throw here
  // would replace the user's real error or break navigation. Telemetry loss is
  // always preferable to affecting the flow it describes.
  try {
    // The relay skips the browser-side synthetic check that trackEvent
    // applies; test identities are still dropped on the server.
    if (
      typeof window !== "undefined" &&
      isSyntheticTrafficValue(
        (window as { __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: unknown })
          .__AGENT_NATIVE_SYNTHETIC_TRAFFIC__,
      )
    ) {
      return;
    }
    void track(name, {
      ...properties,
      app_name: "slides",
      template_name: "slides",
    }).catch(() => {
      // coercion-ok: a failed analytics send must never surface to the user.
    });
  } catch {
    // coercion-ok: a failed analytics send must never surface to the user.
  }
}

export type BrowserDeckExportFormat = "pdf" | "pptx" | "google_slides";

export interface BrowserDeckExportFacts {
  deckId?: string;
  generationAttemptId?: string;
}

export function trackBrowserDeckExported(
  exportFormat: BrowserDeckExportFormat,
  facts: BrowserDeckExportFacts & {
    slideCount: number;
    status: "completed" | "failed";
    errorType?: string;
    renderLocation?: "server" | "browser";
  },
): void {
  trackSlidesRelay("deck_exported", {
    ...(facts.deckId ? { output_id: facts.deckId } : {}),
    output_type: "deck",
    export_format: exportFormat,
    render_location: facts.renderLocation ?? "browser",
    status: facts.status,
    ...(facts.errorType ? { error_type: facts.errorType } : {}),
    slide_count: facts.slideCount,
    ...(facts.generationAttemptId
      ? { generation_attempt_id: facts.generationAttemptId }
      : {}),
  });
}

export function browserExportErrorType(error: unknown): string {
  return error instanceof Error && error.name === "AbortError"
    ? "cancelled"
    : "export_error";
}

const sentDeckReadyViews = new Set<string>();

/**
 * True the first time it is called for an attempt in this page. Reloads and
 * other devices can send it again; the warehouse dedupes on the attempt id.
 */
export function firstDeckReadyView(generationAttemptId: string): boolean {
  if (sentDeckReadyViews.has(generationAttemptId)) return false;
  sentDeckReadyViews.add(generationAttemptId);
  return true;
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
