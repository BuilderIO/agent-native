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
