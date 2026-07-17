import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

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

export async function selectContentSpace(args: {
  space: ContentSpaceSummary;
  activeOrgId: string | null | undefined;
  switchOrg: (orgId: string | null) => Promise<unknown>;
  persistSelection: (spaceId: string) => void;
}) {
  if (args.activeOrgId !== args.space.orgId) {
    await args.switchOrg(args.space.orgId);
  }
  args.persistSelection(args.space.id);
}
