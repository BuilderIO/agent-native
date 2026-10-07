/**
 * Governance record for an org service principal (`svc-<name>@service.<orgId>`).
 *
 * A service token proves WHO is calling; this record says who is ACCOUNTABLE
 * for the principal, whether it may run at all, and which actions it may call.
 * Every entry point that admits a service identity (MCP admission, MCP tool
 * dispatch, agent run start) reads it through `evaluateServicePrincipal` so
 * suspend and the action grant are enforced in one place.
 *
 * Constraints that must survive future edits:
 *
 * 1. No row means a legacy principal minted before governance existed: it
 *    stays active and unrestricted ("ungoverned"). Tightening it is an explicit
 *    admin act, never a side effect of upgrading.
 * 2. An unreadable row is NOT an absent row. A read failure resolves to
 *    "unavailable" and callers refuse the request (503), because answering
 *    "ungoverned" would let a suspended principal back in during an outage.
 * 3. A grant is deny-by-default once `allowedActions` is a list: an empty list
 *    grants nothing, and `null` is the only unrestricted value.
 */
import { getDbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import { parseServiceIdentityEmail } from "./service-identity.js";

export const SERVICE_PRINCIPAL_LIFECYCLES = [
  "active",
  "suspended",
  "retired",
] as const;
export type ServicePrincipalLifecycle =
  (typeof SERVICE_PRINCIPAL_LIFECYCLES)[number];

export const SERVICE_PRINCIPAL_RISK_TIERS = ["low", "medium", "high"] as const;
export type ServicePrincipalRiskTier =
  (typeof SERVICE_PRINCIPAL_RISK_TIERS)[number];

export const MAX_SERVICE_PRINCIPAL_ACTIONS = 200;

const SERVICE_PRINCIPAL_ACTION_PATTERN = /^[A-Za-z0-9_.:-]+\*?$/;

export function isServicePrincipalActionPattern(value: string): boolean {
  return value.length <= 128 && SERVICE_PRINCIPAL_ACTION_PATTERN.test(value);
}

export interface ServicePrincipalPolicy {
  orgId: string;
  /** Normalized service name, the `<name>` in `svc-<name>@service.<orgId>`. */
  serviceName: string;
  /** Accountable human. Always an email, never the service identity. */
  ownerEmail: string | null;
  /** Operational team or on-call queue that answers for the principal. */
  team: string | null;
  riskTier: ServicePrincipalRiskTier;
  /** What the principal is for, in one line. */
  purpose: string | null;
  lifecycle: ServicePrincipalLifecycle;
  /** `null` is unrestricted. A list is the only set of actions it may call. */
  allowedActions: string[] | null;
  lifecycleReason: string | null;
  lifecycleChangedBy: string | null;
  lifecycleChangedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export type ServicePrincipalState =
  | { status: "not-service" }
  | { status: "ungoverned"; orgId: string; serviceName: string }
  | { status: "active"; policy: ServicePrincipalPolicy }
  | {
      status: "suspended" | "retired";
      policy: ServicePrincipalPolicy;
    }
  /** No verified org matches the address, so this is not the principal. */
  | { status: "org-mismatch" }
  | { status: "unavailable" };

let _initPromise: Promise<void> | undefined;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = ensureTableExists(
      "service_principal_policies",
      `CREATE TABLE IF NOT EXISTS service_principal_policies (
        org_id TEXT NOT NULL,
        service_name TEXT NOT NULL,
        owner_email TEXT,
        team TEXT,
        risk_tier TEXT NOT NULL DEFAULT 'medium',
        purpose TEXT,
        lifecycle TEXT NOT NULL DEFAULT 'active',
        allowed_actions TEXT,
        lifecycle_reason TEXT,
        lifecycle_changed_by TEXT,
        lifecycle_changed_at BIGINT,
        created_at BIGINT,
        updated_at BIGINT,
        PRIMARY KEY (org_id, service_name)
      )`,
    )
      .then(() => undefined)
      .catch((error) => {
        _initPromise = undefined;
        throw error;
      });
  }
  return _initPromise;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseAllowedActions(raw: unknown): string[] | null {
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    // coercion-ok: an unparseable grant fails closed to an empty (deny-all) list, never to unrestricted.
  } catch {
    // A stored grant we cannot parse must not widen to "unrestricted".
    return [];
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_SERVICE_PRINCIPAL_ACTIONS ||
    !parsed.every(
      (item): item is string =>
        typeof item === "string" && isServicePrincipalActionPattern(item),
    )
  ) {
    return [];
  }
  return parsed;
}

