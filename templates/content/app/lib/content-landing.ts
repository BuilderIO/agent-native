import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  type ContentLastLocationState,
} from "@shared/content-landing";

export function rememberContentLandingDocument(documentId: string) {
  return writeClientAppState<ContentLastLocationState>(
    CONTENT_LAST_LOCATION_STATE_KEY,
    { documentId },
    { requestSource: "content-landing" },
  );
}
