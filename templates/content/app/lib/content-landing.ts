import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  type ContentLastLocationState,
} from "@shared/content-landing";

let landingWriteQueue = Promise.resolve();

export function rememberContentLandingDocument(
  documentId: string,
  title?: string,
) {
  const value: ContentLastLocationState = title?.trim()
    ? { documentId, title }
    : { documentId };
  const write = landingWriteQueue.then(() =>
    writeClientAppState<ContentLastLocationState>(
      CONTENT_LAST_LOCATION_STATE_KEY,
      value,
      { requestSource: "content-landing" },
    ),
  );
  landingWriteQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}
