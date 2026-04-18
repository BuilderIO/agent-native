/**
 * Reply to an existing comment. Thin wrapper over add-comment that sets
 * threadId + parentId correctly.
 *
 * Usage:
 *   pnpm action reply-to-comment --parentId=<cid> --content="..."
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { writeAppState, readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Reply to an existing comment. Looks up the thread and parent and delegates to add-comment.",
  schema: z.object({
    parentId: z.string().describe("Comment id to reply to"),
    content: z.string().min(1).describe("Reply text"),
    authorName: z
      .string()
      .optional()
      .describe("Display name for the author — falls back to email local part"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [parent] = await db
      .select()
      .from(schema.callComments)
      .where(eq(schema.callComments.id, args.parentId))
      .limit(1);
    if (!parent) throw new Error(`Comment not found: ${args.parentId}`);

    await assertAccess("call", parent.callId, "viewer");

    const id = nanoid();
    const authorEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    await db.insert(schema.callComments).values({
      id,
      callId: parent.callId,
      workspaceId: parent.workspaceId,
      threadId: parent.threadId,
      parentId: parent.id,
      authorEmail,
      authorName: args.authorName ?? null,
      content: args.content,
      videoTimestampMs: parent.videoTimestampMs,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Replied to comment ${args.parentId} (thread: ${parent.threadId})`,
    );

    return { id, threadId: parent.threadId, parentId: parent.id };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
