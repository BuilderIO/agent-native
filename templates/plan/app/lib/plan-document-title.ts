import { normalizeDocumentTitle } from "@agent-native/core/shared";

export function planDocumentTitle(
  planTitle: string | null | undefined,
  fallbackTitle: string,
): string {
  return normalizeDocumentTitle(planTitle, fallbackTitle);
}
