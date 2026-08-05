import { getDbExec, type DbExec } from "../db/client.js";
import { isValidCron, isValidTimezone, nextOccurrence } from "../jobs/cron.js";
import {
  buildJobResourceContent,
  normalizeJobMcpTools,
  parseJobResource,
  type JobFrontmatter,
} from "../jobs/frontmatter.js";
import {
  deleteAutomationRunsWithDb,
  ensureAutomationRunHistoryReady,
} from "../jobs/run-history.js";
import { resolveUserSchedulingTimezone } from "../localization/user-timezone.js";
import {
  organizationIdFromResourceOwner,
  organizationResourceOwner,
  ensureResourceStoreReady,
  resourceDeleteWithDb,
  resourceGetByPath,
  resourceList,
  resourcePutWithDb,
  type Resource,
  type TransactionScopedResourceWrite,
} from "../resources/store.js";
import {
  listAccessibleAutomations,
  resolveAutomationAccess,
  type AccessibleAutomation,
} from "./access.js";
import {
  deleteAutomationSharingStateWithDb,
  ensureAutomationSharingTables,
  normalizeAutomationSharingEmail,
  replaceAutomationSharingStateWithDb,
  type CompleteAutomationSharingState,
} from "./sharing-store.js";

export type AutomationScope = "personal" | "organization";

export interface AutomationActor {
  userEmail: string;
  orgId?: string | null;
}

export interface AutomationDefinition {
  resource: Resource;
  name: string;
  scope: AutomationScope;
  meta: JobFrontmatter & {
    triggerType: "schedule" | "event" | "manual";
    mode: "agentic" | "deterministic";
  };
  body: string;
  canUpdate: boolean;
}

export interface AccessibleAutomationDefinition extends AccessibleAutomation {
  scope: AutomationScope;
  /** Compatibility alias for callers not yet migrated to capabilities.canEdit. */
  canUpdate: boolean;
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
  triggerType: "schedule" | "event" | "manual";
  body: string;
  enabled?: boolean;
  schedule?: string;
  timezone?: string;
  event?: string;
  condition?: string;
  domain?: string;
  delegatedPolicyId?: string;
  model?: string;
  mcpTools?: unknown;
  delivery?: AutomationDelivery;
  sharing?: CompleteAutomationSharingState;
  acknowledgeExternalCollaborators?: boolean;
}

export type DefinedAutomation = Omit<AutomationDefinition, "resource">;