function mapRow(r: any): ServicePrincipalPolicy {
  const lifecycle = String(r.lifecycle ?? "active");
  const riskTier = String(r.risk_tier ?? r.riskTier ?? "medium");
  return {
    orgId: String(r.org_id ?? r.orgId),
    serviceName: String(r.service_name ?? r.serviceName),
    ownerEmail: (r.owner_email ?? r.ownerEmail ?? null) as string | null,
    team: (r.team ?? null) as string | null,
    riskTier: (SERVICE_PRINCIPAL_RISK_TIERS as readonly string[]).includes(
      riskTier,
    )
      ? (riskTier as ServicePrincipalRiskTier)
      : "high",
    purpose: (r.purpose ?? null) as string | null,
    // An unrecognized lifecycle fails closed rather than reading as active.
    lifecycle: (SERVICE_PRINCIPAL_LIFECYCLES as readonly string[]).includes(
      lifecycle,
    )
      ? (lifecycle as ServicePrincipalLifecycle)
      : "suspended",
    allowedActions: parseAllowedActions(
      r.allowed_actions ?? r.allowedActions ?? null,
    ),
    lifecycleReason: (r.lifecycle_reason ?? r.lifecycleReason ?? null) as
      | string
      | null,
    lifecycleChangedBy: (r.lifecycle_changed_by ??
      r.lifecycleChangedBy ??
      null) as string | null,
    lifecycleChangedAt: numOrNull(
      r.lifecycle_changed_at ?? r.lifecycleChangedAt,
    ),
    createdAt: numOrNull(r.created_at ?? r.createdAt),
    updatedAt: numOrNull(r.updated_at ?? r.updatedAt),
  };
}

const COLUMNS = `org_id, service_name, owner_email, team, risk_tier, purpose, lifecycle, allowed_actions, lifecycle_reason, lifecycle_changed_by, lifecycle_changed_at, created_at, updated_at`;

/** Throws when the store cannot be read; `null` means there is no record. */
export async function getServicePrincipalPolicy(
  orgId: string,
  serviceName: string,
): Promise<ServicePrincipalPolicy | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${COLUMNS} FROM service_principal_policies WHERE org_id = ? AND service_name = ? LIMIT 1`,
    args: [orgId, serviceName],
  });
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listServicePrincipalPolicies(
  orgId: string,
): Promise<ServicePrincipalPolicy[]> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${COLUMNS} FROM service_principal_policies WHERE org_id = ? ORDER BY service_name`,
    args: [orgId],
  });
  return rows.map(mapRow);
}

export interface ServicePrincipalPolicyInput {
  ownerEmail?: string | null;
  team?: string | null;
  riskTier?: ServicePrincipalRiskTier;
  purpose?: string | null;
  allowedActions?: string[] | null;
}

/**
 * Create or update the governance fields. Fields left `undefined` keep their
 * stored value; `null` clears one. Lifecycle changes go through
 * `setServicePrincipalLifecycle` so they always carry an actor and a reason.
 */
export async function upsertServicePrincipalPolicy(
  orgId: string,
  serviceName: string,
  input: ServicePrincipalPolicyInput,
): Promise<ServicePrincipalPolicy> {
  const now = Date.now();
  const updatedColumns = [
    input.ownerEmail !== undefined
      ? "owner_email = EXCLUDED.owner_email"
      : null,
    input.team !== undefined ? "team = EXCLUDED.team" : null,
    input.riskTier !== undefined ? "risk_tier = EXCLUDED.risk_tier" : null,
    input.purpose !== undefined ? "purpose = EXCLUDED.purpose" : null,
    input.allowedActions !== undefined
      ? "allowed_actions = EXCLUDED.allowed_actions"
      : null,
    "updated_at = EXCLUDED.updated_at",
  ].filter((column): column is string => column !== null);
  const allowedJson =
    input.allowedActions == null ? null : JSON.stringify(input.allowedActions);

  await getDbExec().execute({
    sql: `INSERT INTO service_principal_policies (org_id, service_name, owner_email, team, risk_tier, purpose, lifecycle, allowed_actions, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
          ON CONFLICT (org_id, service_name) DO UPDATE SET ${updatedColumns.join(", ")}`,
    args: [
      orgId,
      serviceName,
      input.ownerEmail ?? null,
      input.team ?? null,
      input.riskTier ?? "medium",
      input.purpose ?? null,
      allowedJson,
      now,
      now,
    ],
  });

  const saved = await getServicePrincipalPolicy(orgId, serviceName);
  if (!saved) {
    throw new Error("Service principal policy was not readable after write.");
  }
  return saved;
}

