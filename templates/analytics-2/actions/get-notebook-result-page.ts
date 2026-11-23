import { defineAction } from "@agent-native/core/action";

import { notebookThreadMatches } from "../server/lib/notebook-tool-context.js";
import { previewNotebookResultPage } from "../server/model/cell-result-preview.js";
import {
  currentResultActor,
  getNotebookResultPage,
  getNotebookResultPageInput,
  getNotebookResultPageOutput,
} from "../server/model/notebook-results.js";

export default defineAction({
  description:
    "Read 50 rows from an authorized notebook result. Omit page to reopen the saved view. These rows are a first-N preview, not a representative sample: never infer absence or grain from them.",
  schema: getNotebookResultPageInput,
  outputSchema: getNotebookResultPageOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async (input, context) => {
    if (!notebookThreadMatches(context, input.threadId))
      return { status: "denied", reason: "access_denied" } as const;
    const result = await getNotebookResultPage(
      await currentResultActor(context?.caller ?? "unknown"),
      input,
    );
    if (context?.caller === "frontend" || result.status !== "ready")
      return result;
    return { ...result, preview: previewNotebookResultPage(result) };
  },
});
