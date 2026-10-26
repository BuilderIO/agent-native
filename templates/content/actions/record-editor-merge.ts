import { defineAction } from "@agent-native/core/action";
import { countOutcome } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  EDITOR_MERGE_OUTCOMES,
  EDITOR_MERGE_PATHS,
} from "../shared/editor-merge-outcomes.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

export default defineAction({
  description:
    "Record a bounded count of the editor merging a newer saved body, in an open editor or in a save rebased over it, without changing the page.",
  readOnly: true,
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  schema: z.object({
    id: z.string().min(1).describe("Document ID"),
    outcome: z
      .enum(EDITOR_MERGE_OUTCOMES)
      .describe(
        "kept_all when the merge kept every saved change; set_aside when it left one out for overlapping the tab's own edit",
      ),
    path: z
      .enum(EDITOR_MERGE_PATHS)
      .describe(
        "open_editor when an open editor merged a newer saved body; save_rebase when a save met a newer body and was rebased over it",
      ),
  }),
  outputSchema: z.object({ recorded: z.literal(true) }),
  run: async (args) => {
    await assertDocumentMutationAccess(args.id, "viewer", "id");
    // Count inside the request: a serverless instance can freeze before a
    // timer runs. countOutcome only bumps an in-memory window, and the editor
    // never waits for this answer.
    try {
      countOutcome("content_editor_merge_counts", {
        outcome: args.outcome,
        path: args.path,
      });
    } catch {
      // coercion-ok: delivery cannot change the merge acknowledgement.
    }
    return { recorded: true as const };
  },
});
