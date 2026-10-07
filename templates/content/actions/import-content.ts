import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { runContentImport } from "../server/lib/content-import.js";
import { MAX_IMPORT_FILES } from "../shared/import/plan.js";

export default defineAction({
  description:
    "Import Markdown files as new Content pages and report anything that did not come across. Call with dryRun true to preview each page's title, status, and named losses without writing, then dryRun false to create them. Each Markdown file becomes a page under parentId, or a top-level page in spaceId/spaceName. Images the Markdown references are matched by path; other file types are reported as not supported yet.",
  deferLoading: false,
  mcpTool: true,
  schema: z.object({
    files: z
      .array(
        z.object({
          name: z
            .string()
            .min(1)
            .max(512)
            .describe(
              'File name or path inside the import, e.g. "notes/guide.md" or "notes/logo.png". Relative links and images in a Markdown file resolve against its path.',
            ),
          text: z
            .string()
            .optional()
            .describe(
              "Full text of a Markdown file (.md, .markdown, .mdx). Required for Markdown files.",
            ),
          url: z
            .string()
            .max(4096)
            .optional()
            .describe(
              "Uploaded URL of an image file a Markdown file references. Optional on a dry run; required to apply.",
            ),
        }),
      )
      .min(1)
      .max(MAX_IMPORT_FILES)
      .describe(
        "Markdown files to import, plus any images they reference by relative path.",
      ),
    parentId: z
      .string()
      .optional()
      .describe(
        "Page to create the imported pages under. Omit for top-level pages in spaceId/spaceName, or the Personal workspace when neither is given.",
      ),
    spaceId: z
      .string()
      .optional()
      .describe("Content workspace ID for top-level imported pages."),
    spaceName: z
      .string()
      .optional()
      .describe(
        "Content workspace name for top-level imported pages, when the user named one instead of giving its ID.",
      ),
    dryRun: z
      .boolean()
      .describe(
        "true previews pages and losses and writes nothing; false creates the pages.",
      ),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Stable key for one import. Retrying with the same key returns the pages already created instead of duplicating them.",
      ),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  link: ({ result }) => {
    const pages = (result as { pages?: Array<{ id: string | null }> } | null)
      ?.pages;
    const first = pages?.find((page) => page.id);
    if (!first?.id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: first.id },
      }),
      label: "Open imported page",
      view: "editor",
    };
  },
  run: (args, ctx) => runContentImport(args, ctx),
});
