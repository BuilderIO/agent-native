import { readClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  type ContentLastLocationState,
} from "@shared/content-landing";

/**
 * A document title the landing flow already knows before the document body
 * loads. Sources, freshest first: the in-memory landing handoff (same page
 * load) and `content-last-location-v1` (persists across reloads). Consumers
 * only render a hint whose documentId matches the page being opened; anything
 * else keeps the existing skeleton so a wrong title is never guessed.
 */
export type LandingTitleHint = {
  documentId: string;
  title: string;
};

export const CONTENT_LAST_LOCATION_HINT_QUERY_KEY = [
  "content-last-location-hint",
] as const;

export function landingTitleHintFromState(
  state: ContentLastLocationState | null | undefined,
): LandingTitleHint | null {
  if (
    !state ||
    typeof state.documentId !== "string" ||
    !state.documentId ||
    typeof state.title !== "string" ||
    !state.title.trim()
  ) {
    return null;
  }
  return { documentId: state.documentId, title: state.title };
}

export async function fetchLandingTitleHint(): Promise<LandingTitleHint | null> {
  const state = await readClientAppState<ContentLastLocationState>(
    CONTENT_LAST_LOCATION_STATE_KEY,
  );
  return landingTitleHintFromState(state);
}

let landingTitleHint: LandingTitleHint | null = null;

export function stashLandingTitleHint(hint: LandingTitleHint | null) {
  landingTitleHint = hint;
}

export function peekLandingTitleHint(
  documentId: string,
): LandingTitleHint | null {
  return landingTitleHint?.documentId === documentId ? landingTitleHint : null;
}

function usableTitle(title: string | null | undefined): string | null {
  return typeof title === "string" && title.trim() ? title : null;
}

/**
 * Pick the optimistic title for one document. The landing stash wins because
 * it was confirmed by this page load's resolver; the persisted last location
 * follows; a seeded query-cache snapshot is last because its title may predate
 * the dedicated get-document response that must admit the editor anyway.
 */
export function resolveOptimisticDocumentTitle(args: {
  documentId: string | null;
  stashed: LandingTitleHint | null;
  lastLocation: LandingTitleHint | null | undefined;
  cachedTitle?: string | null;
}): string | null {
  const usable = usableTitle;
  if (args.documentId) {
    if (args.stashed?.documentId === args.documentId) {
      const title = usable(args.stashed.title);
      if (title) return title;
    }
    if (args.lastLocation?.documentId === args.documentId) {
      const title = usable(args.lastLocation.title);
      if (title) return title;
    }
  }
  return usable(args.cachedTitle ?? null);
}

/**
 * The landing skeleton paints before any documentId is known, so it shows the
 * last location's title on its own. When the resolver restores a different
 * page (deleted page falls back to the welcome page), that hint disappears
 * with the navigation, bounded by the resolve round trip.
 */
export function landingOptimisticTitle(
  stashed: LandingTitleHint | null,
  lastLocation: LandingTitleHint | null | undefined,
): string | null {
  return (
    (stashed && stashed.title.trim() ? stashed.title : null) ??
    (lastLocation && lastLocation.title.trim() ? lastLocation.title : null) ??
    null
  );
}

export function updateLandingTitleHintCache(
  queryClient: {
    getQueryData: (
      queryKey: readonly unknown[],
    ) => LandingTitleHint | undefined;
    setQueryData: (
      queryKey: readonly unknown[],
      value: LandingTitleHint,
    ) => unknown;
  },
  documentId: string,
  title: string | null | undefined,
) {
  if (!title?.trim()) return;
  const current = queryClient.getQueryData(
    CONTENT_LAST_LOCATION_HINT_QUERY_KEY,
  );
  if (current?.documentId === documentId) {
    queryClient.setQueryData(CONTENT_LAST_LOCATION_HINT_QUERY_KEY, {
      documentId,
      title,
    });
  }
}
