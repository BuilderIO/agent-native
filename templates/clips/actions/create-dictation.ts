import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { track } from "@agent-native/core/tracking";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getActiveOrganizationId,
  getCurrentOwnerEmail,
  nanoid,
  ownerEmailMatches,
} from "../server/lib/recordings.js";

const DICTATION_ID_CONFLICT = {
  errorCode: "dictation_id_conflict",
  statusCode: 409,
} as const;

const dictationResultColumns = {
  id: schema.dictations.id,
  fullText: schema.dictations.fullText,
  cleanedText: schema.dictations.cleanedText,
  durationMs: schema.dictations.durationMs,
  audioUrl: schema.dictations.audioUrl,
  source: schema.dictations.source,
  targetApp: schema.dictations.targetApp,
  startedAt: schema.dictations.startedAt,
  createdAt: schema.dictations.createdAt,
  updatedAt: schema.dictations.updatedAt,
};

export default defineAction({
  description:
    "Create a dictation history row from captured voice text. Used by browser, desktop, and mobile voice capture.",
  schema: z.object({
    id: z.string().min(1).optional().describe("Stable client-generated id"),
    fullText: z.string().min(1).describe("Raw dictation text"),
    cleanedText: z.string().nullable().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    audioUrl: z.string().url().nullable().optional(),
    source: z
      .enum([
        "fn-hold",
        "cmd-shift-space",
        "manual",
        "mobile",
        "other",
        "fn",
        "custom",
      ])
      .default("manual"),
    targetApp: z.string().nullable().optional(),
    startedAt: z.string().datetime().optional(),
  }),
  run: async (args, context) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const orgId = await getActiveOrganizationId().catch(() => null);
    const now = new Date().toISOString();
    const id = args.id ?? nanoid();
    const fullText = args.fullText.trim();
    if (!fullText) throw new Error("Dictation text is required");
    const cleanedText = args.cleanedText?.trim() || null;
    const audioUrl = args.audioUrl ?? null;
    const durationMs = args.durationMs ?? 0;
    const startedAt = args.startedAt ?? now;
    const targetApp = args.targetApp ?? null;
    const values: typeof schema.dictations.$inferInsert = {
      id,
      fullText,
      cleanedText,
      durationMs,
      audioUrl,
      source: args.source,
      targetApp,
      startedAt,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
      visibility: "private",
    };
    const [created] = await db
      .insert(schema.dictations)
      .values(values)
      .onConflictDoNothing({ target: schema.dictations.id })
      .returning(dictationResultColumns);

    if (!created) {
      if (!args.id) {
        fail(
          "A dictation with this generated id already exists.",
          DICTATION_ID_CONFLICT,
        );
      }

      const [existing] = await db
        .select(dictationResultColumns)
        .from(schema.dictations)
        .where(
          and(
            eq(schema.dictations.id, id),
            ownerEmailMatches(schema.dictations.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      if (!existing) {
        fail("This dictation id is already in use.", DICTATION_ID_CONFLICT);
      }

      // Capture timing can advance when the client retries after its timeout.
      const sameLogicalCreate =
        existing.fullText === fullText &&
        existing.cleanedText === cleanedText &&
        existing.audioUrl === audioUrl &&
        existing.source === args.source &&
        existing.targetApp === targetApp &&
        (args.startedAt === undefined || existing.startedAt === args.startedAt);
      if (!sameLogicalCreate) {
        fail(
          "This dictation id is already in use for different content.",
          DICTATION_ID_CONFLICT,
        );
      }

      return existing;
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    track(
      "dictation_used",
      {
        app_name: "clips",
        template_name: "clips",
        output_id: id,
        output_type: "dictation",
        duration_s: Math.round(durationMs / 1000),
        source: args.source,
      },
      context,
    );

    return created;
  },
});
