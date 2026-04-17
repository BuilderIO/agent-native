// Public API for the org module.

export type {
  OrgRole,
  OrgContext,
  OrgSummary,
  OrgInvitationSummary,
  OrgInfo,
  OrgMember,
  OrgPendingInvitation,
} from "./types.js";

export { getOrgContext } from "./context.js";

export { acceptPendingInvitationsForEmail } from "./accept-pending.js";
export type { AcceptPendingResult } from "./accept-pending.js";

export { ORG_MIGRATIONS } from "./migrations.js";

export { createOrgPlugin, defaultOrgPlugin } from "./plugin.js";

// Drizzle schema (re-exported so templates can write typed queries against
// org tables without redefining the schema themselves).
export { organizations, orgMembers, orgInvitations } from "./schema.js";

// Individual handlers — exported so templates can compose a custom org plugin
// while still using the framework-provided handlers.
export {
  getMyOrgHandler,
  createOrgHandler,
  switchOrgHandler,
  listMembersHandler,
  removeMemberHandler,
  listInvitationsHandler,
  createInvitationHandler,
  acceptInvitationHandler,
} from "./handlers.js";
