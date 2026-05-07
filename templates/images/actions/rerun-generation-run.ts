import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import generateImage from "./generate-image.js";

export default defineAction({
  description:
    "Rerun a prior image generation using its original prompt and settings, but recompile against the latest library custom instructions, style brief, collection data, and sampled references.",
  schema: z.object({
    runId: z.string().describe("Generation run to rerun"),
    slotId: z
      .string()
      .optional()
      .describe("Optional variant slot ID for the new generation"),
    source: z.enum(["chat", "ui", "a2a"]).default("chat"),
    callerAppId: z
      .string()
      .optional()
      .describe(
        "Set by A2A callers (e.g. 'slides', 'design') so audit logs can filter by app.",
      ),
  }),
  parallelSafe: true,
  run: async ({ runId, slotId, source, callerAppId }) => {
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.imageGenerationRuns)
      .where(eq(schema.imageGenerationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error("Generation run not found.");
    await assertAccess("image-library", run.libraryId, "editor");

    const metadata = parseJson<{
      settingsUsed?: {
        includeLogo?: boolean;
        categories?: string[];
      };
      includeLogo?: boolean;
      categories?: string[];
      sourceAssetId?: string;
    }>(run.metadata, {});
    const categories =
      metadata.settingsUsed?.categories ?? metadata.categories ?? undefined;

    return generateImage.run({
      libraryId: run.libraryId,
      collectionId: run.collectionId ?? undefined,
      prompt: run.prompt,
      aspectRatio: run.aspectRatio as any,
      imageSize: run.imageSize as any,
      model: run.model as any,
      categories: categories as any,
      includeLogo: Boolean(
        metadata.settingsUsed?.includeLogo ?? metadata.includeLogo,
      ),
      groundingMode: run.groundingMode as any,
      sourceAssetId: metadata.sourceAssetId,
      slotId,
      source,
      callerAppId,
    });
  },
});
