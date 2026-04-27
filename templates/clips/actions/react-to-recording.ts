/**
 * Add an emoji reaction to a recording at a specific video timestamp.
 *
 * Usage:
 *   pnpm action react-to-recording --recordingId=<id> --emoji="🔥" --videoTimestampMs=12000
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Add an emoji reaction to a recording at a specific video timestamp.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    emoji: z.string().min(1).describe("Emoji character (e.g. 👍, ❤️, 🔥)"),
    videoTimestampMs: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Video time (ms) the reaction is attached to"),
    viewerName: z.string().optional(),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "viewer");

    const viewerEmail = getRequestUserEmail();
    if (!viewerEmail) {
      throw new Error("Sign in required to react to recordings.");
    }

    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.recordingReactions).values({
      id,
      recordingId: args.recordingId,
      viewerEmail,
      viewerName: args.viewerName ?? null,
      emoji: args.emoji,
      videoTimestampMs: args.videoTimestampMs,
      createdAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id };
  },
});
