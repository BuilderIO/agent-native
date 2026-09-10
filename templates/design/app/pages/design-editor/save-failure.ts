import {
  DESIGN_HTML_INTEGRITY_SUMMARY,
  isDesignHtmlIntegrityError,
} from "@shared/html-integrity";

export type DesignSaveFailureKind =
  | "offline"
  | "intentional-abort"
  | "conflict"
  | "invalid-html"
  | "other";

function errorField(error: unknown, field: string): unknown {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

export function designSaveErrorMessage(error: unknown): string | null {
  // Integrity errors carry located, agent-facing guidance in `message`. Toasts
  // get the summary instead; the two audiences need different text.
  if (isDesignHtmlIntegrityError(error)) return DESIGN_HTML_INTEGRITY_SUMMARY;
  const message = errorField(error, "message");
  if (typeof message !== "string" || !message.trim()) return null;
  return message.replace(/^DESIGN_HTML_INTEGRITY:\s*/, "");
}

/**
 * Collab conflicts often return 200 with `skippedStaleMirror` instead of throwing 409.
 */
export function isDesignSaveSuccessConflict(
  persistedContentMatches: boolean,
): boolean {
  return !persistedContentMatches;
}

/** A 200 stale-mirror skip still toasts conflict; queued proofs must not
 * flip to applied or later commit/rollback treats the skipped write as done. */
export function patchProofStatusAfterPersistedSave(
  persistedContentMatches: boolean,
): "applied" | "failed" {
  return persistedContentMatches ? "applied" : "failed";
}

/**
 * Only true transport failures deserve the “save when reconnected” warning.
 * HMR/editor reload aborts, optimistic conflicts, IndexedDB/outbox failures,
 * and HTML-integrity rejections are not connectivity failures.
 */
export function classifyDesignSaveFailure(
  error: unknown,
  navigatorOnline: boolean,
): DesignSaveFailureKind {
  if (isDesignHtmlIntegrityError(error)) return "invalid-html";
  const name = errorField(error, "name");
  if (name === "AbortError") return "intentional-abort";

  const status = errorField(error, "status");
  const message = designSaveErrorMessage(error)?.toLowerCase() ?? "";
  if (
    status === 409 ||
    message.includes("changed since it was read") ||
    message.includes("re-read the file") ||
    message.includes("source file changed")
  ) {
    return "conflict";
  }

  if (!navigatorOnline) return "offline";
  if (
    (name === "TypeError" || status === 0) &&
    (message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("network request failed") ||
      message.includes("load failed"))
  ) {
    return "offline";
  }

  return "other";
}
