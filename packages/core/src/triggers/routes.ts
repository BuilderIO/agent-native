import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";
import { readBody } from "../server/h3-helpers.js";
import { getSession } from "../server/auth.js";
import { getDbExec } from "../db/client.js";
import { nextOccurrence, describeCron, isValidCron } from "../jobs/cron.js";
import { getOrgContext } from "../org/context.js";
import {
  resourceGetByPath,
  resourceListAllOwners,
  resourcePut,
  SHARED_OWNER,
  type Resource,
} from "../resources/store.js";
import {
  buildTriggerContent,
  parseTriggerFrontmatter,
  refreshEventSubscriptions,
} from "./dispatcher.js";
import type { TriggerFrontmatter } from "./types.js";

export interface AutomationRouteItem {
  id: string;
  name: string;
  path: string;
  owner: string;
  canUpdate: boolean;
  triggerType: TriggerFrontmatter["triggerType"];
  event?: string;
  schedule?: string;
  scheduleDescription?: string;
  condition?: string;
  mode: TriggerFrontmatter["mode"];
  domain?: string;
  enabled: boolean;
  lastStatus?: TriggerFrontmatter["lastStatus"];
  lastRun?: string;
  lastError?: string;
  nextRun?: string;
  createdBy?: string;
  body: string;
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

function scheduleDescription(schedule: string | undefined): string | undefined {
  if (!schedule) return undefined;
  try {
    return describeCron(schedule);
  } catch {
    return schedule;
  }
}

function nextRunForMeta(meta: TriggerFrontmatter): string | undefined {
  if (meta.nextRun) return meta.nextRun;
  if (
    meta.enabled &&
    meta.triggerType !== "event" &&
    meta.schedule &&
    isValidCron(meta.schedule)
  ) {
    try {
      return nextOccurrence(meta.schedule).toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function currentUserCanUpdateAutomation(
  event: H3Event,
  userEmail: string,
  resourceOwner: string,
  meta: TriggerFrontmatter,
): Promise<boolean> {
  if (resourceOwner === userEmail) return true;
  if (resourceOwner !== SHARED_OWNER) return false;

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
  const { meta, body } = parseTriggerFrontmatter(resource.content);
  return {
    id: resource.id,
    name: automationName(resource.path),
    path: resource.path,
    owner: resource.owner,
    canUpdate: await currentUserCanUpdateAutomation(
      event,
      userEmail,
      resource.owner,
      meta,
    ),
    triggerType: meta.triggerType,
    event: meta.event,
    schedule: meta.schedule || undefined,
    scheduleDescription: scheduleDescription(meta.schedule),
    condition: meta.condition,
    mode: meta.mode,
    domain: meta.domain,
    enabled: meta.enabled,
    lastStatus: meta.lastStatus,
    lastRun: meta.lastRun,
    lastError: meta.lastError,
    nextRun: nextRunForMeta(meta),
    createdBy: meta.createdBy,
    body,
  };
}

export async function listAutomationsForOwner(
  event: H3Event,
  userEmail: string,
): Promise<AutomationRouteItem[]> {
  const allResources = await resourceListAllOwners("jobs/");
  const resources = allResources.filter(
    (resource) =>
      (resource.owner === userEmail || resource.owner === SHARED_OWNER) &&
      resource.path.endsWith(".md") &&
      !resource.path.endsWith(".keep"),
  );
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
  const requestedOwner =
    input.owner === SHARED_OWNER ? SHARED_OWNER : userEmail;
  const resource = await resourceGetByPath(requestedOwner, path);
  if (!resource) {
    throw Object.assign(new Error("Automation not found"), { statusCode: 404 });
  }

  const { meta, body } = parseTriggerFrontmatter(resource.content);
  const allowed = await currentUserCanUpdateAutomation(
    event,
    userEmail,
    resource.owner,
    meta,
  );
  if (!allowed) {
    throw Object.assign(
      new Error("Only the automation creator or an org admin can update it."),
      { statusCode: 403 },
    );
  }

  meta.enabled = input.enabled;
  if (
    meta.enabled &&
    meta.triggerType !== "event" &&
    meta.schedule &&
    isValidCron(meta.schedule)
  ) {
    meta.nextRun = nextOccurrence(meta.schedule).toISOString();
  }

  await resourcePut(
    resource.owner,
    resource.path,
    buildTriggerContent(meta, body),
  );
  await refreshEventSubscriptions();

  return resourceToAutomationItem(event, userEmail, {
    ...resource,
    content: buildTriggerContent(meta, body),
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
