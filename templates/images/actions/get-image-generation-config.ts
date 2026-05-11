import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { isBuilderImageGenerationEnabled } from "../server/lib/generation.js";

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
    "Returns the deployment's image-generation config: whether Builder-managed image generation is enabled by `BUILDER_IMAGE_GENERATION_ENABLED`.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    return { builderEnabled: isBuilderImageGenerationEnabled() };
  },
});
