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
} from "@agent-native/core/client/org";

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
} from "@agent-native/core/client/org";

export { RequirePermission } from "./RequirePermission.js";

export type { AppRolesDescriptor } from "@agent-native/core/org/app-roles";

export {
  AccountMenu,
  BuilderCreditNotice,
  OrgSwitcher,
  type AccountMenuProps,
  type AccountMenuUtilityLink,
  type OrgSwitcherProps,
  type OrgSwitcherUtilityLink,
} from "./OrgSwitcher.js";
export {
  InvitationBanner,
  type InvitationBannerProps,
} from "./InvitationBanner.js";
export { WorkspaceNotice } from "./WorkspaceNotice.js";
export { TeamPage, type TeamPageProps } from "./TeamPage.js";
export { OrgGeneralSection } from "./OrgGeneralSection.js";
export { MembersSection } from "./MembersSection.js";
export {
  GroupsSection,
  useWorkspaceGroupEditor,
  type WorkspaceGroupEditorController,
} from "./GroupsSection.js";
export { AuthenticationSection } from "./AuthenticationSection.js";
export { AppsAccessSection } from "./AppsAccessSection.js";
export { OrgGeneralPage } from "./pages/OrgGeneralPage.js";
export { OrgMembersPage } from "./pages/OrgMembersPage.js";
export { OrgAuthenticationPage } from "./pages/OrgAuthenticationPage.js";
export { OrgAppsPage } from "./pages/OrgAppsPage.js";
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
  canManageOrgA2ASecret,
  canManageOrgDomain,
  orgRoleAtLeast,
  orgRoleRank,
} from "@agent-native/core/org/permissions";

export type {
  OrgRole,
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
  OrgSummary,
  OrgInvitationSummary,
  DomainMatchOrg,
} from "@agent-native/core/org/types";
export {
  SIGN_IN_METHOD_ENV_VARS,
  type OrgSignInMethods,
  type SocialSignInMethod,
} from "@agent-native/core/org/sign-in-methods";
