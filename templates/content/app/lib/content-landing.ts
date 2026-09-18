import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  contentSpaceLastLocationStateKey,
  type ContentLastLocationState,
} from "@shared/content-landing";

let landingWriteQueue = Promise.resolve();

export function rememberContentLandingDocument(
  target: ContentLastLocationState,
  spaceId?: string,
) {
  const write = landingWriteQueue.then(() =>
    writeClientAppState<ContentLastLocationState>(
      spaceId
        ? contentSpaceLastLocationStateKey(spaceId)
        : CONTENT_LAST_LOCATION_STATE_KEY,
      target,
      { requestSource: "content-landing" },
    ),
  );
  landingWriteQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}
