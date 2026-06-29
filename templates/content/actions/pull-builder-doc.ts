import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { BUILDER_DOCS_MODELS } from "../shared/builder-mdx.js";
import { pullBuilderDocIntoContent } from "./_builder-docs-client.js";

export default defineAction({
  description:
    "Pull a Builder.io docs/blog entry into Content as an editable document and return its .builder.mdx plus raw sidecar files.",
  schema: z.object({
    model: z
      .enum(BUILDER_DOCS_MODELS as unknown as [string, ...string[]])
      .optional()
      .default("docs-content")
      .describe("Builder model, usually docs-content or blog-article."),
    entryId: z.string().optional().describe("Builder entry/content ID."),
    id: z.string().optional().describe("Alias for --entryId."),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe("Preview the pull without writing the Content document."),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Pull Builder Doc",
    description:
      "Pull a Builder docs/blog entry into Content and return local MDX files.",
  },
  run: async ({ model, entryId, id, dryRun }) => {
    const targetEntryId = entryId || id;
    if (!targetEntryId) throw new Error("entryId is required.");
    return await pullBuilderDocIntoContent({
      model,
      entryId: targetEntryId,
      dryRun,
    });
  },
});
