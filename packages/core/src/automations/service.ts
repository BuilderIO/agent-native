import { getDbExec } from "../db/client.js";
import { isValidCron, isValidTimezone, nextOccurrence } from "../jobs/cron.js";
import {
  buildJobResourceContent,
  normalizeJobMcpTools,
  parseJobResource,
  type JobFrontmatter,
} from "../jobs/frontmatter.js";
import { deleteAutomationRuns } from "../jobs/run-history.js";
import { resolveUserSchedulingTimezone } from "../localization/user-timezone.js";
import {
  organizationIdFromResourceOwner,
  organizationResourceOwner,
  resourceDelete,
  resourceGetByPath,
  resourceList,
  resourcePut,
  type Resource,
} from "../resources/store.js";
import {
  listAccessibleAutomations,
  type AccessibleAutomation,
} from "./access.js";

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
}

export type DefinedAutomation = Omit<AutomationDefinition, "resource">;

export interface UpdateAutomationInput {
  name: string;
  scope: AutomationScope;
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

async function mutationAccess(
  actorInput: AutomationActor,
  resource: Resource,
  meta: JobFrontmatter,
): Promise<{ actor: AutomationActor; canUpdate: boolean }> {
  const actor = normalizeActor(actorInput);
  const resourceOrgId = organizationIdFromResourceOwner(resource.owner);
  if (!resourceOrgId) {
    return {
      actor,
      canUpdate: resource.owner.toLowerCase() === actor.userEmail,
    };
  }
  if (actor.orgId !== resourceOrgId) {
    return { actor, canUpdate: false };
  }
  const membership = await requireOrganizationMembership(actor);
  const isCreator =
    meta.createdBy?.trim().toLowerCase() === actor.userEmail.toLowerCase();
  return {
    actor,
    canUpdate: isCreator || isOrganizationAdmin(membership),
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
  const { meta } = parseJobResource(resource.content);
  return (await mutationAccess(actorInput, resource, meta)).canUpdate;
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
  const access = await mutationAccess(actor, resource, definition.meta);
  return {
    ...definition,
    name: automationName(resource.path),
    scope,
    canUpdate: access.canUpdate,
  };
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
  const content = buildJobResourceContent(meta, body);
  await resourcePut(owner, path, content);
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
  const definition = await readDefinition(actorInput, input.scope, input.name);
  if (!definition.canUpdate) {
    throw httpError(
      "Only the automation's creator or an organization admin can update it.",
      403,
    );
  }
  const { meta } = definition;
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
  if (input.scope === "organization") {
    meta.orgId = organizationIdFromResourceOwner(definition.resource.owner)!;
    meta.runAs = "creator";
  }
  const body = input.body === undefined ? definition.body : input.body.trim();
  if (!body) throw httpError("Automation body is required.", 400);
  await resourcePut(
    definition.resource.owner,
    definition.resource.path,
    buildJobResourceContent(meta, body),
  );
  return { ...definition, meta, body };
}

export async function deleteAutomation(
  actorInput: AutomationActor,
  scope: AutomationScope,
  name: string,
): Promise<void> {
  const definition = await readDefinition(actorInput, scope, name);
  if (!definition.canUpdate) {
    throw httpError(
      "Only the automation's creator or an organization admin can delete it.",
      403,
    );
  }
  await resourceDelete(definition.resource.id);
  // Names are reusable, so leaving history behind would attach these runs to
  // whatever automation is created under the same name next.
  await deleteAutomationRuns(definition.resource.owner, name);
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
