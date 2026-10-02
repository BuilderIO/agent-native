import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  contentSpaceLastLocationStateKey,
  type ContentLastLocationState,
} from "@shared/content-landing";

export const CONTENT_LANDING_PATH = "/home";

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
  // The unscoped key is where /home returns, so every page open records it,
  // whatever space the page is in; the space key is where that space returns.
  const keys = [
    CONTENT_LAST_LOCATION_STATE_KEY,
    ...(spaceId ? [contentSpaceLastLocationStateKey(spaceId)] : []),
  ];
  const write = landingWriteQueue.then(() =>
    Promise.all(
      keys.map((key) =>
        writeClientAppState<ContentLastLocationState>(key, target, {
          requestSource: "content-landing",
        }),
      ),
    ),
  );
  const result = write.then(() => undefined);
  landingWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
