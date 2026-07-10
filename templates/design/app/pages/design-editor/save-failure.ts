import { isDesignHtmlIntegrityError } from "@shared/html-integrity";

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
  const message = errorField(error, "message");
  if (typeof message !== "string" || !message.trim()) return null;
  return message.replace(/^DESIGN_HTML_INTEGRITY:\s*/, "");
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
