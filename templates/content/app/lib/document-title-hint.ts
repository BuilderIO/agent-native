import { readClientAppState } from "@agent-native/core/client/application-state";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  type ContentLastLocationState,
} from "@shared/content-landing";

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