export interface UpdateAutomationInput {
  resourceId?: string;
  name?: string;
  scope?: AutomationScope;
  triggerType?: "schedule" | "event" | "manual";
  enabled?: boolean;
  body?: string;
  event?: string;
  condition?: string | null;
  delegatedPolicyId?: string | null;
  schedule?: string;
  timezone?: string;
  model?: string | null;
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

function normalizeActor(actor: AutomationActor): AutomationActor {
  const userEmail = actor.userEmail.trim().toLowerCase();
  if (!userEmail) throw httpError("Not authenticated.", 401);
  return { userEmail, orgId: actor.orgId?.trim() || null };
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
  const result = await getDbExec().execute({
    sql: "SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1",
    args: [orgId, email.toLowerCase()],
  });
  if (!result.rows.length) return null;
  return { role: String(result.rows[0]?.role ?? "").toLowerCase() };
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

async function runAtomicAutomationMutation<T>(
  work: (tx: DbExec) => Promise<T>,
): Promise<T> {
  await Promise.all([
    ensureResourceStoreReady(),
    ensureAutomationSharingTables(),
  ]);
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Atomic automation writes require transaction support.");
  }
  return client.transaction(work);
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

/**
 * Compatibility adapters may expose both explicit automations and legacy
 * scheduled jobs. Keep their mutation authorization on the same boundary as
 * the canonical service without forcing legacy resources through the explicit
 * automation classifier.
 */
export async function canUpdateAutomationResource(
  actorInput: AutomationActor,
  resource: Resource,
): Promise<boolean> {
  const access = await resolveAutomationAccess(
    normalizeActor(actorInput),
    resource.id,
  );
  return access?.capabilities.canEdit ?? false;
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
  const access = await resolveAutomationAccess(actor, resource.id);
  if (!access) {
    throw httpError(`Automation "${automationName(path)}" not found.`, 404);
  }
  return definitionFromAccess(access);
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
  if (!access) throw httpError("Automation not found.", 404);
  return { definition: definitionFromAccess(access), access };
}

export async function listAccessibleAutomationDefinitions(
  actorInput: AutomationActor,
): Promise<AccessibleAutomationDefinition[]> {
  const actor = normalizeActor(actorInput);
  const definitions = await listAccessibleAutomations(actor);
  return definitions.map((definition) => ({
    ...definition,
    scope: definition.owningOrganizationId ? "organization" : "personal",
    canUpdate: definition.capabilities.canEdit,
  }));
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
    const isCreator =
      parsed.meta.createdBy?.trim().toLowerCase() === actor.userEmail;
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
      canUpdate:
        scope === "personal" ||
        isCreator ||
        (membership ? isOrganizationAdmin(membership) : false),
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

  const schedule = input.schedule?.trim() ?? "";
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
  // Resolve now and persist it: a schedule whose zone is implicit means
  // something different the moment it is read on a differently-zoned host.
  const timezone =
    input.triggerType === "schedule"
      ? input.timezone || (await resolveUserSchedulingTimezone(actor.userEmail))
      : undefined;

  const mcpTools = normalizeJobMcpTools(input.mcpTools);
  const meta: JobFrontmatter = {
    schedule: input.triggerType === "schedule" ? schedule : "",
    ...(timezone ? { timezone } : {}),
    enabled: input.enabled ?? true,
    triggerType: input.triggerType,
    ...(input.triggerType === "event" ? { event } : {}),
    ...(input.triggerType !== "manual" && input.condition?.trim()
      ? { condition: input.condition.trim() }
      : {}),
    mode: "agentic",
    domain: input.domain?.trim() || undefined,
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
  let write: TransactionScopedResourceWrite<Resource> | undefined;
  await runAtomicAutomationMutation(async (tx) => {
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
  });
  write!.notifyAfterCommit();
  return {
    name: automationName(path),
    scope: input.scope,
    meta: { ...meta, triggerType: input.triggerType, mode: "agentic" },
    body,
    canUpdate: true,
  };
}

export async function updateAutomation(
  actorInput: AutomationActor,
  input: UpdateAutomationInput,
): Promise<AutomationDefinition> {
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
  const meta: AutomationDefinition["meta"] = { ...definition.meta };
  const triggerType = input.triggerType ?? meta.triggerType;
  const schedule = input.schedule?.trim() ?? meta.schedule;
  const event = input.event?.trim() ?? meta.event;

  if (triggerType === "schedule") {
    if (!isValidCron(schedule)) {
      throw httpError(
        schedule
          ? `Invalid cron expression "${schedule}".`
          : "schedule is required for scheduled automations.",
        400,
      );
    }
    if (input.event !== undefined) {
      throw httpError("Scheduled automations do not have an event.", 400);
    }
    const timezone =
      input.timezone ??
      meta.timezone ??
      (await resolveUserSchedulingTimezone(
        definition.meta.createdBy?.trim() || actorInput.userEmail,
      ));
    if (!isValidTimezone(timezone)) {
      throw httpError(`Unknown timezone "${timezone}".`, 400);
    }
    meta.triggerType = "schedule";
    meta.schedule = schedule;
    meta.timezone = timezone;
    meta.event = undefined;
    meta.nextRun = nextOccurrence(schedule, undefined, timezone).toISOString();
  } else if (triggerType === "event") {
    if (!event) {
      throw httpError(
        "event is required for event-triggered automations.",
        400,
      );
    }
    if (input.schedule !== undefined || input.timezone !== undefined) {
      throw httpError("Event automations do not have schedule settings.", 400);
    }
    meta.triggerType = "event";
    meta.schedule = "";
    meta.timezone = undefined;
    meta.event = event;
    meta.nextRun = undefined;
  } else {
    if (
      input.event !== undefined ||
      input.schedule !== undefined ||
      input.timezone !== undefined ||
      input.condition !== undefined
    ) {
      throw httpError("Manual automations do not have trigger settings.", 400);
    }
    meta.triggerType = "manual";
    meta.schedule = "";
    meta.timezone = undefined;
    meta.event = undefined;
    meta.condition = undefined;
    meta.nextRun = undefined;
  }

  if (input.enabled !== undefined) {
    meta.enabled = input.enabled;
    if (input.enabled && meta.triggerType === "schedule") {
      meta.nextRun = nextOccurrence(
        meta.schedule,
        undefined,
        meta.timezone,
      ).toISOString();
    }
  }
  if (input.condition !== undefined) {
    meta.condition = input.condition?.trim() || undefined;
  }
  if (input.delegatedPolicyId !== undefined) {
    meta.delegatedPolicyId = input.delegatedPolicyId?.trim() || undefined;
  }
  if (input.model !== undefined) {
    meta.model = input.model?.trim() || undefined;
  }
  if (input.mcpTools !== undefined) {
    const mcpTools = normalizeJobMcpTools(input.mcpTools);
    meta.mcpTools = mcpTools?.length ? mcpTools : undefined;
  }
  const owningOrganizationId = organizationIdFromResourceOwner(
    definition.resource.owner,
  );
  meta.createdBy = definition.meta.createdBy;
  meta.runAs = definition.meta.runAs;
  meta.orgId = definition.meta.orgId;
  if (owningOrganizationId) {
    meta.orgId = owningOrganizationId;
    meta.runAs = "creator";
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
  let write: TransactionScopedResourceWrite<Resource> | undefined;
  await runAtomicAutomationMutation(async (tx) => {
    const current = await tx.execute({
      sql: "SELECT id FROM resources WHERE owner = ? AND path = ? LIMIT 1",
      args: [definition.resource.owner, definition.resource.path],
    });
    if (String(current.rows[0]?.id ?? "") !== definition.resource.id) {
      throw httpError("Automation not found.", 404);
    }
    write = await resourcePutWithDb(
      tx,
      definition.resource.owner,
      definition.resource.path,
      buildJobResourceContent(meta, body),
    );
    if (write.value.id !== definition.resource.id) {
      throw new Error("Automation resource identity changed during update.");
    }
    if (sharing) {
      await replaceAutomationSharingStateWithDb(tx, write.value.id, sharing);
    }
  });
  write!.notifyAfterCommit();
  return { ...definition, resource: write!.value, meta, body };
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
  if (!access) throw httpError("Automation not found.", 404);
  const definition = definitionFromAccess(access);
  if (!access.capabilities.canDelete) {
    throw httpError("Only the automation owner can delete it.", 403);
  }

  await ensureAutomationRunHistoryReady();
  let write: TransactionScopedResourceWrite<boolean> | undefined;
  await runAtomicAutomationMutation(async (tx) => {
    write = await resourceDeleteWithDb(tx, definition.resource.id);
    if (!write.value) throw httpError("Automation not found.", 404);
    await deleteAutomationSharingStateWithDb(tx, definition.resource.id);
    await deleteAutomationRunsWithDb(
      tx,
      definition.resource.owner,
      definition.name,
    );
  });
  write!.notifyAfterCommit();
}

export interface AutomationExecutionIdentity {
  userEmail: string;
  orgId?: string;
  eventOwner: string;
}

export type AutomationExecutionIdentityResult =
  | { ok: true; identity: AutomationExecutionIdentity }
  | { ok: false; reason: string };

/**
 * Resolve the identity used by an explicit automation run.
 *
 * Organization automations are visible through their organization owner, but
 * always execute as their immutable creator. Event dispatchers must also
 * require EventMeta.owner to equal `eventOwner`; organization visibility does
 * not make an event organization-wide.
 */
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
      };
    }
    return { ok: true, identity: { userEmail, eventOwner: userEmail } };
  }

  const userEmail = meta.createdBy?.trim().toLowerCase();
  if (!userEmail) {
    return {
      ok: false,
      reason: "Organization automation has no creator identity.",
    };
  }
  if (meta.runAs !== "creator") {
    return {
      ok: false,
      reason: "Organization automations must run as their creator.",
    };
  }
  if (meta.orgId && meta.orgId !== orgId) {
    return {
      ok: false,
      reason: "Organization automation metadata does not match its owner.",
    };
  }

  const user = await getDbExec().execute({
    sql: `SELECT 1 FROM "user" WHERE LOWER(email) = ? LIMIT 1`,
    args: [userEmail],
  });
  if (!user.rows.length) {
    return {
      ok: false,
      reason: `Automation creator "${userEmail}" no longer exists.`,
    };
  }
  if (!(await readOrganizationMembership(orgId, userEmail))) {
    return {
      ok: false,
      reason: `Automation creator "${userEmail}" is no longer a member of organization "${orgId}".`,
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
