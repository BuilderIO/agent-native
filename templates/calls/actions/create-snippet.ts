/**
 * Create a snippet — a pointer into a call's timeline. No re-encode; the
 * snippet references the parent call's media and a [startMs, endMs] range.
 *
 * Usage:
 *   pnpm action create-snippet --callId=<id> --startMs=12000 --endMs=48000
 *   pnpm action create-snippet --callId=<id> --startMs=0 --endMs=30000 --title="Pricing objection"
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
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Create a new snippet — a pointer into a call's timeline with [startMs, endMs]. No re-encode; the snippet references the parent call's media.",
  schema: z.object({
    callId: z.string().describe("Parent call id"),
    startMs: z
      .number()
      .int()
      .min(0)
      .describe("Snippet start offset in ms within the call"),
    endMs: z
      .number()
      .int()
      .min(1)
      .describe("Snippet end offset in ms within the call"),
    title: z
      .string()
      .optional()
      .describe("Snippet title — defaults to 'Untitled snippet'"),
    description: z
      .string()
      .optional()
      .describe("Optional description / context for the snippet"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    if (args.startMs >= args.endMs) {
      throw new Error(
        `startMs (${args.startMs}) must be less than endMs (${args.endMs}).`,
      );
    }

    await assertAccess("call", args.callId, "viewer");

    const db = getDb();
    const [parent] = await db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId))
      .limit(1);
    if (!parent) throw new Error(`Call not found: ${args.callId}`);

    if (parent.durationMs > 0) {
      if (args.startMs > parent.durationMs) {
        throw new Error(
          `startMs (${args.startMs}) is beyond call duration (${parent.durationMs}).`,
        );
      }
      if (args.endMs > parent.durationMs) {
        throw new Error(
          `endMs (${args.endMs}) is beyond call duration (${parent.durationMs}).`,
        );
      }
    }

    const id = nanoid();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();
    const titleTrim = args.title?.trim() || "";
    const title = titleTrim || "Untitled snippet";

    await db.insert(schema.snippets).values({
      id,
      callId: args.callId,
      workspaceId: parent.workspaceId,
      title,
      description: args.description?.trim() ?? "",
      startMs: args.startMs,
      endMs: args.endMs,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    const shouldAutoTitle =
      !titleTrim || titleTrim.toLowerCase() === "untitled";
    if (shouldAutoTitle) {
      await writeAppState(`agent-task-auto-title-snippet-${id}`, {
        kind: "auto-title-snippet",
        snippetId: id,
        callId: args.callId,
        queuedAt: now,
      });
    }

    console.log(
      `Created snippet "${title}" (${id}) on call ${args.callId} [${args.startMs}..${args.endMs}ms]`,
    );

    return {
      id,
      callId: args.callId,
      workspaceId: parent.workspaceId,
      title,
      startMs: args.startMs,
      endMs: args.endMs,
      ownerEmail,
      createdAt: now,
    };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
