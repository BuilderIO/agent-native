import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { pushBuilderDocsSource } from "./_builder-docs-client.js";

export default defineAction({
  description:
    "Push a Builder .builder.mdx document body to Builder via a guarded autosave PATCH. Live writes are currently restricted to the safe Builder test model.",
  schema: z.object({
    documentId: z.string().optional().describe("Content document ID."),
    id: z.string().optional().describe("Alias for --documentId."),
    path: z
      .string()
      .optional()
      .describe("Specific .builder.mdx path inside the files map."),
    files: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Map of relative file path to file contents, including the .builder.mdx file and content/builder/.raw sidecars.",
      ),
    dryRun: z
      .boolean()
      .optional()
      .default(true)
      .describe("Preview the PATCH request without calling Builder."),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Push Builder Doc",
    description:
      "Validate and autosave a Builder MDX body back to the safe Builder model.",
  },
  run: async ({ documentId, id, path, files, dryRun }) => {
    return await pushBuilderDocsSource({
      documentId: documentId || id,
      path,
      files,
      dryRun,
    });
  },
});
