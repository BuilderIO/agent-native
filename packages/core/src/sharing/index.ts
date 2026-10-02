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
  isResourceAvailable,
  resolveAccessStatus,
  type AccessContext,
  type ResolvedAccess,
  type ResourceAccessState,
  type ResourceAccessStatus,
} from "./access.js";

export {
  ACCESS_REQUEST_NOTE_MAX_LENGTH,
  accessRequestReviewPath,
  approveAccessRequest,
  declineAccessRequest,
  getAccessRequestReview,
  listResourceAccessRequests,
  requestResourceAccess,
  resolveLinkStatus,
  type AccessRequestReview,
  type RequestResourceAccessResult,
  type ResourceLinkStatus,
  type ViewerAccessRequest,
} from "./access-requests.js";

export {
  filterRecipientsByResourceAccess,
  type FilterRecipientsInput,
} from "./recipients.js";
