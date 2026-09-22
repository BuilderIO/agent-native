import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  contentSpaceLastLocationStateKey,
  type ContentLastLocationState,
} from "@shared/content-landing";

export const CONTENT_LANDING_PATH = "/home";

export type ContentLandingRecoveryState = {
  unavailableDocumentId: string;
};

/**
 * `resolve-content-landing` is the only surface that can promise a Page the
 * caller may actually open, and the landing route is its only entry point. A
 * deep link that resolves to an unauthorized or missing document therefore
 * hands off to that route rather than rendering a terminal screen — otherwise
 * a first arrival at a Page id the account cannot read (a signup resuming a
 * stale or foreign link) has no valid destination at all.
 *
 * Only the full-page host redirects. An embedded preview has no URL of its own
 * to replace, so it keeps the inline unavailable state.
 */
export function contentLandingRecoveryTarget(input: {
  host: string;
  documentId: string;
}): { pathname: string; state: ContentLandingRecoveryState } | null {
  if (input.host !== "page" || !input.documentId) return null;
  return {
    pathname: CONTENT_LANDING_PATH,
    state: { unavailableDocumentId: input.documentId },
  };
}

/** Read the recovery handoff off a history entry. `null` when absent or shaped
 * differently, so a hand-written `/home` visit stays distinguishable from a
 * recovery arrival. */
export function readContentLandingRecovery(
  state: unknown,
): ContentLandingRecoveryState | null {
  if (!state || typeof state !== "object") return null;
  const documentId = (state as { unavailableDocumentId?: unknown })
    .unavailableDocumentId;
  return typeof documentId === "string" && documentId
    ? { unavailableDocumentId: documentId }
    : null;
}

let landingWriteQueue = Promise.resolve();

export function rememberContentLandingDocument(
  target: ContentLastLocationState,
  spaceId?: string,
): Promise<void>;
export function rememberContentLandingDocument(
  documentId: string,
  title?: string,
): Promise<void>;
export function rememberContentLandingDocument(
  targetOrDocumentId: ContentLastLocationState | string,
  spaceIdOrTitle?: string,
) {
  const target: ContentLastLocationState =
    typeof targetOrDocumentId === "string"
      ? {
          documentId: targetOrDocumentId,
          ...(spaceIdOrTitle?.trim() ? { title: spaceIdOrTitle } : {}),
        }
      : targetOrDocumentId;
  const spaceId =
    typeof targetOrDocumentId === "string" ? undefined : spaceIdOrTitle;
  const write = landingWriteQueue.then(() =>
    writeClientAppState<ContentLastLocationState>(
      spaceId
        ? contentSpaceLastLocationStateKey(spaceId)
        : CONTENT_LAST_LOCATION_STATE_KEY,
      target,
      { requestSource: "content-landing" },
    ),
  );
  const result = write.then(() => undefined);
  landingWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
