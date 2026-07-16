import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

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
