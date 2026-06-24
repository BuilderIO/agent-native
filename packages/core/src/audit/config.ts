/**
 * Pure (no-DB) audit configuration helpers.
 *
 * Kept free of any database / store import so `action.ts` can statically
 * import them without pulling the DB client into every bundle that touches an
 * action. The DB-touching recorder lives in `record.ts`, which `action.ts`
 * loads lazily via dynamic import on first audited call.
 */
import type {
  ActionAuditConfig,
  AuditActorKind,
  AuditStatus,
} from "./types.js";

/**
 * High-frequency / ephemeral framework actions that are not meaningful audit
 * events. They mutate UI/agent-context state many times per session; auditing
 * each one would flood the log without recording a real user-facing change.
 *
 * An action can still force itself on with `audit: { enabled: true }` —
 * explicit config always wins over this denylist (see `shouldRecordAudit`).
 */
const DEFAULT_SKIP_ACTIONS = new Set<string>([
  "context-pin",
  "context-evict",
  "context-restore",
  "context-report",
  "context-manifest-get",
  "change-appearance",
  "toggle-demo-mode",
]);

/** Name patterns for high-frequency state-sync actions, skipped by default. */
const DEFAULT_SKIP_PATTERN =
  /(application-state|app-state|set-state|view-screen|navigate|poll)/i;

/** Normalize a raw `audit` option into a config object (or undefined). */
export function normalizeAuditConfig(
  raw: unknown,
): ActionAuditConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as ActionAuditConfig;
}

/**
 * Whether to attach the audit wrapper to an action at definition time. Decided
 * from the action's resolved `readOnly` flag plus its config — the action's
 * *name* isn't known here (it's the registry key), so name-based skipping
 * happens later in `shouldRecordAudit`.
 */
export function resolveAuditAttach(
  config: ActionAuditConfig | undefined,
  readOnly: boolean | undefined,
): boolean {
  if (config && typeof config.enabled === "boolean") return config.enabled;
  // Read-only actions are not audited unless they opt in via `onRead`.
  if (readOnly === true) return config?.onRead === true;
  // Everything else mutates — audit by default.
  return true;
}

/**
 * Final, name-aware decision made at record time. Explicit `enabled: true`
 * overrides the high-frequency denylist; otherwise denylisted names are
 * dropped.
 */
export function shouldRecordAudit(
  config: ActionAuditConfig | undefined,
  actionName: string,
): boolean {
  if (config && config.enabled === true) return true;
  if (DEFAULT_SKIP_ACTIONS.has(actionName)) return false;
  if (DEFAULT_SKIP_PATTERN.test(actionName)) return false;
  return true;
}

/** Derive the actor kind from the invocation surface + resolved identity. */
export function deriveActorKind(
  caller: string | undefined,
  actorEmail: string | undefined | null,
): AuditActorKind {
  if (caller === "tool") return "agent";
  return actorEmail ? "human" : "system";
}

/** Whether the whole subsystem is disabled via env. */
export function isAuditDisabled(): boolean {
  return process.env.AGENT_NATIVE_AUDIT_ENABLED === "false";
}

export type { AuditStatus };
