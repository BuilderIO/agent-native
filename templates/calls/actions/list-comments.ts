/**
 * List threaded comments for a call, sorted by videoTimestampMs then
 * createdAt. The UI groups into threads client-side via threadId/parentId.
 *
 * Usage:
 *   pnpm action list-comments --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "List threaded comments for a call, sorted by videoTimestampMs then createdAt.",
  schema: z.object({
    callId: z.string().describe("Call id"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("call", args.callId, "viewer");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.callComments)
      .where(eq(schema.callComments.callId, args.callId))
      .orderBy(
        asc(schema.callComments.videoTimestampMs),
        asc(schema.callComments.createdAt),
      );

    const comments = rows.map((c) => ({
      id: c.id,
      callId: c.callId,
      workspaceId: c.workspaceId,
      threadId: c.threadId,
      parentId: c.parentId,
      authorEmail: c.authorEmail,
      authorName: c.authorName,
      content: c.content,
      videoTimestampMs: c.videoTimestampMs,
      emojiReactionsJson: c.emojiReactionsJson,
      resolved: Boolean(c.resolved),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    return { comments, count: comments.length };
  },
});

void and;
void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void writeAppState;
void readAppState;
void accessFilter;
