// Public API for the org module.

function lazyFunction<TModule, TKey extends keyof TModule>(
  load: () => Promise<TModule>,
  name: TKey,
): TModule[TKey] {
  return ((...args: any[]) =>
    load().then((module) => {
      const implementation = module[name];
      if (typeof implementation !== "function") {
        throw new Error(`Org export ${String(name)} is not callable`);
      }
      return Reflect.apply(implementation, undefined, args);
    })) as TModule[TKey];
}

const loadOrgContext = () => import("./context.js");
const loadOrgFederation = () => import("./federation.js");
const loadOrgHandlers = () => import("./handlers.js");
const loadOrgAppRolesHandlers = () => import("./app-roles-handlers.js");
const loadOrgEnterpriseHandlers = () => import("./enterprise-auth-handlers.js");
const loadOrgPlugin = () => import("./plugin.js");

export type {
  OrgRole,
  OrgContext,
  OrgSummary,
  OrgInvitationSummary,
  OrgPendingRemoval,
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
  RequiredAuthProvider,
  WorkspaceAppDefaultVisibility,
} from "./types.js";

export {
  SIGN_IN_METHOD_ENV_VARS,
  type OrgSignInMethods,
  type SocialSignInMethod,
} from "./sign-in-methods.js";

export {
  canInviteOrgMembers,
  canManageOrg,
  canManageOrgA2ASecret,
  canManageOrgDomain,
  orgRoleAtLeast,
  orgRoleRank,
} from "./permissions.js";

export const getOrgContext = lazyFunction(loadOrgContext, "getOrgContext");
export const getOrgDomain = lazyFunction(loadOrgContext, "getOrgDomain");
export const getOrgA2ASecret = lazyFunction(loadOrgContext, "getOrgA2ASecret");
export const getA2ASecretByDomain = lazyFunction(
  loadOrgContext,
  "getA2ASecretByDomain",
);
export const isSoleOrgDomain = lazyFunction(loadOrgContext, "isSoleOrgDomain");
export const resolveOrgByDomain = lazyFunction(
  loadOrgContext,
  "resolveOrgByDomain",
);
export const resolveOrgIdForEmail = lazyFunction(
  loadOrgContext,
  "resolveOrgIdForEmail",
);
export const createOrganization = lazyFunction(
  loadOrgContext,
  "createOrganization",
);

export {
  implicitServiceOrgRole,
  parseServiceIdentityEmail,
} from "./service-identity.js";

export { acceptPendingInvitationsForEmail } from "./accept-pending.js";
export type { AcceptPendingResult } from "./accept-pending.js";

export { autoJoinDomainMatchingOrgs } from "./auto-join-domain.js";
export type { AutoJoinDomainResult } from "./auto-join-domain.js";
export { setActiveOrgId } from "./active-org.js";
export { invalidateMemberOrgCaches } from "./request-org-cache.js";
export { isMissingOrganizationTableError } from "./membership.js";
export { offboardMember } from "../identity/offboard.js";
export type {
  OffboardMemberOptions,
  OffboardMemberResult,
} from "../identity/offboard.js";
export {
  claimWorkspaceAppForOrganization,
  isStandaloneDispatchRuntime,
  isWorkspaceAppAccessAllowed,
} from "./workspace-app-access.js";

export {
  defineAppRoles,
  getRegisteredAppRoles,
  listRegisteredAppRoles,
  listAppMemberRoles,
  resolveAppRole,
  setAppMemberRole,
  setAppMemberRoles,
  applyInvitationAppRoles,
  getAppPermissionOverrides,
  setAppPermissionRoles,
  resolveAppAuthorizationContext,
} from "./app-roles.js";
export type {
  AppRoles,
  AppRolesDescriptor,
  AppRoleCaller,
  AppRoleLookup,
  AppMemberRoleRow,
  AppAuthorizationContext,
} from "./app-roles.js";

export { ORG_MIGRATIONS } from "./migrations.js";

export {
  CROSS_APP_ORG_FEDERATION_FLAG,
  CROSS_APP_ORG_FEDERATION_SCOPE,
} from "./feature-flags.js";

export const addFederatedOrganizationMember = lazyFunction(
  loadOrgFederation,
  "addFederatedOrganizationMember",
);
export const provisionFederatedOrganization = lazyFunction(
  loadOrgFederation,
  "provisionFederatedOrganization",
);
export const revokeFederatedOrganizationMember = lazyFunction(
  loadOrgFederation,
  "revokeFederatedOrganizationMember",
);
export const syncOrganizationToIdentityHub = lazyFunction(
  loadOrgFederation,
  "syncOrganizationToIdentityHub",
);
export const validateFederatedOrganizationMembership = lazyFunction(
  loadOrgFederation,
  "validateFederatedOrganizationMembership",
);
export const validateFederatedOrganizationMembershipForCurrentRequest =
  lazyFunction(
    loadOrgFederation,
    "validateFederatedOrganizationMembershipForCurrentRequest",
  );
