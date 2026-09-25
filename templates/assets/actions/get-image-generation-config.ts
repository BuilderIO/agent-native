import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import {
  BuilderCredentialLookupError,
  resolveHasBuilderGatewayCredential,
  resolveHasCompleteBuilderConnection,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  isBuilderImageGenerationEnabled,
  isGeminiImageGenerationConfigured,
  isOpenAIImageGenerationConfigured,
} from "../server/lib/generation.js";
import { isObjectStorageConfigured } from "../server/lib/storage.js";

/**
 * Surface the server-side `BUILDER_IMAGE_GENERATION_ENABLED` env flag so
 * the settings UI can keep image readiness separate from Builder video access.
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
    let builderConnected = false;
    let builderLookupFailed = false;
    try {
      builderConnected = await resolveHasBuilderGatewayCredential();
    } catch (error) {
      if (!(error instanceof BuilderCredentialLookupError)) throw error;
      builderLookupFailed = true;
    }
    const [
      builderStorageConnected,
      geminiConfigured,
      openaiConfigured,
      objectStorageConfigured,
      lastIssue,
    ] = await Promise.all([
      resolveHasCompleteBuilderConnection().catch(() => false),
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
      builderLookupFailed,
      builderStorageConnected,
      geminiConfigured,
      openaiConfigured,
      objectStorageConfigured,
      configured,
      lastIssue: configured ? null : lastIssue,
    };
  },
});
