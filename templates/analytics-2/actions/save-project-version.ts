import { defineAction } from "@agent-native/core/action";

import { notebookChangeResource } from "../server/lib/project-action-access.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { saveProjectVersion } from "../server/model/projects-store.js";
import {
  savedProjectVersionSchema,
  saveProjectVersionInputSchema,
} from "../shared/notebook-history.js";

export default defineAction({
  description:
    "Save a named, immutable checkpoint at the accepted notebook draft head.",
  schema: saveProjectVersionInputSchema,
  outputSchema: savedProjectVersionSchema,
  outputErrorStrategy: "strict",
  changeResource: notebookChangeResource,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) =>
    saveProjectVersion(await requireCurrentWorkspace(), input),
});
