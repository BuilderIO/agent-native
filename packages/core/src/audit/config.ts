import type {
  ActionAuditConfig,
  AuditActorKind,
  AuditStatus,
} from "./types.js";

const DEFAULT_SKIP_ACTIONS = new Set<string>([
  "context-pin",
  "context-evict",
  "context-restore",
  "context-report",
  "context-manifest-get",
  "change-appearance",
]);

const DEFAULT_SKIP_PATTERN =
  /(application-state|app-state|set-state|view-screen|navigate|poll)/i;

export function normalizeAuditConfig(
  raw: unknown,
): ActionAuditConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as ActionAuditConfig;
}

export function resolveAuditAttach(
  config: ActionAuditConfig | undefined,
  readOnly: boolean | undefined,
): boolean {
  if (config && typeof config.enabled === "boolean") return config.enabled;
  if (readOnly === true) return config?.onRead === true;
  return true;
}

export function shouldRecordAudit(
  config: ActionAuditConfig | undefined,
  actionName: string,
): boolean {
  if (config && config.enabled === true) return true;
  if (DEFAULT_SKIP_ACTIONS.has(actionName)) return false;
  if (DEFAULT_SKIP_PATTERN.test(actionName)) return false;
  return true;
}

export function deriveActorKind(
  caller: string | undefined,
  actorEmail: string | undefined | null,
): AuditActorKind {
  if (caller === "tool") return "agent";
  return actorEmail ? "human" : "system";
}

export function isAuditDisabled(): boolean {
  return process.env.AGENT_NATIVE_AUDIT_ENABLED === "false";
}

export type { AuditStatus };
