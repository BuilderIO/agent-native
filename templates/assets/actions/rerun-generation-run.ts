import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import { requireGenerationSessionInLibrary } from "./_helpers.js";
import generateImage from "./generate-image.js";

export default defineAction({
  description:
    "Rerun a prior asset generation using its original prompt and settings, but recompile against the latest library custom instructions, style brief, collection data, and deterministic references.",
  schema: z.object({
    runId: z.string().describe("Generation run to rerun"),
    slotId: z
      .string()
      .optional()
      .describe("Optional variant slot ID for the new generation"),
    sessionId: z
      .string()
      .optional()
      .describe("Optional session to attach the rerun result to"),
    source: z.enum(["chat", "ui", "a2a"]).default("chat"),
    callerAppId: z
      .string()
      .optional()
      .describe(
        "Set by A2A callers (e.g. 'slides', 'design') so audit logs can filter by app.",
      ),
  }),
  parallelSafe: true,
  run: async (
    { runId, slotId, sessionId, source, callerAppId },
    context?: ActionRunContext,
  ) => {
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.assetGenerationRuns)
      .where(eq(schema.assetGenerationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error("Generation run not found.");
    await assertAccess("asset-library", run.libraryId, "editor");
    const resolvedSessionId = sessionId ?? run.sessionId ?? undefined;
    if (resolvedSessionId) {
      await requireGenerationSessionInLibrary(resolvedSessionId, run.libraryId);
    }

    const metadata = parseJson<{
      settingsUsed?: {
        includeLogo?: boolean;
        categories?: string[];
        tier?: string | null;
        intent?: string;
        styleStrength?: string;
        subjectAssetId?: string;
        embeddedText?: string | null;
        textPlacement?: string | null;
      };
      includeLogo?: boolean;
      categories?: string[];
      sourceAssetId?: string;
      subjectAssetId?: string;
      intent?: string;
      styleStrength?: string;
      tier?: string | null;
      embeddedText?: string | null;
      textPlacement?: string | null;
    }>(run.metadata, {});
    const categories =
      metadata.settingsUsed?.categories ?? metadata.categories ?? undefined;

    return generateImage.run(
      {
        libraryId: run.libraryId,
        collectionId: run.collectionId ?? undefined,
        presetId: run.presetId ?? undefined,
        sessionId: resolvedSessionId,
        prompt: run.prompt,
        embeddedText:
          metadata.settingsUsed?.embeddedText ??
          metadata.embeddedText ??
          undefined,
        textPlacement:
          metadata.settingsUsed?.textPlacement ??
          metadata.textPlacement ??
          undefined,
        aspectRatio: run.aspectRatio as any,
        imageSize: run.imageSize as any,
        model: run.model as any,
        tier: (metadata.settingsUsed?.tier ??
          metadata.tier ??
          undefined) as any,
        intent: (metadata.settingsUsed?.intent ??
          metadata.intent ??
          "generate") as any,
        styleStrength: (metadata.settingsUsed?.styleStrength ??
          metadata.styleStrength ??
          "balanced") as any,
        categories: categories as any,
        includeLogo: Boolean(
          metadata.settingsUsed?.includeLogo ?? metadata.includeLogo,
        ),
        groundingMode: run.groundingMode as any,
        sourceAssetId: metadata.sourceAssetId,
        subjectAssetId:
          metadata.settingsUsed?.subjectAssetId ??
          metadata.subjectAssetId ??
          undefined,
        slotId,
        source,
        callerAppId,
      },
      context,
    );
  },
});