export class ServicePrincipalRetiredError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("A retired service principal cannot be resumed.");
    this.name = "ServicePrincipalRetiredError";
  }
}

export async function setServicePrincipalLifecycle(
  orgId: string,
  serviceName: string,
  lifecycle: ServicePrincipalLifecycle,
  change: { actorEmail: string; reason?: string | null },
): Promise<ServicePrincipalPolicy> {
  await ensureTable();
  const now = Date.now();
  // Upsert so a legacy principal with no record can be suspended in one step.
  await getDbExec().execute({
    sql: `INSERT INTO service_principal_policies (org_id, service_name, risk_tier, lifecycle, lifecycle_reason, lifecycle_changed_by, lifecycle_changed_at, created_at, updated_at) VALUES (?, ?, 'medium', ?, ?, ?, ?, ?, ?)
          ON CONFLICT (org_id, service_name) DO UPDATE SET lifecycle = EXCLUDED.lifecycle, lifecycle_reason = EXCLUDED.lifecycle_reason, lifecycle_changed_by = EXCLUDED.lifecycle_changed_by, lifecycle_changed_at = EXCLUDED.lifecycle_changed_at, updated_at = EXCLUDED.updated_at
          WHERE service_principal_policies.lifecycle != 'retired' OR EXCLUDED.lifecycle = 'retired'`,
    args: [
      orgId,
      serviceName,
      lifecycle,
      change.reason ?? null,
      change.actorEmail,
      now,
      now,
      now,
    ],
  });
  const saved = await getServicePrincipalPolicy(orgId, serviceName);
  if (!saved) {
    throw new Error("Service principal policy was not readable after write.");
  }
  if (saved.lifecycle === "retired" && lifecycle !== "retired") {
    throw new ServicePrincipalRetiredError();
  }
  return saved;
}

/**
 * Resolve whether a caller may run from its identity email and verified org.
 * Non-service identities return `not-service` without touching the database,
 * so the hot path for human callers is unchanged.
 */
export async function evaluateServicePrincipal(
  email: string | null | undefined,
  orgId?: string | null,
): Promise<ServicePrincipalState> {
  const parsed = parseServiceIdentityEmail(email);
  if (!parsed) return { status: "not-service" };
  // The email alone is not proof of the org (see service-identity.ts); require
  // a verified org claim before reading this principal's policy.
  if (!orgId || orgId !== parsed.orgId) return { status: "org-mismatch" };
  try {
    const policy = await getServicePrincipalPolicy(
      parsed.orgId,
      parsed.serviceName,
    );
    if (!policy) {
      return {
        status: "ungoverned",
        orgId: parsed.orgId,
        serviceName: parsed.serviceName,
      };
    }
    return policy.lifecycle === "active"
      ? { status: "active", policy }
      : { status: policy.lifecycle, policy };
  } catch (error) {
    console.error("[service-principal] Policy lookup failed:", error);
    return { status: "unavailable" };
  }
}

/** Whether the principal may call `actionName`. `null` grants everything. */
export function isActionGranted(
  allowedActions: string[] | null,
  actionName: string,
): boolean {
  if (allowedActions === null) return true;
  if (!allowedActions.every(isServicePrincipalActionPattern)) return false;
  return allowedActions.some((pattern) =>
    pattern.endsWith("*")
      ? actionName.startsWith(pattern.slice(0, -1))
      : pattern === actionName,
  );
}

/** Message returned to a refused caller; never echoes the stored reason. */
export const SERVICE_PRINCIPAL_SUSPENDED_MESSAGE =
  "This service principal is suspended or retired. Ask an organization admin to resume it.";
