// Public API for the org module.

export type {
  OrgRole,
  OrgContext,
  OrgSummary,
  OrgInvitationSummary,
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
  RequiredAuthProvider,
} from "./types.js";

export {
  canInviteOrgMembers,
  canManageOrg,
  canManageOrgDomain,
  orgRoleAtLeast,
  orgRoleRank,
} from "./permissions.js";

export {
  getOrgContext,
  getOrgDomain,
  getOrgA2ASecret,
  getA2ASecretByDomain,
  resolveOrgByDomain,
  resolveOrgIdForEmail,
  createOrganization,
} from "./context.js";

export {
  implicitServiceOrgRole,
  parseServiceIdentityEmail,
} from "./service-identity.js";

export { acceptPendingInvitationsForEmail } from "./accept-pending.js";
export type { AcceptPendingResult } from "./accept-pending.js";

export { autoJoinDomainMatchingOrgs } from "./auto-join-domain.js";
export type { AutoJoinDomainResult } from "./auto-join-domain.js";

export {
  defineAppRoles,
  getRegisteredAppRoles,
  listRegisteredAppRoles,
  listAppMemberRoles,
  resolveAppRole,
  setAppMemberRole,
} from "./app-roles.js";
export type {
  AppRoles,
  AppRolesDescriptor,
  AppRoleCaller,
  AppRoleLookup,
  AppMemberRoleRow,
} from "./app-roles.js";

export { ORG_MIGRATIONS } from "./migrations.js";

export {
  getRequiredAuthProviderForEmail,
  getRequiredAuthProviderForOrg,
  isGoogleSignInRequiredForEmail,
  setRequiredAuthProvider,
} from "./auth-policy.js";

export { createOrgPlugin, defaultOrgPlugin } from "./plugin.js";

// Drizzle schema (re-exported so templates can write typed queries against
// org tables without redefining the schema themselves).
export {
  organizations,
  orgMembers,
  orgInvitations,
  appMemberRoles,
} from "./schema.js";

// Individual handlers — exported so templates can compose a custom org plugin
// while still using the framework-provided handlers.
export {
  getMyOrgHandler,
  createOrgHandler,
  updateOrgHandler,
  switchOrgHandler,
  listMembersHandler,
  removeMemberHandler,
  changeMemberRoleHandler,
  listInvitationsHandler,
  createInvitationHandler,
  acceptInvitationHandler,
  setA2ASecretHandler,
  syncA2ASecretHandler,
  receiveA2ASecretHandler,
  setRequiredAuthProviderHandler,
} from "./handlers.js";

export {
  listAppRolesHandler,
  setAppRoleHandler,
} from "./app-roles-handlers.js";

export { isFreeEmailProvider } from "./free-email-providers.js";
