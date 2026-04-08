import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a document or view. Use --path for URL paths or --documentId as shorthand.",
  parameters: {
    path: {
      type: "string",
      description:
        'URL path to navigate to (e.g. "/" for list, "/abc123" for a document)',
    },
    documentId: {
      type: "string",
      description: "Document ID to open (shorthand for --path=/<id>)",
    },
  },
  http: false,
  run: async (args) => {
    let path = args.path;

    if (!path && args.documentId) {
      path = `/${args.documentId}`;
    }

    if (!path) {
      throw new Error("At least --path or --documentId is required");
    }

    await writeAppState("navigate", { path, ts: Date.now() });
    return `Navigating to ${path}`;
  },
});
