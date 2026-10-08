import { writeClientAppState } from "@agent-native/core/client/application-state";
import { callAction } from "@agent-native/core/client/hooks";
import { hasSessionHint } from "@agent-native/core/client/use-session";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  contentSpaceLastLocationStateKey,
  type ContentLandingResult,
  type ContentLastLocationState,
} from "@shared/content-landing";
import type { QueryClient } from "@tanstack/react-query";
import { matchPath } from "react-router";

import { invalidateContentDatabaseNavigationQueries } from "@/hooks/use-content-database";
import {
  LIST_DOCUMENTS_QUERY_KEY,
  startPageOpenDocumentReads,
} from "@/hooks/use-documents";

import { readLastLocationHintForAnyAccount } from "./last-location-hint";

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

// The page a load of this URL opens first, as far as it can be known before
// the session: the page in the URL, or the page /home likely reopens.
export function pageOpenedByLoad(location: {
  pathname: string;
  search: string;
}) {
  return isPersonalLanding(location)
    ? readLastLocationHintForAnyAccount()
    : matchPath("/page/:id", location.pathname)?.params.id;
}

// A load of a page, or of /home and the page it likely reopens, reads that
// page alongside the session check rather than after the app mounts behind
// it. Without the session hint the read would only be refused, and a refused
// read makes the app check the session again.
export function startLoadReads(
  queryClient: QueryClient,
  location: { key: string; pathname: string; search: string },
) {
  if (!hasSessionHint()) return;
  const documentId = pageOpenedByLoad(location);
  if (!documentId) return;
  // Asking where /home lands can create a Welcome page, so only a browser
  // that has landed before asks this early.
  if (isPersonalLanding(location)) {
    startEarlyContentLanding(queryClient, location.key);
  }
  const search = new URLSearchParams(location.search);
  startPageOpenDocumentReads(queryClient, documentId, {
    databaseId: search.get("databaseId"),
    databaseDocumentId: search.get("databaseDocumentId"),
  });
}

export type EarlyContentLanding =
  | { ok: true; result: ContentLandingResult }
  | { ok: false; error: unknown };

let earlyLanding: {
  locationKey: string;
  answer: Promise<EarlyContentLanding> | null;
} | null = null;

// Only a newly created Welcome page changes what other queries show, and
// refreshing them aborts and restarts their startup reads.
export function refreshLandingCollections(queryClient: QueryClient) {
  invalidateContentDatabaseNavigationQueries(queryClient, { parentId: null });
  void queryClient.invalidateQueries({
    queryKey: ["action", "get-content-recent"],
  });
  void queryClient.invalidateQueries({ queryKey: LIST_DOCUMENTS_QUERY_KEY });
}

// A load of /home asks where it lands alongside the session check, as it reads
// the likely page, instead of after the route mounts behind that check. The
// session is not known yet; the answer names the account it was resolved for.
// The answer may never be taken, since the user can leave /home first, so the
// request refreshes what a Welcome page it created, or may have created before
// failing, changes.
export function startEarlyContentLanding(
  queryClient: QueryClient,
  locationKey: string,
) {
  if (earlyLanding?.locationKey === locationKey) return;
  earlyLanding = {
    locationKey,
    answer: callAction<ContentLandingResult>(
      "resolve-content-landing",
      {},
    ).then(
      (result) => {
        if (result.welcomeCreated) refreshLandingCollections(queryClient);
        return { ok: true, result };
      },
      (error: unknown) => {
        refreshLandingCollections(queryClient);
        return { ok: false, error };
      },
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
