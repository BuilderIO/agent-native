import { defineAction } from "@agent-native/core/action";

import { notebookChangeResource } from "../server/lib/project-action-access.js";
import { setPublishedAppAccess } from "../server/model/published-app-access.js";
import {
  setPublishedAppAccessInput,
  setPublishedAppAccessOutput,
} from "../shared/project-sharing.js";

export default defineAction({
  description:
    "Grant or revoke app-only access for an existing workspace member using a revisioned receipt.",
  schema: setPublishedAppAccessInput,
  outputSchema: setPublishedAppAccessOutput,
  outputErrorStrategy: "strict",
  mcpOutputSchema: true,
  persistInBrowser: false,
  retrySafe: true,
  changeResource: (input, receipt) =>
    receipt.effect === "no_change" ? null : notebookChangeResource(input),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: setPublishedAppAccess,
});
