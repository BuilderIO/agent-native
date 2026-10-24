import { getDbExec, type DbExec, type DbExecStatement } from "../db/client.js";
import { RESUME_AUTOMATION_PATCH } from "../jobs/automation-outcome.js";
import { isValidCron, isValidTimezone, nextOccurrence } from "../jobs/cron.js";
import {
  assertDelegatedPolicyId,
  assertJobRunnerTarget,
  buildJobResourceContent,
  isRecoveredFactoryJob,
  jobBelongsToApp,
  normalizeJobMcpTools,
  parseJobResource,
  patchJobFrontmatterFields,
  replaceJobResourceBody,
  type JobFrontmatter,
  type JobFrontmatterPatch,
} from "../jobs/frontmatter.js";
import {
  deleteAutomationRunsWithDb,
  ensureAutomationRunHistoryReady,
  prepareAutomationRunsDelete,
} from "../jobs/run-history.js";
import { applyJobResourceEdit } from "../jobs/update-job-resource.js";
import { resolveUserSchedulingTimezone } from "../localization/user-timezone.js";
import {
  organizationIdFromResourceOwner,
  organizationResourceOwner,
  ensureResourceStoreReady,
  prepareResourceBatchAssertion,
  prepareResourceCreate,
  prepareResourceDelete,
  prepareResourceUpdate,
  resourceGetByPath,
  resourceList,
  resourcePutWithDb,
  resourceDelete,
  SHARED_OWNER,
  type Resource,
  type TransactionScopedResourceWrite,
} from "../resources/store.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import {
  isReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import {
  deleteAutomationWebhookToken,
  readAutomationWebhookPath,
  saveAutomationWebhookToken,
} from "../triggers/webhook-store.js";
import {
  createAutomationWebhookToken,
  automationWebhookPath,
} from "../triggers/webhook.js";
import {
  listAccessibleAutomations,
  resolveAutomationAccess,
  type AccessibleAutomation,
} from "./access.js";
import {
  deleteAutomationSharingStateWithDb,
  ensureAutomationSharingTables,
  prepareAutomationSharingDelete,
  prepareAutomationSharingReplacement,
  normalizeAutomationSharingEmail,
  replaceAutomationSharingStateWithDb,
  type CompleteAutomationSharingState,
} from "./sharing-store.js";

export type AutomationScope = "personal" | "organization";

export const DEFAULT_AUTOMATION_SCHEDULE = "0 * * * *";

export interface AutomationActor {
  userEmail: string;
  orgId?: string | null;
  appId?: string | null;
}

export interface AutomationDefinition {
  resource: Resource;
  name: string;
  scope: AutomationScope;
  meta: JobFrontmatter & {
    triggerType: "schedule" | "event" | "manual" | "webhook";
    mode: "agentic" | "deterministic";
  };
  body: string;
  canUpdate: boolean;
  webhookPath?: string;
}

/** The updated definition plus what the write changed, for change cards. */
export interface AutomationUpdateResult extends AutomationDefinition {
  /** Whether the persisted automation differs from the pre-update file. */
  changed: boolean;
  /** The enabled value the file had before the update. */
  previouslyEnabled: boolean;
  /** The enabled value the caller asked for, when it asked for one. */
  requestedEnabled?: boolean;
}

export interface AccessibleAutomationDefinition extends AccessibleAutomation {
  scope: AutomationScope;
  /** Compatibility alias for callers not yet migrated to capabilities.canEdit. */
  canUpdate: boolean;
  webhookPath?: string;
}

export interface AutomationDelivery {
  originScopeId?: string;
  platform?: string;
  destination?: string;
  threadRef?: string;
  tenantId?: string;
}

export interface DefineAutomationInput {
  name: string;
  scope: AutomationScope;
  triggerType: "schedule" | "event" | "manual" | "webhook";
  body: string;
  enabled?: boolean;
  schedule?: string;
  timezone?: string;
  event?: string;
  condition?: string;
  domain?: string;
  delegatedPolicyId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  executionHostId?: string;
  executionEngine?: string;
  executionCwd?: string;
  mcpTools?: unknown;
  delivery?: AutomationDelivery;
  sharing?: CompleteAutomationSharingState;
  acknowledgeExternalCollaborators?: boolean;
}

export type DefinedAutomation = Omit<AutomationDefinition, "resource"> & {
  resourceId: string;
};

export interface UpdateAutomationInput {
  resourceId?: string;
  name?: string;
  scope?: AutomationScope;
  triggerType?: "schedule" | "event" | "manual" | "webhook";
  enabled?: boolean;
  body?: string;
  event?: string;
  condition?: string | null;
  delegatedPolicyId?: string | null;
  schedule?: string;
  timezone?: string;
  model?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  executionHostId?: string | null;
  executionEngine?: string | null;
  executionCwd?: string | null;
  mcpTools?: unknown;
  sharing?: CompleteAutomationSharingState;
  acknowledgeExternalCollaborators?: boolean;
}

