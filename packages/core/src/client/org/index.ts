// Public client API for the org module.

export {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useCreateOrg,
  useUpdateOrg,
  useSetOrgVisualIdentity,
  useInviteMember,
  useBulkInviteMembers,
  useChangeMemberRole,
  useAcceptInvitation,
  useRemoveMember,
  useDeleteOrg,
  useSwitchOrg,
  useJoinByDomain,
  useSetOrgDomain,
  useSetWorkspaceAppDefaultVisibility,
  useWorkspaceAppAccess,
  useSetWorkspaceAppAccess,
  useSetOrgWorkspaceUrl,
  useRevealA2ASecret,
  useSetA2ASecret,
  useSyncA2ASecret,
  useOrgRole,
  useAppRoles,
  useAppRole,
  useAppPermissions,
  RequirePermission,
  useSetAppMemberRoles,
  useSetAppMemberRole,
  useOrgSsoProviders,
  useCreateOrgSsoProvider,
  useVerifyOrgSsoProvider,
  useDeleteOrgSsoProvider,
  useOrgScim,
  useCreateOrgScimConnection,
  useDeleteOrgScimConnection,
  useSetOrgAuthProvider,
} from "./hooks.js";

export type {
  InviteRole,
  InviteVars,
  BulkInviteResult,
  SyncA2ASecretResult,
  UseOrgRoleResult,
  AppRoleAssignment,
  AppRolesInfo,
  AppPermissionsInfo,
  WorkspaceAppDefaultVisibility,
  WorkspaceAppAccessMode,
  WorkspaceAppAccess,
  OrgSsoProvider,
  OrgSsoProvidersResult,
  OrgScimConnection,
  OrgScimResult,
} from "./hooks.js";

// Type-only re-export so templates can annotate the `appRoles` prop without
// importing the server module.
export type { AppRolesDescriptor } from "../../org/app-roles.js";

export {
  OrgSwitcher,
  type OrgSwitcherProps,
  type OrgSwitcherUtilityLink,
} from "./OrgSwitcher.js";
export {
  InvitationBanner,
  type InvitationBannerProps,
} from "./InvitationBanner.js";
export { WorkspaceNotice } from "./WorkspaceNotice.js";
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
