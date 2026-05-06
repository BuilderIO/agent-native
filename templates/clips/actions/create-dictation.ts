/**
 * Create a dictation row from browser or desktop voice capture.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getActiveOrganizationId,
  getCurrentOwnerEmail,
  nanoid,
} from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Create a dictation history row from captured voice text. Used by browser Dictate and desktop voice capture.",
  schema: z.object({
    fullText: z.string().min(1).describe("Raw dictation text"),
    cleanedText: z.string().nullable().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    audioUrl: z.string().url().nullable().optional(),
    source: z
      .enum(["fn-hold", "cmd-shift-space", "manual", "other"])
      .default("manual"),
    targetApp: z.string().nullable().optional(),
    startedAt: z.string().datetime().optional(),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const orgId = await getActiveOrganizationId().catch(() => null);
    const now = new Date().toISOString();
    const id = nanoid();
    const fullText = args.fullText.trim();
    if (!fullText) throw new Error("Dictation text is required");

    await db.insert(schema.dictations).values({
      id,
      fullText,
      cleanedText: args.cleanedText?.trim() || null,
      durationMs: args.durationMs ?? 0,
      audioUrl: args.audioUrl ?? null,
      source: args.source,
      targetApp: args.targetApp ?? null,
      startedAt: args.startedAt ?? now,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
      visibility: "private",
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id,
      fullText,
      cleanedText: args.cleanedText?.trim() || null,
      durationMs: args.durationMs ?? 0,
      audioUrl: args.audioUrl ?? null,
      source: args.source,
      targetApp: args.targetApp ?? null,
      startedAt: args.startedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
  },
});
