import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

export const SELECTED_CONTENT_SPACE_STORAGE_KEY = "content-selected-space";

export type ContentSpaceAvailability = "loading" | "ready" | "error";

export function contentSpaceAvailability(args: {
  hasSelectedSpace: boolean;
  contentSpacesLoading: boolean;
  contentSpacesFetching: boolean;
  contentSpacesError: boolean;
  activeOrganizationResolved: boolean;
  activeOrganizationError: boolean;
  provisioningAttempted: boolean;
  provisioningPending: boolean;
  provisioningError: boolean;
}): ContentSpaceAvailability {
  if (args.hasSelectedSpace) return "ready";
  if (
    args.contentSpacesError ||
    args.activeOrganizationError ||
    args.provisioningError
  ) {
    return "error";
  }
  if (
    args.contentSpacesLoading ||
    args.contentSpacesFetching ||
    !args.activeOrganizationResolved ||
    !args.provisioningAttempted ||
    args.provisioningPending
  ) {
    return "loading";
  }
  return "error";
}

export function contentSpaceForActiveOrg(args: {
  spaces: ContentSpaceSummary[];
  storedSpaceId: string | null;
  activeOrgId: string | null | undefined;
}) {
  if (args.activeOrgId === undefined) return null;
  const stored = args.spaces.find((space) => space.id === args.storedSpaceId);
  if (stored?.orgId === args.activeOrgId) return stored;
  const matching = args.spaces.filter(
    (space) => space.orgId === args.activeOrgId,
  );
  return args.activeOrgId === null
    ? (matching.find((space) => space.kind === "personal") ??
        matching[0] ??
        null)
    : (matching[0] ?? null);
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
  activeOrgId: string | null | undefined;
  switchOrg: (orgId: string | null) => Promise<unknown>;
  syncApplicationState: (space: ContentSpaceSummary) => Promise<unknown>;
  persistSelection: (spaceId: string) => void;
  openFiles: (documentId: string) => void;
}) {
  if (args.activeOrgId !== args.space.orgId) {
    await args.switchOrg(args.space.orgId);
  }
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
