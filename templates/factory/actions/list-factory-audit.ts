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
import {
  decodeAuditCursor,
  encodeAuditCursor,
  isAuditRunAfterCursor,
} from "../server/lib/audit-cursor.js";
import { projectFactoryAuditReport } from "../server/lib/factory-audit-report.js";
import {
  factoryIdSchema,
  orgFactoryItemFilter,
  orgFactoryRunFilter,
  readAutomationDisplayName,
  readAutomationFactoryId,
  resolveAutomationDisplayName,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  metadataString,
  parseTriageMetadata,
} from "../server/triage/metadata.js";
import { readStoredUserLabels } from "../server/triage/slack-user-labels.js";

/** Max runs `listAutomationRuns` will return; enough for merge-paging. */
const AUTOMATION_RUN_FETCH_LIMIT = 100;

export default defineAction({
  description:
    "List recent Factory automation runs with inbox additions, the items this run worked on, and the actions it took.",
  agentTool: false,
  schema: z.object({
    factoryId: factoryIdSchema,
    automation: z.string().trim().min(1).optional(),
    startedAfter: z.string().trim().min(1).optional(),
    cursor: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    { factoryId, automation, startedAfter, cursor, limit },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    let startedAfterMs: number | null = null;
    if (startedAfter) {
      startedAfterMs = Date.parse(startedAfter);
      if (!Number.isFinite(startedAfterMs)) {
        throw new Error("startedAfter is unreadable.");
      }
    }
    const decodedCursor = cursor ? decodeAuditCursor(cursor) : null;

    const definitions = await listAutomationDefinitions(
      { userEmail, orgId, appId: "factory" },
      "organization",
    );
    const factoryDefinitions = definitions.filter(
      ({ meta, resource }) =>
        meta.domain === "factory" &&
        readAutomationFactoryId(meta, resource.content, resource.path) ===
          factoryId,
    );
    const automations = factoryDefinitions
      .map(({ name, resource }) => ({
        name,
        displayName: resolveAutomationDisplayName(name, resource.content),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const scopedDefinitions = automation
      ? factoryDefinitions.filter(({ name }) => name === automation)
      : factoryDefinitions;

    const runGroups = await Promise.all(
      scopedDefinitions.map(async ({ name, resource }) => {
        const runs = await listAutomationRuns({
          owners: [resource.owner],
          automation: name,
          appId: "factory",
          limit: AUTOMATION_RUN_FETCH_LIMIT,
        });
        // Absent must stay distinguishable from a stored label so the client
        // can derive its own fallback instead of rendering the nested path.
        const displayName = readAutomationDisplayName(resource.content);
        return runs.map((run) => ({ run, displayName }));
      }),
    );
    const entries = runGroups
      .flat()
      .filter(({ run }) => {
        if (startedAfterMs !== null && run.startedAt < startedAfterMs) {
          return false;
        }
        if (
          decodedCursor &&
          !isAuditRunAfterCursor(
            { startedAt: run.startedAt, id: run.id },
            decodedCursor,
          )
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const byStarted = b.run.startedAt - a.run.startedAt;
        if (byStarted !== 0) return byStarted;
        return a.run.id.localeCompare(b.run.id);
      });
    const pageEntries = entries.slice(0, limit);
    const hasMore = entries.length > limit;
    const nextCursor =
      hasMore && pageEntries.length > 0
        ? encodeAuditCursor({
            startedAt: pageEntries[pageEntries.length - 1]!.run.startedAt,
            id: pageEntries[pageEntries.length - 1]!.run.id,
          })
        : null;
    const runIds = pageEntries
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
            status: triageItems.status,
            createdAt: triageItems.createdAt,
            lastSeenAt: triageItems.lastSeenAt,
            metadataJson: triageItems.metadataJson,
          })
          .from(triageItems)
          .where(
            and(
              orgFactoryItemFilter(orgId, factoryId),
              inArray(triageItems.id, itemIds),
            ),
          )
      : [];
    const itemSnapshots = itemRows.map((item) => {
      const metadata = parseTriageMetadata(item.metadataJson);
      return {
        id: item.id,
        title: item.title,
        summary: item.summary,
        source: item.source,
        sourceUrl: item.sourceUrl,
        status: item.status,
        createdAt: item.createdAt,
        lastSeenAt: item.lastSeenAt,
        slackBuilderReplyAt:
          metadataString(metadata, "slackBuilderReplyAt") ?? null,
        slackDisposition: metadataString(metadata, "slackDisposition") ?? null,
        userLabels: readStoredUserLabels(item.metadataJson),
      };
    });
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
      runs: pageEntries.map(({ run, displayName }) => {
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
          itemSnapshots,
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
          inbox: report.inbox,
          work: report.work,
          actions: report.actions,
          items: report.items,
          trace: report.trace,
        };
      }),
      automations,
      count: pageEntries.length,
      hasMore,
      nextCursor,
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
