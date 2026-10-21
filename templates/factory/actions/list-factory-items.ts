import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import {
  factoryIdSchema,
  orgFactoryItemFilter,
} from "../server/lib/factory-scope.js";
import {
  decodeInboxCursor,
  encodeInboxCursor,
} from "../server/lib/inbox-cursor.js";
import { failWorkflowAction } from "../server/lib/workflow-action-errors.js";
import {
  WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
  assertResultWithinLimit,
  clipText,
  requireWorkflowActionCaller,
  takeWithinBudget,
} from "../server/lib/workflow-action-support.js";
import { triageItemStatusSchema } from "../server/triage/contracts.js";

const SUMMARY_LIMIT = 500;
const TITLE_LIMIT = 300;
const OBJECT_LIMIT_CHARS = 2_000;

type ItemRow = (typeof triageItems)["$inferSelect"];

function parseObject(
  json: string,
  what: string,
  itemId: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return failWorkflowAction({
      message: `The ${what} of Factory item ${itemId} is unreadable, so the list cannot be trusted.`,
      errorCode: "factory_item_unreadable",
      statusCode: 500,
      details: { itemId },
    });
  }
  return parsed as Record<string, unknown>;
}

/** Keeps the entries that fit whole, in order, and says when it dropped any. */
function boundObject(value: Record<string, unknown>): {
  kept: Record<string, unknown>;
  truncated: boolean;
} {
  const kept: Record<string, unknown> = {};
  let used = 2;
  let truncated = false;
  for (const [key, entry] of Object.entries(value)) {
    const cost = JSON.stringify(key).length + JSON.stringify(entry).length + 2;
    if (used + cost > OBJECT_LIMIT_CHARS) {
      truncated = true;
      continue;
    }
    kept[key] = entry;
    used += cost;
  }
  return { kept, truncated };
}

function shapeItem(row: ItemRow) {
  const metadata = parseObject(row.metadataJson, "metadata", row.id);
  const payload = parseObject(row.payloadJson, "payload", row.id);
  const title = clipText(row.title, TITLE_LIMIT);
  const summary = row.summary ? clipText(row.summary, SUMMARY_LIMIT) : null;
  const boundMetadata = boundObject(metadata);
  const boundPayload = boundObject(payload);
  const author = metadata.author;
  return {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    status: row.status,
    title: title.text,
    summary: summary?.text ?? null,
    url: row.sourceUrl,
    channelId: row.channelId,
    threadTs: row.threadTs,
    repository: row.repository,
    pullRequestNumber: row.pullRequestNumber,
    headSha: row.headSha,
    author: typeof author === "string" && author ? author : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: boundMetadata.kept,
    payload: boundPayload.kept,
    truncated:
      title.clipped ||
      summary?.clipped === true ||
      boundMetadata.truncated ||
      boundPayload.truncated,
  };
}

export default defineAction({
  description:
    "List the Factory items that are in one status, newest update first, for a workflow's \"items in a status\" source. Unlike list-triage-items it does not clamp to the calling job's work limit: it returns up to limit items (at most 100), then hasMore and nextCursor to continue. Output is bounded; when the size cap cuts a page short, truncated is true and nextCursor resumes after the last item returned. An item whose stored data cannot be read fails the call.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    status: triageItemStatusSchema,
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  }),
  http: false,
  mcpTool: false,
  readOnly: true,
  run: async (
    { factoryId: requestedFactoryId, status, limit, cursor },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    let position: ReturnType<typeof decodeInboxCursor> | null = null;
    if (cursor) {
      try {
        position = decodeInboxCursor(cursor);
      } catch {
        return failWorkflowAction({
          message: "The cursor is not one this action returned.",
          errorCode: "cursor_invalid",
          statusCode: 400,
        });
      }
    }
    const rows = await getDb()
      .select()
      .from(triageItems)
      .where(
        and(
          orgFactoryItemFilter(caller.orgId, caller.factoryId),
          eq(triageItems.status, status),
          position
            ? or(
                lt(triageItems.updatedAt, position.updatedAt),
                and(
                  eq(triageItems.updatedAt, position.updatedAt),
                  lt(triageItems.id, position.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(triageItems.updatedAt), desc(triageItems.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const shaped = page.map(shapeItem);
    const { kept, truncated } = takeWithinBudget(
      shaped,
      WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
      300,
    );
    const hasMore = rows.length > limit || truncated;
    const last = page[kept.length - 1];
    return assertResultWithinLimit("list-factory-items", {
      ok: true as const,
      status,
      items: kept,
      count: kept.length,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeInboxCursor({ updatedAt: last.updatedAt, id: last.id })
          : null,
      truncated: truncated || kept.some((item) => item.truncated),
    });
  },
});
