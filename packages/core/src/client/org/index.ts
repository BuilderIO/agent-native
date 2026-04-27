// Public client API for the org module.

export {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useCreateOrg,
  useUpdateOrg,
  useInviteMember,
  useAcceptInvitation,
  useRemoveMember,
  useSwitchOrg,
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

// Re-export the shared types so consumers can import them from one place.
export type {
  OrgRole,
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
  OrgSummary,
  OrgInvitationSummary,
} from "../../org/types.js";
