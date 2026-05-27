import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { resolveHasBuilderPrivateKey } from "@agent-native/core/server";
import { z } from "zod";
import {
  isBuilderImageGenerationEnabled,
  isGeminiImageGenerationConfigured,
  isOpenAIImageGenerationConfigured,
} from "../server/lib/generation.js";
import { isObjectStorageConfigured } from "../server/lib/storage.js";

/**
 * Surface the server-side `BUILDER_IMAGE_GENERATION_ENABLED` env flag so
 * the settings UI can decide whether to offer the "Connect Builder.io"
 * path. With the flag set to `"false"` the generation pipeline refuses
 * Builder-managed runs (see `generateWithManagedImageProvider` in
 * `generation.ts:217`), so the settings page would otherwise lead users
 * down a setup path that can't succeed.
 *
 * Kept advisory — generation actions still check the flag themselves.
 */
export default defineAction({
  description:
    "Returns the deployment's asset-generation config and any recent setup issue.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const builderEnabled = isBuilderImageGenerationEnabled();
    const [
      builderConnected,
      geminiConfigured,
      openaiConfigured,
      objectStorageConfigured,
      lastIssue,
    ] = await Promise.all([
      resolveHasBuilderPrivateKey().catch(() => false),
      isGeminiImageGenerationConfigured().catch(() => false),
      isOpenAIImageGenerationConfigured().catch(() => false),
      isObjectStorageConfigured().catch(() => false),
      readAppState("image-generation-setup").catch(() => null),
    ]);

    const configured =
      (builderEnabled && builderConnected) ||
      geminiConfigured ||
      openaiConfigured;

    return {
      builderEnabled,
      builderConnected,
      geminiConfigured,
      openaiConfigured,
      objectStorageConfigured,
      configured,
      lastIssue: configured ? null : lastIssue,
    };
  },
});