export const updateFederatedOrganizationMemberRole = lazyFunction(
  loadOrgFederation,
  "updateFederatedOrganizationMemberRole",
);
export type {
  FederatedOrganizationIdentity,
  FederatedMembershipValidation,
  FederatedOrganizationSyncInput,
} from "./federation.js";

export {
  getRequiredAuthProviderForEmail,
  getRequiredAuthProviderForOrg,
  isGoogleSignInRequiredForEmail,
  setRequiredAuthProvider,
} from "./auth-policy.js";

export const createOrgPlugin: (typeof import("./plugin.js"))["createOrgPlugin"] =
  ((...args: any[]) =>
    (...nitroArgs: any[]) =>
      loadOrgPlugin().then(({ createOrgPlugin }) => {
        const plugin = Reflect.apply(createOrgPlugin, undefined, args) as (
          ...args: any[]
        ) => unknown;
        return Reflect.apply(plugin, undefined, nitroArgs);
      })) as (typeof import("./plugin.js"))["createOrgPlugin"];
export const defaultOrgPlugin = createOrgPlugin();

// Drizzle schema (re-exported so templates can write typed queries against
// org tables without redefining the schema themselves).
export {
  organizations,
  orgMembers,
  orgInvitations,
  appMemberRoles,
  appPermissionOverrides,
  orgScimMemberships,
  workspaceApps,
  workspaceAppShares,
} from "./schema.js";

export const listSSOProvidersHandler = lazyFunction(
  loadOrgEnterpriseHandlers,
  "listSSOProvidersHandler",
);
export const createSSOProviderHandler = lazyFunction(
  loadOrgEnterpriseHandlers,
  "createSSOProviderHandler",
);
export const verifySSOProviderHandler = lazyFunction(
  loadOrgEnterpriseHandlers,
  "verifySSOProviderHandler",
);
export const deleteSSOProviderHandler = lazyFunction(
  loadOrgEnterpriseHandlers,
  "deleteSSOProviderHandler",
);
export const getSCIMHandler = lazyFunction(
  loadOrgEnterpriseHandlers,
  "getSCIMHandler",
);
export const createSCIMHandler = lazyFunction(
  loadOrgEnterpriseHandlers,
  "createSCIMHandler",
);
export const deleteSCIMHandler = lazyFunction(
  loadOrgEnterpriseHandlers,
  "deleteSCIMHandler",
);

// Individual handlers — exported so templates can compose a custom org plugin
// while still using the framework-provided handlers.
export const getMyOrgHandler = lazyFunction(loadOrgHandlers, "getMyOrgHandler");
export const createOrgHandler = lazyFunction(
  loadOrgHandlers,
  "createOrgHandler",
);
export const updateOrgHandler = lazyFunction(
  loadOrgHandlers,
  "updateOrgHandler",
);
export const switchOrgHandler = lazyFunction(
  loadOrgHandlers,
  "switchOrgHandler",
);
export const listMembersHandler = lazyFunction(
  loadOrgHandlers,
  "listMembersHandler",
);
export const removeMemberHandler = lazyFunction(
  loadOrgHandlers,
  "removeMemberHandler",
);
export const retryPendingFederatedRemovalHandler = lazyFunction(
  loadOrgHandlers,
  "retryPendingFederatedRemovalHandler",
);
export const changeMemberRoleHandler = lazyFunction(
  loadOrgHandlers,
  "changeMemberRoleHandler",
);
export const listInvitationsHandler = lazyFunction(
  loadOrgHandlers,
  "listInvitationsHandler",
);
export const createInvitationHandler: (typeof import("./handlers.js"))["createInvitationHandler"] =
  lazyFunction(loadOrgHandlers, "createInvitationHandler");
export const acceptInvitationHandler = lazyFunction(
  loadOrgHandlers,
  "acceptInvitationHandler",
);
export const setA2ASecretHandler = lazyFunction(
  loadOrgHandlers,
  "setA2ASecretHandler",
);
export const syncA2ASecretHandler = lazyFunction(
  loadOrgHandlers,
  "syncA2ASecretHandler",
);
export const receiveA2ASecretHandler = lazyFunction(
  loadOrgHandlers,
  "receiveA2ASecretHandler",
);
export const setRequiredAuthProviderHandler = lazyFunction(
  loadOrgHandlers,
  "setRequiredAuthProviderHandler",
);
export const setWorkspaceAppDefaultVisibilityHandler = lazyFunction(
  loadOrgHandlers,
  "setWorkspaceAppDefaultVisibilityHandler",
);
export const setOrgVisualIdentityHandler = lazyFunction(
  loadOrgHandlers,
  "setOrgVisualIdentityHandler",
);

export const listAppRolesHandler = lazyFunction(
  loadOrgAppRolesHandlers,
  "listAppRolesHandler",
);
export const setAppRoleHandler = lazyFunction(
  loadOrgAppRolesHandlers,
  "setAppRoleHandler",
);

export { isFreeEmailProvider } from "./free-email-providers.js";

export { isOrgMember } from "./membership.js";