interface OrganizationMembership {
  role: string;
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeExecutionTarget(
  value: string | null | undefined,
  label: string,
  options: { opaque?: boolean; max?: number } = {},
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const max = options.max ?? (options.opaque ? 128 : 1024);
  if (
    normalized.length > max ||
    /[\r\n]/.test(normalized) ||
    (options.opaque && !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(normalized))
  ) {
    throw httpError(
      `${label} must be a bounded identifier${options.opaque ? " using letters, numbers, dots, underscores, colons, or hyphens" : ""}.`,
      400,
    );
  }
  return normalized;
}

function normalizeActor(actor: AutomationActor): AutomationActor {
  const userEmail = actor.userEmail.trim().toLowerCase();
  if (!userEmail) throw httpError("Not authenticated.", 401);
  return {
    userEmail,
    orgId: actor.orgId?.trim() || null,
    appId: actor.appId?.trim() || null,
  };
}

function automationName(path: string): string {
  return path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

function automationPath(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  if (!normalized) {
    throw httpError("Automation name is required (lowercase, hyphens).", 400);
  }
  return `jobs/${normalized}.md`;
}

function ownerForScope(actor: AutomationActor, scope: AutomationScope): string {
  if (scope === "personal") return actor.userEmail;
  if (!actor.orgId) {
    throw httpError(
      "An organization is required for organization automations.",
      400,
    );
  }
  return organizationResourceOwner(actor.orgId);
}

async function readOrganizationMembership(
  orgId: string,
  email: string,
): Promise<OrganizationMembership | null> {
  const role = await readOrgMemberRole(orgId, email);
  return role ? { role } : null;
}

async function requireOrganizationMembership(
  actor: AutomationActor,
): Promise<OrganizationMembership> {
  if (!actor.orgId) {
    throw httpError(
      "An organization is required for organization automations.",
      400,
    );
  }
  const membership = await readOrganizationMembership(
    actor.orgId,
    actor.userEmail,
  );
  if (!membership) {
    throw httpError("You are no longer a member of this organization.", 403);
  }
  return membership;
}

function isOrganizationAdmin(membership: OrganizationMembership): boolean {
  return membership.role === "owner" || membership.role === "admin";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function validateSharingState(
  actor: AutomationActor,
  input: CompleteAutomationSharingState,
  owningOrganizationId: string | null,
  acknowledgeExternalCollaborators: boolean | undefined,
): Promise<CompleteAutomationSharingState> {
  if (input.kind === "personal") return input;

  const requestedOrganizationId =
    input.kind === "organization"
      ? input.organizationId.trim()
      : input.organizationId?.trim() || null;
  if (input.kind === "organization" && !requestedOrganizationId) {
    throw httpError(
      "An organization is required for organization sharing.",
      400,
    );
  }
  if (
    owningOrganizationId &&
    requestedOrganizationId &&
    requestedOrganizationId !== owningOrganizationId
  ) {
    throw httpError(
      "Automation sharing must use the automation's owning organization.",
      400,
    );
  }
  const organizationId = owningOrganizationId ?? requestedOrganizationId;
  if (organizationId) {
    if (actor.orgId !== organizationId) {
      throw httpError(
        "The automation's organization must be the current organization.",
        400,
      );
    }
    await requireOrganizationMembership(actor);
  }

  if (input.kind === "organization") {
    return { kind: "organization", organizationId: organizationId! };
  }
  if (input.kind !== "specific") {
    throw httpError("Unsupported automation sharing state.", 400);
  }

  if (!input.grants.length) {
    throw httpError("Specific sharing requires at least one account.", 400);
  }
  const grants = input.grants.map((grant) => {
    const email = normalizeAutomationSharingEmail(grant.email);
    if (!EMAIL_RE.test(email)) {
      throw httpError(`Invalid sharing account email "${email}".`, 400);
    }
    if (grant.role !== "view" && grant.role !== "collaborate") {
      throw httpError("Sharing role must be view or collaborate.", 400);
    }
    return { email, role: grant.role };
  });
  if (new Set(grants.map((grant) => grant.email)).size !== grants.length) {
    throw httpError("Sharing accounts must be unique.", 400);
  }

  const placeholders = grants.map(() => "?").join(", ");
  const accounts = await getDbExec().execute({
    sql: `SELECT LOWER(email) AS email FROM "user" WHERE LOWER(email) IN (${placeholders})`,
    args: grants.map((grant) => grant.email),
  });
  const existing = new Set(
    accounts.rows.map((row) =>
      String(row.email ?? "")
        .trim()
        .toLowerCase(),
    ),
  );
  const missing = grants
    .map((grant) => grant.email)
    .filter((email) => !existing.has(email));
  if (missing.length) {
    throw httpError(
      `Sharing accounts do not exist: ${missing.join(", ")}.`,
      400,
    );
  }

  if (organizationId) {
    const memberships = await getDbExec().execute({
      sql: `SELECT LOWER(email) AS email FROM org_members WHERE org_id = ? AND LOWER(email) IN (${placeholders})`,
      args: [organizationId, ...grants.map((grant) => grant.email)],
    });
    const memberEmails = new Set(
      memberships.rows.map((row) =>
        String(row.email ?? "")
          .trim()
          .toLowerCase(),
      ),
    );
    const outsideCollaborators = grants.filter(
      (grant) => grant.role === "collaborate" && !memberEmails.has(grant.email),
    );
    if (outsideCollaborators.length && !acknowledgeExternalCollaborators) {
      throw httpError(
        `Acknowledge outside-organization collaborators before sharing with: ${outsideCollaborators.map((grant) => grant.email).join(", ")}.`,
        400,
      );
    }
  }

  return {
    kind: "specific",
    organizationId,
    grants,
  };
}

interface D1AutomationMutation<T> {
  statements: readonly DbExecStatement[];
  value: T;
  successStatementIndex: number;
  condition: { sql: string; args: readonly unknown[] };
  conflictError: () => Error;
}

async function runAtomicAutomationMutation<T>(
  work: (tx: DbExec) => Promise<T>,
  d1: D1AutomationMutation<T>,
): Promise<T> {
  await Promise.all([
    ensureResourceStoreReady(),
    ensureAutomationSharingTables(),
  ]);
  const client = getDbExec();
  if (client.atomicBatch) {
    const assertion = prepareResourceBatchAssertion(d1.condition);
    const statements: DbExecStatement[] = [
      ...assertion.statements,
      ...d1.statements,
      assertion.cleanupStatement,
    ];
    try {
      const results = await client.atomicBatch(statements);
      if (results[d1.successStatementIndex + 2]?.rowsAffected !== 1) {
        throw d1.conflictError();
      }
      return d1.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique constraint failed:\s*resources\./i.test(message)) {
        throw d1.conflictError();
      }
      if (message !== "This database does not support atomic batches.") {
        throw error;
      }
    }
  }
  if (!client.transaction) {
    throw new Error("Atomic automation writes require transaction support.");
  }
  return client.transaction(work);
}

function resourceGuard(resource: Resource): {
  sql: string;
  args: readonly unknown[];
} {
  return {
    sql: "SELECT 1 FROM resources WHERE id = ? AND owner = ? AND path = ? AND updated_at = ? AND content = ?",
    args: [
      resource.id,
      resource.owner,
      resource.path,
      resource.updatedAt,
      resource.content,
    ],
  };
}

function definitionFromAccess(
  access: AccessibleAutomation,
): AutomationDefinition {
  if (access.classification.kind !== "automation") {
    throw httpError(
      `"${access.name}" is a legacy scheduled job. Use manage-jobs for compatibility.`,
      400,
    );
  }
  return {
    resource: access.resource,
    name: access.name,
    scope: access.owningOrganizationId ? "organization" : "personal",
    meta: {
      ...access.meta,
      triggerType: access.classification.triggerType,
      mode: access.meta.mode ?? "agentic",
    },
    body: access.body,
    canUpdate: access.capabilities.canEdit,
  };
}

export async function canUpdateAutomationResource(
  actorInput: AutomationActor,
  resource: Resource,
): Promise<boolean> {
  const { meta } = parseJobResource(resource.content);
  const actor = normalizeActor(actorInput);
  if (!jobBelongsToApp(meta, actor.appId)) return false;
  const access = await resolveAutomationAccess(actor, resource.id);
  if (access?.capabilities.canEdit) return true;
  const resourceOrgId = organizationIdFromResourceOwner(resource.owner);
  if (resource.owner !== SHARED_OWNER && !resourceOrgId) return false;
  const orgId = resourceOrgId ?? meta.orgId ?? actor.orgId;
  if (!orgId || actor.orgId !== orgId) return false;
  const membership = await readOrganizationMembership(orgId, actor.userEmail);
  return membership ? isOrganizationAdmin(membership) : false;
}

export async function canQueueAutomationRunNow(
  actorInput: AutomationActor,
  resource: Resource,
  scope: AutomationScope,
  additionalJobAppIds?: readonly string[],
): Promise<boolean> {
  const { meta } = parseJobResource(resource.content);
  const actor = normalizeActor(actorInput);
  const recoveredFactory = isRecoveredFactoryJob(
    meta,
    resource.path,
    actor.appId,
    resource.owner,
  );
  if (
    !jobBelongsToApp(meta, actor.appId, additionalJobAppIds) &&
    !recoveredFactory
  ) {
    return false;
  }
  const access = await resolveAutomationAccess(actor, resource.id);
  if (access?.capabilities.canOperate) return true;
  const resourceOrgId = organizationIdFromResourceOwner(resource.owner);
  if (
    scope === "organization" &&
    Boolean(resourceOrgId) &&
    actor.orgId === resourceOrgId &&
    actor.appId === "factory" &&
    (meta.domain === "factory" || recoveredFactory)
  ) {
    const membership = await readOrganizationMembership(
      resourceOrgId!,
      actor.userEmail,
    );
    return membership ? isOrganizationAdmin(membership) : false;
  }
  return false;
}

function assertExplicitAutomation(
  resource: Resource,
): Omit<AutomationDefinition, "name" | "scope" | "canUpdate"> {
  const parsed = parseJobResource(resource.content);
  if (parsed.classification.kind !== "automation") {
    throw httpError(
      `"${automationName(resource.path)}" is a legacy scheduled job. Use manage-jobs for compatibility.`,
      400,
    );
  }
  return {
    resource,
    meta: {
      ...parsed.meta,
      triggerType: parsed.classification.triggerType,
      mode: parsed.meta.mode ?? "agentic",
    },
    body: parsed.body,
  };
}

async function readDefinition(
  actorInput: AutomationActor,
  scope: AutomationScope,
  name: string,
): Promise<AutomationDefinition> {
  const actor = normalizeActor(actorInput);
  if (scope === "organization") await requireOrganizationMembership(actor);
  const owner = ownerForScope(actor, scope);
  const path = automationPath(name);
  const resource = await resourceGetByPath(owner, path);
  if (!resource) {
    throw httpError(`Automation "${automationName(path)}" not found.`, 404);
  }
  const definition = assertExplicitAutomation(resource);
  if (!jobBelongsToApp(definition.meta, actor.appId)) {
    throw httpError(`Automation "${automationName(path)}" not found.`, 404);
  }
  const access = await resolveAutomationAccess(actor, resource.id);
  if (!access) {
    throw httpError(`Automation "${automationName(path)}" not found.`, 404);
  }
  const webhookPath =
    access.capabilities.canEdit && definition.meta.triggerType === "webhook"
      ? await readAutomationWebhookPath(resource, definition.meta)
      : undefined;
  return {
    ...definitionFromAccess(access),
    scope,
    webhookPath,
  };
}

async function readDefinitionForUpdate(
  actorInput: AutomationActor,
  input: UpdateAutomationInput,
): Promise<{ definition: AutomationDefinition; access: AccessibleAutomation }> {
  const actor = normalizeActor(actorInput);
  let access: AccessibleAutomation | null;
  if (input.resourceId?.trim()) {
    access = await resolveAutomationAccess(actor, input.resourceId.trim());
  } else {
    if (!input.scope || !input.name) {
      throw httpError(
        "Automation resource id or name and scope is required.",
        400,
      );
    }
    const definition = await readDefinition(actor, input.scope, input.name);
    access = await resolveAutomationAccess(actor, definition.resource.id);
  }
  if (!access || access.classification.kind !== "automation") {
    throw httpError("Automation not found.", 404);
  }
  if (!jobBelongsToApp(access.meta, actor.appId)) {
    throw httpError("Automation not found.", 404);
  }
  const definition = definitionFromAccess(access);
  const webhookPath =
    access.capabilities.canEdit && access.meta.triggerType === "webhook"
      ? await readAutomationWebhookPath(access.resource, access.meta)
      : undefined;
  return { definition: { ...definition, webhookPath }, access };
}

export async function listAccessibleAutomationDefinitions(
  actorInput: AutomationActor,
): Promise<AccessibleAutomationDefinition[]> {
  const actor = normalizeActor(actorInput);
  const definitions = await listAccessibleAutomations(actor);
  return Promise.all(
    definitions.map(async (definition) => ({
      ...definition,
      meta: {
        ...definition.meta,
        triggerType:
          definition.classification.kind === "automation"
            ? definition.classification.triggerType
            : "schedule",
      },
      scope: definition.owningOrganizationId ? "organization" : "personal",
      canUpdate: definition.capabilities.canEdit,
      webhookPath:
        definition.capabilities.canEdit &&
        definition.classification.triggerType === "webhook"
          ? await readAutomationWebhookPath(
              definition.resource,
              definition.meta,
            )
          : undefined,
    })),
  );
}

/**
 * Scoped explicit-only compatibility wrapper. New list consumers should use
 * listAccessibleAutomationDefinitions so shared and legacy rows are not split
 * into parallel authorization paths.
 */
export async function listAutomationDefinitions(
  actorInput: AutomationActor,
  scope: AutomationScope,
): Promise<AutomationDefinition[]> {
  const actor = normalizeActor(actorInput);
  const membership =
    scope === "organization"
      ? await requireOrganizationMembership(actor)
      : undefined;
  const owner = ownerForScope(actor, scope);
  const resources = await resourceList(owner, "jobs/");
  const automations: AutomationDefinition[] = [];

  for (const resourceMeta of resources) {
    if (
      !resourceMeta.path.endsWith(".md") ||
      resourceMeta.path.endsWith(".keep")
    ) {
      continue;
    }
    const resource = await resourceGetByPath(owner, resourceMeta.path);
    if (!resource) continue;
    const parsed = parseJobResource(resource.content);
    if (parsed.classification.kind !== "automation") continue;
    if (!jobBelongsToApp(parsed.meta, actor.appId)) continue;
    const isCreator =
      parsed.meta.createdBy?.trim().toLowerCase() === actor.userEmail;
    const canUpdate =
      scope === "personal" ||
      isCreator ||
      (membership ? isOrganizationAdmin(membership) : false);
    automations.push({
      resource,
      name: automationName(resource.path),
      scope,
      meta: {
        ...parsed.meta,
        triggerType: parsed.classification.triggerType,
        mode: parsed.meta.mode ?? "agentic",
      },
      body: parsed.body,
      canUpdate,
      webhookPath:
        canUpdate && parsed.classification.triggerType === "webhook"
          ? await readAutomationWebhookPath(resource, parsed.meta)
          : undefined,
    });
  }

  return automations;
}

export async function defineAutomation(
  actorInput: AutomationActor,
  input: DefineAutomationInput,
): Promise<DefinedAutomation> {
  const actor = normalizeActor(actorInput);
  if (input.scope === "organization") {
    await requireOrganizationMembership(actor);
  }
  const owner = ownerForScope(actor, input.scope);
  const path = automationPath(input.name);
  if (await resourceGetByPath(owner, path)) {
    throw httpError(
      `An automation named "${automationName(path)}" already exists.`,
      409,
    );
  }
  const body = input.body.trim();
  if (!body) throw httpError("body is required.", 400);

  const schedule =
    input.triggerType === "schedule"
      ? input.schedule?.trim() || DEFAULT_AUTOMATION_SCHEDULE
      : "";
  const event = input.event?.trim() ?? "";
  if (input.triggerType === "schedule" && !isValidCron(schedule)) {
    throw httpError(
      schedule
        ? `invalid cron expression "${schedule}".`
        : "schedule is required for scheduled automations.",
      400,
    );
  }
  if (input.triggerType === "event" && !event) {
    throw httpError("event is required for event-triggered automations.", 400);
  }

  if (
    input.triggerType === "schedule" &&
    input.timezone &&
    !isValidTimezone(input.timezone)
  ) {
    throw httpError(`Unknown timezone "${input.timezone}".`, 400);
  }
  const timezone =
    input.triggerType === "schedule"
      ? input.timezone || (await resolveUserSchedulingTimezone(actor.userEmail))
      : undefined;

  if (
    input.reasoningEffort !== undefined &&
    !isReasoningEffort(input.reasoningEffort)
  ) {
    throw httpError(
      `Invalid reasoning effort "${input.reasoningEffort}".`,
      400,
    );
  }

  const mcpTools = normalizeJobMcpTools(input.mcpTools);
  const executionHostId = normalizeExecutionTarget(
    input.executionHostId,
    "execution_host_id",
    { opaque: true },
  );
  const executionEngine = normalizeExecutionTarget(
    input.executionEngine,
    "execution_engine",
    { opaque: true },
  );
  const executionCwd = normalizeExecutionTarget(
    input.executionCwd,
    "execution_cwd",
  );
  if (executionHostId && input.triggerType !== "schedule") {
    throw httpError(
      "Execution hosts are currently supported for scheduled code automations only.",
      400,
    );
  }
  const meta: JobFrontmatter = {
    schedule: input.triggerType === "schedule" ? schedule : "",
    ...(timezone ? { timezone } : {}),
    enabled: input.enabled ?? true,
    triggerType: input.triggerType,
    ...(input.triggerType === "event" ? { event } : {}),
    ...(input.triggerType === "event" && input.condition?.trim()
      ? { condition: input.condition.trim() }
      : {}),
    mode: "agentic",
    domain: input.domain?.trim() || undefined,
    appId: actor.appId || undefined,
    delegatedPolicyId: input.delegatedPolicyId?.trim() || undefined,
    createdBy: actor.userEmail,
    orgId: input.scope === "organization" ? actor.orgId! : undefined,
    runAs: "creator",
    ...(input.triggerType === "schedule"
      ? {
          nextRun: nextOccurrence(schedule, undefined, timezone).toISOString(),
        }
      : {}),
    model: input.model?.trim() || undefined,
    reasoningEffort: input.reasoningEffort,
    executionHostId,
    executionEngine,
    executionCwd,
    mcpTools: mcpTools?.length ? mcpTools : undefined,
    originScopeId: input.delivery?.originScopeId,
    deliveryPlatform: input.delivery?.platform,
    deliveryDestination: input.delivery?.destination,
    deliveryThreadRef: input.delivery?.threadRef,
    deliveryTenantId: input.delivery?.tenantId,
  };
  const sharing = await validateSharingState(
    actor,
    input.sharing ??
      (input.scope === "organization"
        ? { kind: "organization", organizationId: actor.orgId! }
        : { kind: "personal" }),
    input.scope === "organization" ? actor.orgId! : null,
    input.acknowledgeExternalCollaborators,
  );
  const content = buildJobResourceContent(meta, body);
  const preparedWrite = prepareResourceCreate({
    id: crypto.randomUUID(),
    owner,
    path,
    content,
  });
  const preparedSharing = prepareAutomationSharingReplacement(
    preparedWrite.value.id,
    sharing,
    {
      guard: {
        sql: "SELECT 1 FROM resources WHERE id = ? AND owner = ? AND path = ?",
        args: [preparedWrite.value.id, owner, path],
      },
    },
  );
  let write: TransactionScopedResourceWrite<Resource> = preparedWrite;
  await runAtomicAutomationMutation(
    async (tx) => {
      const existing = await tx.execute({
        sql: "SELECT id FROM resources WHERE owner = ? AND path = ? LIMIT 1",
        args: [owner, path],
      });
      if (existing.rows.length) {
        throw httpError(
          `An automation named "${automationName(path)}" already exists.`,
          409,
        );
      }
      write = await resourcePutWithDb(tx, owner, path, content);
      await replaceAutomationSharingStateWithDb(tx, write.value.id, sharing);
    },
    {
      statements: [...preparedWrite.statements, ...preparedSharing.statements],
      value: undefined,
      successStatementIndex: 0,
      condition: {
        sql: "NOT EXISTS (SELECT 1 FROM resources WHERE owner = ? AND path = ?)",
        args: [owner, path],
      },
      conflictError: () =>
        httpError(
          `An automation named "${automationName(path)}" already exists.`,
          409,
        ),
    },
  );
  await write.notifyAfterCommit();
  let webhookPath: string | undefined;
  if (input.triggerType === "webhook") {
    const token = createAutomationWebhookToken();
    try {
      await saveAutomationWebhookToken(write.value, meta, token);
    } catch (error) {
      await Promise.all([
        resourceDelete(write.value.id).catch(() => undefined),
        deleteAutomationSharingStateWithDb(getDbExec(), write.value.id).catch(
          () => undefined,
        ),
      ]);
      throw error;
    }
    webhookPath = automationWebhookPath(token);
  }
  return {
    resourceId: write.value.id,
    name: automationName(path),
    scope: input.scope,
    meta: { ...meta, triggerType: input.triggerType, mode: "agentic" },
    body,
    canUpdate: true,
    webhookPath,
  };
}

export async function updateAutomation(
  actorInput: AutomationActor,
  input: UpdateAutomationInput,
): Promise<AutomationUpdateResult> {
  const actor = normalizeActor(actorInput);
  const { definition, access } = await readDefinitionForUpdate(actor, input);
  if (!access.capabilities.canEdit) {
    throw httpError(
      "Collaborate access is required to update an automation.",
      403,
    );
  }
  if (input.sharing && !access.capabilities.canManageSharing) {
    throw httpError("Only the automation owner can change sharing.", 403);
  }

  const currentMeta = { ...definition.meta };
  const meta: AutomationDefinition["meta"] = { ...currentMeta };
  const fields: JobFrontmatterPatch = {};
  const triggerType = input.triggerType ?? meta.triggerType;
  const triggerChanged = triggerType !== meta.triggerType;
  const schedule =
    input.schedule?.trim() ||
    (triggerChanged && triggerType === "schedule"
      ? meta.schedule || DEFAULT_AUTOMATION_SCHEDULE
      : meta.schedule);
  const event = input.event?.trim() ?? meta.event?.trim() ?? "";
  let scheduleTimezone: string | undefined;

  if (triggerType === "schedule") {
    if (input.event !== undefined || input.condition !== undefined) {
      throw httpError("Scheduled automations do not have event settings.", 400);
    }
    if (!isValidCron(schedule)) {
      throw httpError(
        schedule
          ? `Invalid cron expression "${schedule}".`
          : "schedule is required for scheduled automations.",
        400,
      );
    }
    const timezone =
      input.timezone ??
      meta.timezone ??
      (await resolveUserSchedulingTimezone(
        definition.meta.createdBy?.trim() || actor.userEmail,
      ));
    if (!isValidTimezone(timezone)) {
      throw httpError(`Unknown timezone "${timezone}".`, 400);
    }
    scheduleTimezone = timezone;
    meta.triggerType = "schedule";
    meta.schedule = schedule;
    meta.timezone = timezone;
    meta.event = undefined;
    meta.condition = undefined;
    meta.nextRun = nextOccurrence(schedule, undefined, timezone).toISOString();
    fields.triggerType = "schedule";
    fields.schedule = schedule;
    fields.timezone = timezone;
    fields.event = undefined;
    fields.condition = undefined;
    fields.nextRun = meta.nextRun;
  } else if (triggerType === "event") {
    if (input.schedule !== undefined || input.timezone !== undefined) {
      throw httpError("Event automations do not have schedule settings.", 400);
    }
    if (!event) {
      throw httpError(
        "event is required for event-triggered automations.",
        400,
      );
    }
    meta.triggerType = "event";
    meta.schedule = "";
    meta.timezone = undefined;
    meta.event = event;
    meta.nextRun = undefined;
    fields.triggerType = "event";
    fields.schedule = "";
    fields.timezone = undefined;
    fields.event = event;
    fields.nextRun = undefined;
    if (triggerChanged) {
      meta.condition = undefined;
      fields.condition = undefined;
    }
    if (input.condition !== undefined) {
      meta.condition = input.condition?.trim() || undefined;
      fields.condition = meta.condition;
    }
  } else if (triggerType === "manual" || triggerType === "webhook") {
    if (
      input.event !== undefined ||
      input.schedule !== undefined ||
      input.timezone !== undefined ||
      input.condition !== undefined
    ) {
      throw httpError(
        `${triggerType === "manual" ? "Manual" : "Webhook"} automations do not have trigger settings.`,
        400,
      );
    }
    meta.triggerType = triggerType;
    meta.schedule = "";
    meta.timezone = undefined;
    meta.event = undefined;
    meta.condition = undefined;
    meta.nextRun = undefined;
    fields.triggerType = triggerType;
    fields.schedule = "";
    fields.timezone = undefined;
    fields.event = undefined;
    fields.condition = undefined;
    fields.nextRun = undefined;
  }

  if (input.enabled !== undefined) {
    meta.enabled = input.enabled;
    fields.enabled = input.enabled;
    if (
      input.enabled &&
      (meta.pausedReason || meta.lastErrorCode || meta.consecutiveFailures) &&
      meta.lastStatus !== "running"
    ) {
      meta.lastStatus = undefined;
      meta.lastError = undefined;
      meta.lastErrorCode = undefined;
      meta.consecutiveFailures = undefined;
      meta.lastFailedEventId = undefined;
      meta.pausedReason = undefined;
      meta.pausedAt = undefined;
    }
    if (
      input.enabled &&
      triggerType === "schedule" &&
      meta.schedule &&
      isValidCron(meta.schedule)
    ) {
      meta.nextRun = nextOccurrence(
        meta.schedule,
        undefined,
        meta.timezone,
      ).toISOString();
      fields.nextRun = meta.nextRun;
    }
  }
  if (input.delegatedPolicyId !== undefined) {
    meta.delegatedPolicyId = input.delegatedPolicyId?.trim() || undefined;
    try {
      assertDelegatedPolicyId(meta.delegatedPolicyId);
    } catch (error) {
      throw httpError(
        error instanceof Error ? error.message : String(error),
        400,
      );
    }
    fields.delegatedPolicyId = meta.delegatedPolicyId;
  }
  if (input.model !== undefined) {
    meta.model = input.model?.trim() || undefined;
    fields.model = meta.model;
  }
  if (input.reasoningEffort !== undefined) {
    if (
      input.reasoningEffort !== null &&
      !isReasoningEffort(input.reasoningEffort)
    ) {
      throw httpError(
        `Invalid reasoning effort "${input.reasoningEffort}".`,
        400,
      );
    }
    meta.reasoningEffort = input.reasoningEffort ?? undefined;
    fields.reasoningEffort = meta.reasoningEffort;
  }
  if (input.executionHostId !== undefined) {
    if (input.executionHostId && triggerType !== "schedule") {
      throw httpError(
        "Execution hosts are currently supported for scheduled code automations only.",
        400,
      );
    }
    meta.executionHostId = normalizeExecutionTarget(
      input.executionHostId,
      "execution_host_id",
      { opaque: true },
    );
    try {
      assertJobRunnerTarget(meta);
    } catch (error) {
      throw httpError(
        error instanceof Error ? error.message : String(error),
        400,
      );
    }
    fields.executionHostId = meta.executionHostId;
  }
  if (input.executionEngine !== undefined) {
    meta.executionEngine = normalizeExecutionTarget(
      input.executionEngine,
      "execution_engine",
      { opaque: true },
    );
    fields.executionEngine = meta.executionEngine;
  }
  if (input.executionCwd !== undefined) {
    meta.executionCwd = normalizeExecutionTarget(
      input.executionCwd,
      "execution_cwd",
    );
    fields.executionCwd = meta.executionCwd;
  }
  if (input.mcpTools !== undefined) {
    const mcpTools = normalizeJobMcpTools(input.mcpTools);
    meta.mcpTools = mcpTools?.length ? mcpTools : undefined;
    fields.mcpTools = meta.mcpTools;
  }

  const owningOrganizationId = organizationIdFromResourceOwner(
    definition.resource.owner,
  );
  meta.createdBy = currentMeta.createdBy;
  meta.runAs = currentMeta.runAs;
  meta.orgId = currentMeta.orgId;
  if (owningOrganizationId) {
    meta.orgId = owningOrganizationId;
    meta.runAs = "creator";
    fields.orgId = meta.orgId;
    fields.runAs = meta.runAs;
  }

  const body = input.body === undefined ? definition.body : input.body.trim();
  if (!body) throw httpError("Automation body is required.", 400);
  const sharing = input.sharing
    ? await validateSharingState(
        actor,
        input.sharing,
        owningOrganizationId,
        input.acknowledgeExternalCollaborators,
      )
    : undefined;

  const failureStateOf = (job: JobFrontmatter) =>
    [
      job.lastStatus ?? "",
      job.pausedReason ?? "",
      job.pausedAt ?? "",
      job.lastError ?? "",
      job.lastErrorCode ?? "",
      job.lastFailedEventId ?? "",
      job.consecutiveFailures ?? 0,
    ].join("\u0000");
  const failureStateBeforeEdit = failureStateOf(currentMeta);
  const pausedReasonBeforeEdit = currentMeta.pausedReason;
  const pausedAtBeforeEdit = currentMeta.pausedAt;
  const liftsPause = Boolean(
    input.enabled &&
    (currentMeta.pausedReason ||
      currentMeta.lastErrorCode ||
      currentMeta.consecutiveFailures),
  );
  const liftsFailureState = Boolean(
    input.enabled &&
    currentMeta.lastStatus !== "running" &&
    (currentMeta.pausedReason ||
      currentMeta.lastErrorCode ||
      currentMeta.consecutiveFailures),
  );
  const deriveFields = (baseContent: string): JobFrontmatterPatch => {
    const latest = parseJobResource(baseContent).meta;
    const derived = { ...fields };
    if (triggerType === "schedule" && fields.nextRun !== undefined) {
      const writeSchedule = input.schedule !== undefined || triggerChanged;
      const writeTimezone = input.timezone !== undefined || triggerChanged;
      const nextSchedule = writeSchedule
        ? schedule
        : latest.schedule || schedule;
      const nextTimezone =
        writeTimezone || !latest.timezone ? scheduleTimezone : latest.timezone;
      if (!writeSchedule && latest.schedule) delete derived.schedule;
      if (!writeTimezone && latest.timezone) delete derived.timezone;
      derived.nextRun = nextOccurrence(
        nextSchedule,
        undefined,
        nextTimezone,
      ).toISOString();
    }
    if (
      liftsPause &&
      (latest.pausedReason ?? "") === (pausedReasonBeforeEdit ?? "") &&
      (latest.pausedAt ?? "") === (pausedAtBeforeEdit ?? "")
    ) {
      derived.pausedReason = undefined;
      derived.pausedAt = undefined;
    }
    if (
      liftsFailureState &&
      failureStateOf(latest) === failureStateBeforeEdit
    ) {
      Object.assign(derived, RESUME_AUTOMATION_PATCH);
    }
    return derived;
  };

  let newWebhookToken: string | undefined;
  if (triggerType === "webhook" && currentMeta.triggerType !== "webhook") {
    newWebhookToken = createAutomationWebhookToken();
    await saveAutomationWebhookToken(
      definition.resource,
      meta,
      newWebhookToken,
    );
  }

  let updated: Resource;
  let replacedContent: string;
  try {
    if (sharing) {
      const content = replaceJobResourceBody(
        patchJobFrontmatterFields(
          definition.resource.content,
          deriveFields(definition.resource.content),
        ),
        input.body === undefined ? definition.body : body,
      );
      const preparedWrite = prepareResourceUpdate({
        current: definition.resource,
        content,
      });
      const preparedSharing = prepareAutomationSharingReplacement(
        preparedWrite.value.id,
        sharing,
        { guard: resourceGuard(preparedWrite.value) },
      );
      let write: TransactionScopedResourceWrite<Resource> = preparedWrite;
      const conflictError = () =>
        httpError("Automation changed while it was being updated.", 409);
      await runAtomicAutomationMutation(
        async (tx) => {
          const result = await tx.execute(preparedWrite.statements[0]);
          if (result.rowsAffected !== 1) throw conflictError();
          await replaceAutomationSharingStateWithDb(
            tx,
            preparedWrite.value.id,
            sharing,
          );
          write = preparedWrite;
        },
        {
          statements: [
            ...preparedWrite.statements,
            ...preparedSharing.statements,
          ],
          value: undefined,
          successStatementIndex: 0,
          condition: resourceGuard(definition.resource),
          conflictError,
        },
      );
      await write.notifyAfterCommit();
      updated = write.value;
      replacedContent = definition.resource.content;
    } else {
      const result = await applyJobResourceEdit({
        resource: definition.resource,
        fields: deriveFields,
        revalidate: async (base) => {
          const latest = assertExplicitAutomation(base);
          if (!jobBelongsToApp(latest.meta, actor.appId)) return false;
          const latestAccess = await resolveAutomationAccess(actor, base.id);
          return Boolean(latestAccess?.capabilities.canEdit);
        },
        ...(input.body !== undefined ? { body } : {}),
      });
      if (!result.ok) {
        if (result.reason === "missing") {
          throw httpError(
            `Automation "${automationName(definition.resource.path)}" not found.`,
            404,
          );
        }
        if (result.reason === "unauthorized") {
          throw httpError(
            "Collaborate access is required to update an automation.",
            403,
          );
        }
        throw httpError(
          result.reason === "replaced"
            ? "The automation was replaced while it was being updated. Try again."
            : "The automation changed while it was being updated. Try again.",
          409,
        );
      }
      updated = result.resource;
      replacedContent = result.replacedContent;
    }
  } catch (error) {
    if (newWebhookToken) {
      await deleteAutomationWebhookToken(definition.resource, meta).catch(
        () => undefined,
      );
    }
    throw error;
  }

  if (currentMeta.triggerType === "webhook" && triggerType !== "webhook") {
    await deleteAutomationWebhookToken(definition.resource, currentMeta);
  }
  const landed = assertExplicitAutomation(updated);
  const replaced = parseJobResource(replacedContent);
  const changedField = (before: unknown, after: unknown) => before !== after;
  const requestedDiff =
    (input.body !== undefined && changedField(replaced.body, body)) ||
    (input.enabled !== undefined &&
      changedField(replaced.meta.enabled, meta.enabled)) ||
    (input.triggerType !== undefined &&
      changedField(replaced.classification.triggerType, triggerType)) ||
    (input.schedule !== undefined &&
      changedField(replaced.meta.schedule, meta.schedule)) ||
    (input.timezone !== undefined &&
      changedField(replaced.meta.timezone, meta.timezone)) ||
    (input.event !== undefined &&
      changedField(replaced.meta.event, meta.event)) ||
    (input.condition !== undefined &&
      changedField(replaced.meta.condition, meta.condition)) ||
    (input.delegatedPolicyId !== undefined &&
      changedField(replaced.meta.delegatedPolicyId, meta.delegatedPolicyId)) ||
    (input.model !== undefined &&
      changedField(replaced.meta.model, meta.model)) ||
    (input.reasoningEffort !== undefined &&
      changedField(replaced.meta.reasoningEffort, meta.reasoningEffort)) ||
    (input.executionHostId !== undefined &&
      changedField(replaced.meta.executionHostId, meta.executionHostId)) ||
    (input.executionEngine !== undefined &&
      changedField(replaced.meta.executionEngine, meta.executionEngine)) ||
    (input.executionCwd !== undefined &&
      changedField(replaced.meta.executionCwd, meta.executionCwd)) ||
    (input.mcpTools !== undefined &&
      changedField(
        JSON.stringify(replaced.meta.mcpTools ?? []),
        JSON.stringify(meta.mcpTools ?? []),
      )) ||
    (input.scope === "organization" &&
      (changedField(replaced.meta.orgId, meta.orgId) ||
        changedField(replaced.meta.runAs, meta.runAs))) ||
    input.sharing !== undefined;
  const webhookPath =
    triggerType === "webhook"
      ? newWebhookToken
        ? automationWebhookPath(newWebhookToken)
        : definition.webhookPath
      : undefined;

  return {
    ...definition,
    resource: updated,
    meta: landed.meta,
    body: landed.body,
    webhookPath,
    changed: requestedDiff,
    previouslyEnabled: replaced.meta.enabled,
    requestedEnabled: input.enabled,
  };
}

export type DeleteAutomationInput =
  | { resourceId: string }
  | { scope: AutomationScope; name: string };

export async function deleteAutomation(
  actorInput: AutomationActor,
  scopeOrInput: AutomationScope | DeleteAutomationInput,
  compatibilityName?: string,
): Promise<void> {
  const actor = normalizeActor(actorInput);
  const input: DeleteAutomationInput =
    typeof scopeOrInput === "string"
      ? { scope: scopeOrInput, name: compatibilityName ?? "" }
      : scopeOrInput;
  let access: AccessibleAutomation | null;
  if ("resourceId" in input) {
    access = await resolveAutomationAccess(actor, input.resourceId.trim());
  } else {
    const definition = await readDefinition(actor, input.scope, input.name);
    access = await resolveAutomationAccess(actor, definition.resource.id);
  }
  if (!access || access.classification.kind !== "automation") {
    throw httpError("Automation not found.", 404);
  }
  if (!jobBelongsToApp(access.meta, actor.appId)) {
    throw httpError("Automation not found.", 404);
  }
  const resourceOrgId = organizationIdFromResourceOwner(access.resource.owner);
  const adminOrgId = resourceOrgId ?? access.meta.orgId ?? actor.orgId;
  const membership =
    (access.resource.owner === SHARED_OWNER || resourceOrgId) &&
    Boolean(adminOrgId) &&
    adminOrgId === actor.orgId
      ? await readOrganizationMembership(adminOrgId!, actor.userEmail)
      : null;
  const isAdmin = membership ? isOrganizationAdmin(membership) : false;
  if (!access.capabilities.canDelete && !isAdmin) {
    throw httpError("Only the automation owner can delete it.", 403);
  }

  const definition = definitionFromAccess(access);
  await ensureAutomationRunHistoryReady();
  const preparedWrite = prepareResourceDelete(definition.resource);
  const guard = resourceGuard(definition.resource);
  const preparedSharing = prepareAutomationSharingDelete(
    definition.resource.id,
    guard,
  );
  const preparedHistory = prepareAutomationRunsDelete(
    definition.resource.owner,
    definition.name,
    guard,
  );
  const d1Statements = [
    ...preparedSharing.statements,
    preparedHistory,
    ...preparedWrite.statements,
  ];
  let write: TransactionScopedResourceWrite<boolean> = preparedWrite;
  const deleteConflictError = () =>
    httpError("Automation changed while it was being deleted.", 409);
  await runAtomicAutomationMutation(
    async (tx) => {
      const result = await tx.execute(preparedWrite.statements[0]);
      if (result.rowsAffected !== 1) throw deleteConflictError();
      write = preparedWrite;
      await deleteAutomationSharingStateWithDb(tx, definition.resource.id);
      await deleteAutomationRunsWithDb(
        tx,
        definition.resource.owner,
        definition.name,
      );
    },
    {
      statements: d1Statements,
      value: undefined,
      successStatementIndex: d1Statements.length - 1,
      condition: guard,
      conflictError: deleteConflictError,
    },
  );
  await write.notifyAfterCommit();
  if (definition.meta.triggerType === "webhook") {
    await deleteAutomationWebhookToken(definition.resource, definition.meta);
  }
}

export interface AutomationExecutionIdentity {
  userEmail: string;
  orgId?: string;
  orgScope?: "personal";
  defaultAgentEngineScope?: "deployment";
  eventOwner: string;
}

/**
 * `code` says whether the failure is permanent: `owner_missing` (the creator
 * or their membership is gone) and `config_invalid` (the stored identity can
 * never resolve) will not heal on their own, so callers disable the
 * automation instead of re-checking forever.
 */
export type AutomationExecutionIdentityResult =
  | { ok: true; identity: AutomationExecutionIdentity }
  | {
      ok: false;
      reason: string;
      code?: "owner_missing" | "owner_unverifiable" | "config_invalid";
    };

/**
 * What the built-in `"user"` table says about an account. Deployments whose
 * sessions come from a custom `getSession` have the table but none of their
 * users in it, so a miss there is `untracked`, never proof of deletion.
 */
export async function lookupOwnerAccount(
  email: string,
): Promise<"exists" | "missing" | "untracked"> {
  const db = getDbExec();
  const found = await db.execute({
    sql: `SELECT 1 FROM "user" WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    args: [email],
  });
  if (found.rows.length) return "exists";
  // ponytail: an empty table is the signal; a custom-session deployment that
  // also holds a few built-in accounts still reads a miss as deleted. Upgrade:
  // have server/auth.ts report whether a custom getSession is mounted.
  const anyAccount = await db.execute({
    sql: `SELECT 1 FROM "user" LIMIT 1`,
    args: [],
  });
  return anyAccount.rows.length ? "missing" : "untracked";
}

export async function resolveAutomationExecutionIdentity(
  resourceOwner: string,
  meta: JobFrontmatter,
): Promise<AutomationExecutionIdentityResult> {
  const orgId = organizationIdFromResourceOwner(resourceOwner);
  if (!orgId) {
    const userEmail = (meta.createdBy || resourceOwner).trim().toLowerCase();
    if (!userEmail || userEmail !== resourceOwner.trim().toLowerCase()) {
      return {
        ok: false,
        reason: "Personal automation creator does not match its owner.",
        code: "config_invalid",
      };
    }
    return {
      ok: true,
      identity: { userEmail, orgScope: "personal", eventOwner: userEmail },
    };
  }

  const userEmail = meta.createdBy?.trim().toLowerCase();
  if (!userEmail) {
    return {
      ok: false,
      reason: "Organization automation has no creator identity.",
      code: "config_invalid",
    };
  }
  if (meta.runAs !== "creator") {
    return {
      ok: false,
      reason: "Organization automations must run as their creator.",
      code: "config_invalid",
    };
  }
  if (meta.orgId && meta.orgId !== orgId) {
    return {
      ok: false,
      reason: "Organization automation metadata does not match its owner.",
      code: "config_invalid",
    };
  }

  const account = await lookupOwnerAccount(userEmail);
  if (account === "missing") {
    return {
      ok: false,
      reason: `Automation creator "${userEmail}" no longer exists.`,
      code: "owner_missing",
    };
  }
  if (account === "untracked") {
    return {
      ok: false,
      reason: `Automation creator "${userEmail}" cannot be verified: this deployment keeps no built-in user accounts.`,
      code: "owner_unverifiable",
    };
  }
  if (!(await readOrganizationMembership(orgId, userEmail))) {
    return {
      ok: false,
      reason: `Automation creator "${userEmail}" is no longer a member of organization "${orgId}".`,
      code: "owner_missing",
    };
  }
  return {
    ok: true,
    identity: { userEmail, orgId, eventOwner: userEmail },
  };
}

export function automationMatchesEventOwner(
  identity: AutomationExecutionIdentity,
  eventOwner: string | undefined,
): boolean {
  return (
    typeof eventOwner === "string" &&
    eventOwner.trim().toLowerCase() === identity.eventOwner
  );
}
