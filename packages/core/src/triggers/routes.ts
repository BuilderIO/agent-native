import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";

import { canUpdateAutomationResource } from "../automations/service.js";
import { getDbExec } from "../db/client.js";
import {
  nextOccurrence,
  describeCron,
  effectiveTimezone,
  isValidCron,
} from "../jobs/cron.js";
import {
  buildJobResourceContent,
  parseJobResource,
  type JobFrontmatter,
} from "../jobs/frontmatter.js";
import { getOrgContext } from "../org/context.js";
import {
  organizationIdFromResourceOwner,
  organizationResourceOwner,
  resourceGetByPath,
  resourceListAllOwners,
  resourcePut,
  SHARED_OWNER,
  type Resource,
} from "../resources/store.js";
import { getSession } from "../server/auth.js";
import { readBody } from "../server/h3-helpers.js";
import { refreshEventSubscriptions } from "./dispatcher.js";
import type { TriggerFrontmatter } from "./types.js";

export interface AutomationRouteItem {
  id: string;
  name: string;
  path: string;
  owner: string;
  appId?: string;
  scope: "personal" | "organization";
  canUpdate: boolean;
  triggerType: TriggerFrontmatter["triggerType"];
  event?: string;
  schedule?: string;
  scheduleDescription?: string;
  condition?: string;
  mode: TriggerFrontmatter["mode"];
  domain?: string;
  enabled: boolean;
  timezone?: string;
  lastStatus?: TriggerFrontmatter["lastStatus"];
  lastRun?: string;
  lastCheck?: string;
  lastError?: string;
  nextRun?: string;
  createdBy?: string;
  body: string;
  model?: string;
  mcpTools: string[];
  runAs?: JobFrontmatter["runAs"];
  executionHostId?: string;
  executionEngine?: string;
  executionCwd?: string;
  deliveryPlatform?: string;
  deliveryDestination?: string;
  deliveryThreadRef?: string;
}

interface SetAutomationEnabledInput {
  owner?: string;
  path?: string;
  name?: string;
  enabled: boolean;
}

function automationName(path: string): string {
  return path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

function asTriggerFrontmatter(meta: JobFrontmatter): TriggerFrontmatter {
  return {
    ...meta,
    triggerType: meta.triggerType ?? "schedule",
    mode: meta.mode ?? "agentic",
  };
}

function normalizeAutomationPath(input: SetAutomationEnabledInput): string {
  const rawPath = input.path ?? (input.name ? `jobs/${input.name}.md` : "");
  const path = rawPath.replace(/^\/+/, "");
  if (
    !path.startsWith("jobs/") ||
    !path.endsWith(".md") ||
    path.endsWith(".keep") ||
    path.includes("..")
  ) {
    throw Object.assign(
      new Error("A valid jobs/*.md automation path is required"),
      {
        statusCode: 400,
      },
    );
  }
  return path;
}

function scheduleDescription(schedule?: string, timezone?: string) {
  if (!schedule) return undefined;
  try {
    return describeCron(schedule, effectiveTimezone(timezone));
  } catch {
    return schedule;
  }
}

function nextRunForMeta(meta: TriggerFrontmatter): string | undefined {
  const scheduled = Boolean(
    meta.enabled &&
    meta.triggerType !== "event" &&
    meta.schedule &&
    isValidCron(meta.schedule),
  );
  if (meta.nextRun) {
    const stored = new Date(meta.nextRun).getTime();
    if (!scheduled || !Number.isFinite(stored) || stored > Date.now()) {
      return meta.nextRun;
    }
  }
  if (scheduled) {
    try {
      return nextOccurrence(
        meta.schedule,
        undefined,
        meta.timezone,
      ).toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function currentUserCanUpdateAutomation(
  event: H3Event,
  userEmail: string,
  resource: Resource,
  meta: TriggerFrontmatter,
): Promise<boolean> {
  const resourceOwner = resource.owner;
  if (resourceOwner === userEmail) return true;
  const resourceOrgId = organizationIdFromResourceOwner(resourceOwner);
  if (resourceOrgId) {
    try {
      const org = await getOrgContext(event);
      if (org.orgId !== resourceOrgId) return false;
      return await canUpdateAutomationResource(
        { userEmail, orgId: resourceOrgId },
        resource,
      );
    } catch {
      return false;
    }
  }
  if (resourceOwner !== SHARED_OWNER) return false;

  if (meta.orgId) {
    const activeOrgId = await getOrgContext(event)
      .then((context) => context.orgId)
      .catch(() => null);
    if (activeOrgId !== meta.orgId) return false;
  }

  if (
    meta.createdBy &&
    meta.createdBy.toLowerCase() === userEmail.toLowerCase()
  ) {
    return true;
  }

  let orgId = meta.orgId;
  if (!orgId) {
    try {
      orgId = (await getOrgContext(event)).orgId ?? undefined;
    } catch {
      orgId = undefined;
    }
  }
  if (!orgId) return false;

  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, userEmail.toLowerCase()],
    });
    const role = String((rows[0] as any)?.role ?? "").toLowerCase();
    return role === "owner" || role === "admin";
  } catch {
    return false;
  }
}

