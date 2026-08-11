export const CONTENT_LAST_LOCATION_STATE_KEY = "content-last-location-v1";

export type ContentLastLocationState = {
  documentId: string;
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
