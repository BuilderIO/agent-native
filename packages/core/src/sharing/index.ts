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
  type ShareEmailExtras,
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

export {
  filterRecipientsByResourceAccess,
  type FilterRecipientsInput,
} from "./recipients.js";
