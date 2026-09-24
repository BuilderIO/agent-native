import { defineAction } from "@agent-native/core/action";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { readOwnerDesignSystemArtifact } from "@agent-native/core/server/design-system-authoring";
import { z } from "zod";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  authorize: async () => {
    await assertBuilderDsiAccess();
  },
  description:
    "Read the actual scoped HTML or usage Markdown of one design-system target before applying it to generation or making a targeted edit. Returns artifact revision plus html/text; optional revision reads a retained previous version.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID"),
    ownerApp: z
      .enum(["design", "slides"])
      .optional()
      .describe("Owner app; foreign artifacts resolve through scoped A2A"),
    targetId: z
      .string()
      .min(1)
      .describe("Artifact target ID from the workspace"),
    revision: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Retained artifact revision; omit for current"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: ({ id, targetId, revision, ownerApp }) =>
    ownerApp && ownerApp !== "slides"
      ? readOwnerDesignSystemArtifact("slides", {
          id,
          targetId,
          revision,
          ownerApp,
        })
      : designSystemAuthoring.getArtifact(id, targetId, revision),
});
