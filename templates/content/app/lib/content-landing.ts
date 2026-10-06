import { writeClientAppState } from "@agent-native/core/client/application-state";
import { callAction } from "@agent-native/core/client/hooks";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  contentSpaceLastLocationStateKey,
  type ContentLandingResult,
  type ContentLastLocationState,
} from "@shared/content-landing";

export const CONTENT_LANDING_PATH = "/home";

// /home with no space returns to the last page opened anywhere, which is the
// page a last-location hint names.
export function isPersonalLanding(location: {
  pathname: string;
  search: string;
}) {
  return (
    location.pathname === CONTENT_LANDING_PATH &&
    !new URLSearchParams(location.search).get("spaceId")
  );
}

export type EarlyContentLanding =
  | { ok: true; result: ContentLandingResult }
  | { ok: false; error: unknown };

let earlyLanding: {
  locationKey: string;
  answer: Promise<EarlyContentLanding> | null;
} | null = null;

// A load of /home asks where it lands alongside the session check, as it reads
// the likely page, instead of after the route mounts behind that check.
export function startEarlyContentLanding(locationKey: string) {
  if (earlyLanding?.locationKey === locationKey) return;
  earlyLanding = {
    locationKey,
    answer: callAction<ContentLandingResult>(
      "resolve-content-landing",
      {},
    ).then(
      (result) => ({ ok: true, result }),
      (error: unknown) => ({ ok: false, error }),
    ),
  };
}

// Only /home's mount for the same load adopts the answer, once: a later visit
// to /home must ask again, since the last page opened has moved since. Taking
// also closes the load to an early start, because a route that mounts in the
// first commit runs its effect before Root's and has already asked.
export function takeEarlyContentLanding(
  locationKey: string,
): Promise<EarlyContentLanding> | null {
  const answer =
    earlyLanding?.locationKey === locationKey ? earlyLanding.answer : null;
  earlyLanding = { locationKey, answer: null };
  return answer;
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
