import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import { normalizePresetReferences } from "../server/lib/preset-references.js";
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
        boardAssignments?: Record<string, string[]>;
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
    let presetReferenceFills:
      | Array<{ referenceId: string; assetIds: string[] }>
      | undefined;
    // Reruns treat the CURRENT preset as authoritative by design: saved
    // boardAssignments replay only onto entries that still exist and are
    // still variable. Entries the designer has since removed, renamed, or
    // converted to fixed re-resolve from today's preset instead of
    // resurrecting the original run's images — a rerun must never bypass
    // the designer's current board definition.
    const boardAssignments = metadata.settingsUsed?.boardAssignments;
    if (run.presetId && boardAssignments) {
      const [preset] = await db
        .select()
        .from(schema.assetGenerationPresets)
        .where(eq(schema.assetGenerationPresets.id, run.presetId))
        .limit(1);
      const presetSettings = parseJson<{ presetReferences?: unknown }>(
        preset?.settings,
        {},
      );
      presetReferenceFills = normalizePresetReferences(
        presetSettings.presetReferences,
      )
        .filter((entry) => entry.variable)
        .map((entry) => ({
          referenceId: entry.id,
          assetIds: Array.isArray(boardAssignments[entry.id])
            ? boardAssignments[entry.id].filter(
                (assetId): assetId is string => typeof assetId === "string",
              )
            : [],
        }))
        .filter((fill) => fill.assetIds.length > 0);
    }

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
        presetReferenceFills,
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