async function resourceToAutomationItem(
  event: H3Event,
  userEmail: string,
  resource: Resource,
): Promise<AutomationRouteItem> {
  const parsed = parseJobResource(resource.content);
  const meta = asTriggerFrontmatter(parsed.meta);
  return {
    id: resource.id,
    name: automationName(resource.path),
    path: resource.path,
    owner: resource.owner,
    appId: meta.appId,
    scope:
      resource.owner === userEmail && !meta.orgId ? "personal" : "organization",
    canUpdate: await currentUserCanUpdateAutomation(
      event,
      userEmail,
      resource,
      meta,
    ),
    triggerType: meta.triggerType,
    event: meta.event,
    schedule: meta.schedule || undefined,
    scheduleDescription: scheduleDescription(meta.schedule, meta.timezone),
    condition: meta.condition,
    mode: meta.mode,
    domain: meta.domain,
    enabled: meta.enabled,
    timezone: meta.timezone,
    lastStatus: meta.lastStatus,
    lastRun: meta.lastRun,
    lastCheck: meta.lastCheck,
    lastError: meta.lastError,
    nextRun: nextRunForMeta(meta),
    createdBy: meta.createdBy,
    body: parsed.body,
    model: meta.model,
    mcpTools: meta.mcpTools ?? [],
    runAs: meta.runAs,
    executionHostId: meta.executionHostId,
    executionEngine: meta.executionEngine,
    executionCwd: meta.executionCwd,
    deliveryPlatform: meta.deliveryPlatform,
    deliveryDestination: meta.deliveryDestination,
    deliveryThreadRef: meta.deliveryThreadRef,
  };
}

export async function listAutomationsForOwner(
  event: H3Event,
  userEmail: string,
): Promise<AutomationRouteItem[]> {
  const allResources = await resourceListAllOwners("jobs/");
  const activeOrgId = await getOrgContext(event)
    .then((context) => context.orgId)
    .catch(() => null);
  const activeOrgOwner = activeOrgId
    ? organizationResourceOwner(activeOrgId)
    : null;
  const resources = allResources.filter((resource) => {
    if (!resource.path.endsWith(".md") || resource.path.endsWith(".keep")) {
      return false;
    }
    if (
      resource.owner !== userEmail &&
      resource.owner !== SHARED_OWNER &&
      resource.owner !== activeOrgOwner
    ) {
      return false;
    }
    if (resource.owner !== SHARED_OWNER) return true;
    const { meta } = parseJobResource(resource.content);
    return !meta.orgId || meta.orgId === activeOrgId;
  });
  return Promise.all(
    resources.map((resource) =>
      resourceToAutomationItem(event, userEmail, resource),
    ),
  );
}

export async function setAutomationEnabledForOwner(
  event: H3Event,
  userEmail: string,
  input: SetAutomationEnabledInput,
): Promise<AutomationRouteItem> {
  if (typeof input.enabled !== "boolean") {
    throw Object.assign(new Error("enabled must be a boolean"), {
      statusCode: 400,
    });
  }

  const path = normalizeAutomationPath(input);
  const activeOrgId = await getOrgContext(event)
    .then((context) => context.orgId)
    .catch(() => null);
  const activeOrgOwner = activeOrgId
    ? organizationResourceOwner(activeOrgId)
    : null;
  const requestedOwner =
    input.owner === SHARED_OWNER
      ? SHARED_OWNER
      : input.owner === activeOrgOwner
        ? activeOrgOwner
        : userEmail;
  const resource = await resourceGetByPath(requestedOwner, path);
  if (!resource) {
    throw Object.assign(new Error("Automation not found"), { statusCode: 404 });
  }

  const parsed = parseJobResource(resource.content);
  const meta = asTriggerFrontmatter(parsed.meta);
  const allowed = await currentUserCanUpdateAutomation(
    event,
    userEmail,
    resource,
    meta,
  );
  if (!allowed) {
    throw Object.assign(
      new Error("Only the automation creator or an org admin can update it."),
      { statusCode: 403 },
    );
  }

  parsed.meta.enabled = input.enabled;
  if (
    parsed.meta.enabled &&
    meta.triggerType !== "event" &&
    meta.schedule &&
    isValidCron(meta.schedule)
  ) {
    parsed.meta.nextRun = nextOccurrence(
      meta.schedule,
      undefined,
      meta.timezone,
    ).toISOString();
  }

  const updatedContent = buildJobResourceContent(parsed.meta, parsed.body);
  await resourcePut(resource.owner, resource.path, updatedContent);
  await refreshEventSubscriptions();

  return resourceToAutomationItem(event, userEmail, {
    ...resource,
    content: updatedContent,
  });
}

function routeError(event: H3Event, err: unknown, fallback: string) {
  const statusCode =
    typeof (err as any)?.statusCode === "number"
      ? (err as any).statusCode
      : 500;
  setResponseStatus(event, statusCode);
  return { error: (err as any)?.message ?? fallback };
}

export function createAutomationsHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const pathname = (event.path || event.url?.pathname || "")
      .split("?")[0]
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");

    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Unauthenticated" };
    }

    if (
      (pathname === "fire-test" || pathname.endsWith("/fire-test")) &&
      method === "POST"
    ) {
      try {
        const { emit } = await import("../event-bus/index.js");
        const body = (await readBody(event).catch(() => ({}))) as Record<
          string,
          unknown
        >;
        emit(
          "test.event.fired",
          { data: body.data ?? {} },
          { owner: session.email },
        );
        return { ok: true };
      } catch (err) {
        return routeError(event, err, "Failed to emit test event");
      }
    }

    if (method === "GET") {
      try {
        return await listAutomationsForOwner(event, session.email);
      } catch (err) {
        return routeError(event, err, "Failed to list automations");
      }
    }

    if (method === "PATCH" || method === "PUT") {
      try {
        const body = (await readBody(event).catch(
          () => ({}),
        )) as SetAutomationEnabledInput | null;
        return await setAutomationEnabledForOwner(event, session.email, {
          owner: body?.owner,
          path: body?.path,
          name: body?.name,
          enabled: (body as any)?.enabled,
        } as SetAutomationEnabledInput);
      } catch (err) {
        return routeError(event, err, "Failed to update automation");
      }
    }

    setResponseStatus(event, 405);
    return { error: "Method not allowed" };
  });
}
