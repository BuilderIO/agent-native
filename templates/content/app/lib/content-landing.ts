import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  type ContentLastLocationState,
} from "@shared/content-landing";

let landingWriteQueue = Promise.resolve();

export function rememberContentLandingDocument(documentId: string) {
  const write = landingWriteQueue.then(() =>
    writeClientAppState<ContentLastLocationState>(
      CONTENT_LAST_LOCATION_STATE_KEY,
      { documentId },
      { requestSource: "content-landing" },
    ),
  );
  landingWriteQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}
