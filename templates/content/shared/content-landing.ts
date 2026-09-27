export const CONTENT_LAST_LOCATION_STATE_KEY = "content-last-location-v1";
export const CONTENT_WELCOME_PAGE_STATE_KEY = "content-welcome-page-v1";

export function contentSpaceLastLocationStateKey(spaceId: string) {
  return `content-last-location-v2:${spaceId}`;
}

export function contentSpaceWelcomePageStateKey(spaceId: string) {
  return `content-welcome-page-v2:${spaceId}`;
}

export type ContentLastLocationState = {
  documentId: string;
  databaseId?: string;
  viewId?: string;
  title?: string;
};

export type ContentWelcomePageState = {
  generation: number;
  documentId?: string;
};
export type ContentLandingResolution =
  | "restored"
  | "welcome-created"
  | "welcome-reused"
  | "fallback";

export type ContentLandingResult = {
  documentId: string;
  resolution: ContentLandingResolution;
  fallbackReason?: "saved-document-unavailable";
};

export type ContentSpaceLandingResult =
  | {
      target: ContentLastLocationState;
      resolution: ContentLandingResolution;
      fallbackReason?: "saved-document-unavailable";
    }
  | {
      target: null;
      resolution: "welcome-unavailable";
      fallbackReason: "welcome-create-forbidden";
    };
