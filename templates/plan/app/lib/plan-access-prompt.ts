import type {
  DomainMatchOrg,
  OrgInfo,
  OrgInvitationSummary,
} from "@agent-native/core/client/org";

import type { PlanAccessStatusResponse } from "@/hooks/use-plans";

export type PlanOrgAccessPrompt =
  | {
      kind: "invitation";
      organizationId: string;
      organizationName: string;
      invitationId: string;
      invitedBy: string;
      buttonLabel: string;
      message: string;
    }
  | {
      kind: "domain";
      organizationId: string;
      organizationName: string;
      domain: string | null;
      buttonLabel: string;
      message: string;
    };

export function resolvePlanOrgAccessPrompt(input: {
  accessStatus?: PlanAccessStatusResponse | null;
  org?: Pick<OrgInfo, "email" | "pendingInvitations" | "domainMatches"> | null;
}): PlanOrgAccessPrompt | null {
  const orgId = input.accessStatus?.orgId;
  const orgName = input.accessStatus?.orgName?.trim();
  if (
    !orgId ||
    !orgName ||
    input.accessStatus?.visibility !== "org" ||
    input.accessStatus.hasAccess
  ) {
    return null;
  }

  const pendingInvitation = input.org?.pendingInvitations?.find(
    (inv: OrgInvitationSummary) => inv.orgId === orgId,
  );
  if (pendingInvitation) {
    return {
      kind: "invitation",
      organizationId: orgId,
      organizationName: orgName,
      invitationId: pendingInvitation.id,
      invitedBy: pendingInvitation.invitedBy,
      buttonLabel: "",
      message: "",
    };
  }

  const domainMatch = input.org?.domainMatches?.find(
    (match: DomainMatchOrg) => match.orgId === orgId,
  );
  if (domainMatch) {
    const domain = input.org?.email?.split("@")[1]?.toLowerCase() || null;
    return {
      kind: "domain",
      organizationId: orgId,
      organizationName: orgName,
      domain,
      buttonLabel: "",
      message: "",
    };
  }

  return null;
}
