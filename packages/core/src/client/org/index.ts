// Public client API for the org module.

export {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useCreateOrg,
  useUpdateOrg,
  useInviteMember,
  useBulkInviteMembers,
  useChangeMemberRole,
  useAcceptInvitation,
  useRemoveMember,
  useSwitchOrg,
  useJoinByDomain,
  useSetOrgDomain,
  useSetA2ASecret,
  useSyncA2ASecret,
  useOrgRole,
} from "./hooks.js";

export type {
  InviteRole,
  InviteVars,
  BulkInviteResult,
  SyncA2ASecretResult,
  UseOrgRoleResult,
} from "./hooks.js";

export { OrgSwitcher, type OrgSwitcherProps } from "./OrgSwitcher.js";
export {
  InvitationBanner,
  type InvitationBannerProps,
} from "./InvitationBanner.js";
export { TeamPage, type TeamPageProps } from "./TeamPage.js";
export {
  RequireActiveOrg,
  type RequireActiveOrgProps,
} from "./RequireActiveOrg.js";
export {
  defaultOrgAppLinks,
  dispatchAppsHref,
  dispatchOverviewHref,
  isWorkspaceAppEnvironment,
  parseWorkspaceAppLinks,
  parseWorkspaceAppLinksJson,
  visibleOrgAppLinks,
  ORG_SWITCHER_MAX_APP_LINKS,
  type OrgSwitcherAppLink,
  type UseOrgSwitcherAppLinksResult,
  type VisibleOrgAppLinks,
} from "./workspace-app-links.js";
export {
  canInviteOrgMembers,
  canManageOrg,
  canManageOrgDomain,
  orgRoleAtLeast,
  orgRoleRank,
} from "../../org/permissions.js";

// Re-export the shared types so consumers can import them from one place.
export type {
  OrgRole,
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
  OrgSummary,
  OrgInvitationSummary,
  DomainMatchOrg,
} from "../../org/types.js";
