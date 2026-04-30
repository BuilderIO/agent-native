import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a document or view. Use --path for URL paths or --documentId as shorthand.",
  schema: z.object({
    path: z
      .string()
      .optional()
      .describe(
        'URL path to navigate to (e.g. "/" for list, "/abc123" for a document)',
      ),
    documentId: z
      .string()
      .optional()
      .describe("Document ID to open (shorthand for --path=/<id>)"),
  }),
  http: false,
  run: async (args) => {
    let path = args.path;

    if (!path && args.documentId) {
      path = `/page/${args.documentId}`;
    }

    if (!path) {
      throw new Error("At least --path or --documentId is required");
    }

    await writeAppState("navigate", { path, ts: Date.now() });
    return `Navigating to ${path}`;
  },
});
