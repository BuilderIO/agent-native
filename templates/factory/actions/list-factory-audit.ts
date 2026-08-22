import { defineAction } from "@agent-native/core/action";
import {
  listAutomationDefinitions,
  listAutomationRuns,
} from "@agent-native/core/triggers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  factoryAuditEvents,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import { projectFactoryAuditReport } from "../server/lib/factory-audit-report.js";
import {
  factoryIdSchema,
  orgFactoryItemFilter,
  orgFactoryRunFilter,
  readAutomationDisplayName,
  readAutomationFactoryId,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List recent Factory automation runs with the bounded source observations, decisions, and external actions recorded for each run.",
  agentTool: false,
  schema: z.object({
    factoryId: factoryIdSchema,
    automation: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId, automation, limit }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const definitions = await listAutomationDefinitions(
      { userEmail, orgId, appId: "factory" },
      "organization",
    );
    const factoryDefinitions = definitions.filter(
      ({ meta, name, resource }) =>
        meta.domain === "factory" &&
        readAutomationFactoryId(meta, resource.content, resource.path) ===
          factoryId &&
        (!automation || name === automation),
    );
    const runGroups = await Promise.all(
      factoryDefinitions.map(async ({ name, resource }) => {
        const runs = await listAutomationRuns({
          owners: [resource.owner],
          automation: name,
          appId: "factory",
          limit,
        });
        // Absent must stay distinguishable from a stored label so the client
        // can derive its own fallback instead of rendering the nested path.
        const displayName = readAutomationDisplayName(resource.content);
        return runs.map((run) => ({ run, displayName }));
      }),
    );
    const entries = runGroups
      .flat()
      .sort((a, b) => b.run.startedAt - a.run.startedAt);
    const boundedEntries = entries.slice(0, limit);
    const runIds = boundedEntries
      .map(({ run }) => run.runId)
      .filter((runId): runId is string => Boolean(runId));

    const db = getDb();
    const events = runIds.length
      ? await db
          .select()
          .from(factoryAuditEvents)
          .where(
            and(
              eq(factoryAuditEvents.orgId, orgId),
              eq(factoryAuditEvents.factoryId, factoryId),
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

    const itemIds = [
      ...new Set(
        events.flatMap((event) => {
          const ids: string[] = [];
          if (event.itemId) ids.push(event.itemId);
          const details = parseDetails(event.detailsJson);
          const listed = details.itemIds;
          if (Array.isArray(listed)) {
            for (const value of listed) {
              if (typeof value === "string" && value) ids.push(value);
            }
          }
          return ids;
        }),
      ),
    ];
    const itemRows = itemIds.length
      ? await db
          .select({
            id: triageItems.id,
            title: triageItems.title,
            summary: triageItems.summary,
            source: triageItems.source,
            sourceUrl: triageItems.sourceUrl,
          })
          .from(triageItems)
          .where(
            and(
              orgFactoryItemFilter(orgId, factoryId),
              inArray(triageItems.id, itemIds),
            ),
          )
      : [];
    const runRows = itemIds.length
      ? await db
          .select({
            itemId: triageRuns.itemId,
            status: triageRuns.status,
            error: triageRuns.error,
            provider: triageRuns.provider,
            startedAt: triageRuns.startedAt,
          })
          .from(triageRuns)
          .where(
            and(
              orgFactoryRunFilter(orgId, factoryId),
              inArray(triageRuns.itemId, itemIds),
            ),
          )
      : [];

    return {
      runs: boundedEntries.map(({ run, displayName }) => {
        const mappedEvents = (eventsByRun.get(run.runId ?? "") ?? []).map(
          (event) => ({
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
          }),
        );
        const report = projectFactoryAuditReport(
          mappedEvents,
          itemRows,
          runRows,
          { startedAt: run.startedAt, finishedAt: run.finishedAt },
        );
        return {
          id: run.id,
          automation: run.automation,
          displayName,
          runId: run.runId,
          threadId: run.threadId,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          error: run.error,
          counts: report.counts,
          items: report.items,
          trace: report.trace,
        };
      }),
      count: boundedEntries.length,
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
