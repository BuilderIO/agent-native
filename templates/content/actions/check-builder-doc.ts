import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { checkBuilderDocsSource } from "./_builder-docs-client.js";

export default defineAction({
  description:
    "Validate a Builder .builder.mdx document before push: raw sidecars, local round-trip, and remote conflict gate.",
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
  }),
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Check Builder Doc",
    description:
      "Validate Builder MDX files and block pushes when the remote entry changed.",
  },
  run: async ({ documentId, id, path, files }) => {
    return await checkBuilderDocsSource({
      documentId: documentId || id,
      path,
      files,
    });
  },
});
