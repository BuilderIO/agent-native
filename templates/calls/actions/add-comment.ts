/**
 * Add a comment to a call at a specific video timestamp. For new threads,
 * omit threadId/parentId. For replies, pass both.
 *
 * Usage:
 *   pnpm action add-comment --callId=<id> --content="Good objection handling"
 *   pnpm action add-comment --callId=<id> --content="Reply" --threadId=<tid> --parentId=<pid>
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
    "Add a comment to a call at a specific video timestamp. For new threads, omit threadId/parentId. For replies, pass both.",
  schema: z.object({
    callId: z.string().describe("Call id"),
    content: z.string().min(1).describe("Comment text"),
    videoTimestampMs: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Video time (ms) the comment is attached to"),
    threadId: z
      .string()
      .optional()
      .describe("Thread id. Omit to start a new thread."),
    parentId: z
      .string()
      .optional()
      .describe("Parent comment id (for replies). Inherits the parent's threadId."),
    authorName: z
      .string()
      .optional()
      .describe("Display name for the author — falls back to email local part"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.callId, "viewer");

    const db = getDb();
    const [call] = await db
      .select({ workspaceId: schema.calls.workspaceId })
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId))
      .limit(1);
    if (!call) throw new Error(`Call not found: ${args.callId}`);

    let threadId = args.threadId ?? null;
    const parentId = args.parentId ?? null;

    if (parentId) {
      const [parent] = await db
        .select({ threadId: schema.callComments.threadId })
        .from(schema.callComments)
        .where(eq(schema.callComments.id, parentId))
        .limit(1);
      if (!parent) throw new Error(`Parent comment not found: ${parentId}`);
      threadId = parent.threadId;
    }

    const id = nanoid();
    if (!threadId) threadId = id;

    const authorEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    await db.insert(schema.callComments).values({
      id,
      callId: args.callId,
      workspaceId: call.workspaceId,
      threadId,
      parentId,
      authorEmail,
      authorName: args.authorName ?? null,
      content: args.content,
      videoTimestampMs: args.videoTimestampMs,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Added comment to call ${args.callId} @ ${args.videoTimestampMs}ms (thread: ${threadId})`,
    );

    return { id, threadId, parentId };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
