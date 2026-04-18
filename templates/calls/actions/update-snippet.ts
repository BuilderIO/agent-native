/**
 * Update a snippet's metadata — title, description, start/end, password,
 * expiry.
 *
 * Usage:
 *   pnpm action update-snippet --id=<id> --title="Pricing pushback"
 *   pnpm action update-snippet --id=<id> --startMs=12000 --endMs=48000
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
    "Update a snippet's metadata — title, description, start/end offsets, password, and/or expiry.",
  schema: z.object({
    id: z.string().describe("Snippet id"),
    title: z.string().min(1).optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    startMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("New start offset in ms"),
    endMs: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("New end offset in ms"),
    password: z
      .string()
      .nullish()
      .describe("Snippet-level password — pass null to clear"),
    expiresAt: z
      .string()
      .nullish()
      .describe("ISO timestamp the snippet share expires — null to clear"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("snippet", args.id, "editor");

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.snippets)
      .where(eq(schema.snippets.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Snippet not found: ${args.id}`);

    const nextStart = args.startMs ?? existing.startMs;
    const nextEnd = args.endMs ?? existing.endMs;
    if (nextStart >= nextEnd) {
      throw new Error(
        `startMs (${nextStart}) must be less than endMs (${nextEnd}).`,
      );
    }

    if (args.startMs !== undefined || args.endMs !== undefined) {
      const [parent] = await db
        .select({ durationMs: schema.calls.durationMs })
        .from(schema.calls)
        .where(eq(schema.calls.id, existing.callId))
        .limit(1);
      if (parent && parent.durationMs > 0) {
        if (nextStart > parent.durationMs || nextEnd > parent.durationMs) {
          throw new Error(
            `Range [${nextStart}..${nextEnd}] exceeds parent call duration (${parent.durationMs}).`,
          );
        }
      }
    }

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (typeof args.title === "string") patch.title = args.title.trim();
    if (typeof args.description === "string")
      patch.description = args.description;
    if (args.startMs !== undefined) patch.startMs = args.startMs;
    if (args.endMs !== undefined) patch.endMs = args.endMs;
    if (args.password !== undefined) patch.password = args.password ?? null;
    if (args.expiresAt !== undefined) patch.expiresAt = args.expiresAt ?? null;

    await db
      .update(schema.snippets)
      .set(patch)
      .where(eq(schema.snippets.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [updated] = await db
      .select()
      .from(schema.snippets)
      .where(eq(schema.snippets.id, args.id))
      .limit(1);

    return {
      id: args.id,
      title: updated?.title,
      description: updated?.description,
      startMs: updated?.startMs,
      endMs: updated?.endMs,
      password: updated?.password,
      expiresAt: updated?.expiresAt,
    };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
