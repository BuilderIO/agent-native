/**
 * List snippets for a call, or across the user's current workspace if no
 * callId is provided.
 *
 * Usage:
 *   pnpm action list-snippets --callId=<id>
 *   pnpm action list-snippets
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  assertWorkspaceAccess,
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveWorkspaceIdForAction,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "List snippets attached to a specific call (when callId is provided) or across the user's current workspace (when omitted). Soft-deleted snippets are excluded.",
  schema: z.object({
    callId: z
      .string()
      .optional()
      .describe(
        "Optional call id — scope results to snippets of this call. When omitted, lists all snippets in the current workspace.",
      ),
    workspaceId: z
      .string()
      .optional()
      .describe(
        "Optional workspace id — defaults to current-workspace, then the user's first workspace.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(200)
      .describe("Max rows to return"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    const conditions = [
      isNull(schema.snippets.trashedAt),
      accessFilter(schema.snippets, schema.snippetShares),
    ];

    if (args.callId) {
      const [call] = await db
        .select({ workspaceId: schema.calls.workspaceId })
        .from(schema.calls)
        .where(eq(schema.calls.id, args.callId))
        .limit(1);
      if (!call) throw new Error(`Call not found: ${args.callId}`);
      await assertWorkspaceAccess(call.workspaceId);
      conditions.push(eq(schema.snippets.callId, args.callId));
    } else {
      const workspaceId = await resolveWorkspaceIdForAction({
        workspaceId: args.workspaceId,
      });
      conditions.push(eq(schema.snippets.workspaceId, workspaceId));
    }

    const rows = await db
      .select()
      .from(schema.snippets)
      .where(and(...conditions))
      .orderBy(desc(schema.snippets.createdAt))
      .limit(args.limit);

    const callIds = Array.from(new Set(rows.map((r) => r.callId)));
    const parentTitles = new Map<string, string>();
    if (callIds.length > 0) {
      const parentRows = await db
        .select({ id: schema.calls.id, title: schema.calls.title })
        .from(schema.calls)
        .where(inArray(schema.calls.id, callIds));
      for (const row of parentRows) {
        if (callIds.includes(row.id)) parentTitles.set(row.id, row.title);
      }
    }

    const snippets = rows.map((s) => ({
      id: s.id,
      callId: s.callId,
      workspaceId: s.workspaceId,
      title: s.title,
      description: s.description,
      startMs: s.startMs,
      endMs: s.endMs,
      parentCallTitle: parentTitles.get(s.callId) ?? null,
      hasPassword: Boolean(s.password),
      expiresAt: s.expiresAt,
      visibility: s.visibility,
      ownerEmail: s.ownerEmail,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    return { snippets, count: snippets.length };
  },
});

// Silence unused-import warnings in environments that tree-shake type-only deps.
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void getCurrentOwnerEmail;
void assertAccess;
void writeAppState;
