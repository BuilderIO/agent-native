/**
 * Framework-level sharing / privacy primitive.
 *
 * Templates make their resource tables ownable and register them here so the
 * shared share actions and UI work end-to-end. See
 * `.agents/skills/sharing/SKILL.md` for the full pattern.
 */

export {
  ownableColumns,
  createSharesTable,
  roleSatisfies,
  ROLE_RANK,
  type Visibility,
  type ShareRole,
  type PrincipalType,
} from "./schema.js";

export {
  registerShareableResource,
  getShareableResource,
  requireShareableResource,
  listShareableResources,
  type ShareableResourceRegistration,
} from "./registry.js";

export {
  accessFilter,
  resolveAccess,
  assertAccess,
  currentAccess,
  ForbiddenError,
  type AccessContext,
  type ResolvedAccess,
} from "./access.js";
