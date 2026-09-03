/**
 * Framework audit log — a durable, complete, access-scoped, append-only record
 * of who mutated what app data, when, from where, and (for the agent) in which
 * run. Distinct from observability (sampled telemetry) and tracking
 * (fire-and-forget analytics). Capture is automatic at the `defineAction` seam.
 */
export type {
  ActionAuditConfig,
  AuditActorKind,
  AuditCallMeta,
  AuditEvent,
  AuditQueryFilters,
  AuditStatus,
  AuditTarget,
  AuditVisibility,
} from "./types.js";

export {
  deriveActorKind,
  isAuditDisabled,
  normalizeAuditConfig,
  resolveAuditAttach,
  shouldRecordAudit,
} from "./config.js";

export { redactArgsToJson } from "./redact.js";

export {
  ensureAuditTables,
  insertAuditEvent,
  queryAuditEvents,
  getAuditEventById,
  deleteOldAuditEvents,
  type AuditReadScope,
} from "./store.js";

export { recordActionAudit } from "./record.js";

export {
  runAuditCleanupOnce,
  startAuditCleanupJob,
  stopAuditCleanupJob,
} from "./cleanup-job.js";
