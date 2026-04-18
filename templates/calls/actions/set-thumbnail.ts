import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import { getCallOrThrow, parseJson } from "../server/lib/calls.js";

export default defineAction({
  description:
    "Set a call's thumbnail. Pass `thumbnailUrl` to store a manually-chosen image URL, or `atMs` to hint at a frame time — the UI recorder is responsible for capturing the actual bitmap client-side.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    thumbnailUrl: z
      .string()
      .nullish()
      .describe("Thumbnail image URL (mutually exclusive with atMs)"),
    atMs: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Preferred frame time in ms. Stored in source_meta.thumbnailAtMs as a hint; the UI recorder captures the bitmap.",
      ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    if (!args.thumbnailUrl && typeof args.atMs !== "number") {
      throw new Error("Provide either thumbnailUrl or atMs");
    }
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const existing = await getCallOrThrow(args.callId);

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (typeof args.thumbnailUrl === "string") {
      patch.thumbnailUrl = args.thumbnailUrl;
    } else if (args.thumbnailUrl === null) {
      patch.thumbnailUrl = null;
    }

    if (typeof args.atMs === "number") {
      const meta = parseJson<Record<string, unknown>>(existing.sourceMeta, {});
      meta.thumbnailAtMs = args.atMs;
      patch.sourceMeta = JSON.stringify(meta);
    }

    await db
      .update(schema.calls)
      .set(patch)
      .where(eq(schema.calls.id, args.callId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: args.callId,
      thumbnailUrl: patch.thumbnailUrl ?? existing.thumbnailUrl,
      atMs: typeof args.atMs === "number" ? args.atMs : undefined,
    };
  },
});
