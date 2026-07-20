import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

export const SELECTED_CONTENT_SPACE_STORAGE_KEY = "content-selected-space";

export type ContentSpaceAvailability = "loading" | "ready" | "error";

export function contentSpaceAvailability(args: {
  hasSelectedSpace: boolean;
  contentSpacesLoading: boolean;
  contentSpacesFetching: boolean;
  contentSpacesError: boolean;
  provisioningAttempted: boolean;
  provisioningPending: boolean;
  provisioningError: boolean;
}): ContentSpaceAvailability {
  if (args.hasSelectedSpace) return "ready";
  if (args.contentSpacesError || args.provisioningError) {
    return "error";
  }
  if (
    args.contentSpacesLoading ||
    args.contentSpacesFetching ||
    !args.provisioningAttempted ||
    args.provisioningPending
  ) {
    return "loading";
  }
  return "error";
}

export function contentSpaceForStoredSelection(args: {
  spaces: ContentSpaceSummary[];
  storedSpaceId: string | null;
}) {
  const stored = args.spaces.find((space) => space.id === args.storedSpaceId);
  if (stored) return stored;
  return (
    args.spaces.find((space) => space.kind === "personal") ??
    args.spaces[0] ??
    null
  );
}

export function contentSpaceForCatalogItem(args: {
  databaseId: string;
  catalogDatabaseId: string | undefined;
  documentId: string;
  spaces: ContentSpaceSummary[];
}) {
  if (args.databaseId !== args.catalogDatabaseId) {
    return null;
  }
  return (
    args.spaces.find((space) => space.catalogDocumentId === args.documentId) ??
    null
  );
}

export function toggleExpandedWorkspaceIds(
  expandedIds: string[],
  workspaceId: string,
) {
  return expandedIds.includes(workspaceId)
    ? expandedIds.filter((id) => id !== workspaceId)
    : [...expandedIds, workspaceId];
}

export function ensureWorkspaceExpanded(
  expandedIds: string[],
  workspaceId: string,
) {
  return expandedIds.includes(workspaceId)
    ? expandedIds
    : [...expandedIds, workspaceId];
}

export function contentSpaceIdForCreate(args: {
  parentId?: string;
  selectedSpace: ContentSpaceSummary | null;
}) {
  if (args.parentId) return undefined;
  if (!args.selectedSpace) {
    throw new Error("Files are still loading. Try creating the page again.");
  }
  return args.selectedSpace.id;
}

export async function selectContentSpace(args: {
  space: ContentSpaceSummary;
  syncApplicationState: (space: ContentSpaceSummary) => Promise<unknown>;
  persistSelection: (spaceId: string) => void;
  openFiles: (documentId: string) => void;
}) {
  await args.syncApplicationState(args.space);
  args.persistSelection(args.space.id);
  args.openFiles(args.space.filesDocumentId);
}

export function createContentSpaceSelectionQueue() {
  let pending = Promise.resolve();
  return (selection: () => Promise<void>) => {
    const next = pending.catch(() => undefined).then(selection);
    pending = next;
    return next;
  };
}
