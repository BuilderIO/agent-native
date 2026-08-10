import { defineAction } from "@agent-native/core/action";
import {
  listAutomationDefinitions,
  listAutomationRuns,
} from "@agent-native/core/triggers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { factoryAuditEvents } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List recent Factory automation runs with the bounded source observations, decisions, and external actions recorded for each run.",
  agentTool: false,
  schema: z.object({
    factoryId: z.string().trim().min(1).optional(),
    automation: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ automation, limit }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const definitions = await listAutomationDefinitions(
      { userEmail, orgId, appId: "factory" },
      "organization",
    );
    const factoryDefinitions = definitions.filter(
      ({ meta, name }) =>
        meta.domain === "factory" && (!automation || name === automation),
    );
    const runGroups = await Promise.all(
      factoryDefinitions.map(async ({ name, resource }) =>
        listAutomationRuns({
          owners: [resource.owner],
          automation: name,
          appId: "factory",
          limit,
        }),
      ),
    );
    const runs = runGroups.flat().sort((a, b) => b.startedAt - a.startedAt);
    const boundedRuns = runs.slice(0, limit);
    const runIds = boundedRuns
      .map((run) => run.runId)
      .filter((runId): runId is string => Boolean(runId));

    const db = getDb();
    const events = runIds.length
      ? await db
          .select()
          .from(factoryAuditEvents)
          .where(
            and(
              eq(factoryAuditEvents.orgId, orgId),
              inArray(factoryAuditEvents.automationRunId, runIds),
            ),
          )
          .orderBy(desc(factoryAuditEvents.createdAt))
      : [];
    const eventsByRun = new Map<string, typeof events>();
    for (const event of events) {
      if (!event.automationRunId) continue;
      const current = eventsByRun.get(event.automationRunId) ?? [];
      current.push(event);
      eventsByRun.set(event.automationRunId, current);
    }

    return {
      runs: boundedRuns.map((run) => ({
        id: run.id,
        automation: run.automation,
        runId: run.runId,
        threadId: run.threadId,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: run.error,
        events: (eventsByRun.get(run.runId ?? "") ?? []).map((event) => ({
          id: event.id,
          automationRunId: event.automationRunId,
          automationThreadId: event.automationThreadId,
          automationName: event.automationName,
          itemId: event.itemId,
          source: event.source,
          sourceUrl: event.sourceUrl,
          action: event.action,
          kind: event.kind,
          status: event.status,
          summary: event.summary,
          details: parseDetails(event.detailsJson),
          createdAt: event.createdAt,
        })),
      })),
      count: boundedRuns.length,
    };
  },
});

function parseDetails(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Factory audit details are unreadable.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Factory audit details are unreadable.");
  }
  return parsed as Record<string, unknown>;
}
