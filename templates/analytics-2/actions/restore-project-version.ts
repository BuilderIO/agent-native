import { defineAction } from "@agent-native/core/action";

import {
  notebookChangeResource,
  projectDocumentResultSchema,
} from "../server/lib/project-action-access.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { restoreProjectVersion } from "../server/model/projects-store.js";
import { restoreProjectVersionInputSchema } from "../shared/notebook-history.js";
import {
  draftHeadSchema,
  notebookEventCursorSchema,
} from "../shared/notebook-snapshot-contract.js";

export default defineAction({
  description:
    "Restore a saved project version into a new working draft without changing the published app.",
  schema: restoreProjectVersionInputSchema,
  changeResource: notebookChangeResource,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: projectDocumentResultSchema.extend({
    head: draftHeadSchema.describe(
      "Head committed by this restore, stable on retries",
    ),
    eventSeq: notebookEventCursorSchema,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input) =>
    restoreProjectVersion(await requireCurrentWorkspace(), input),
});
