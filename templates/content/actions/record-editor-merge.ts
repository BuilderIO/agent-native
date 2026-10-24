import { defineAction } from "@agent-native/core/action";
import { countOutcome } from "@agent-native/core/tracking";
import { z } from "zod";

import { EDITOR_MERGE_OUTCOMES } from "../shared/editor-merge-outcomes.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

export default defineAction({
  description:
    "Record a bounded count of an open editor merging a newer saved body, without changing the page.",
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
  }),
  run: async (args) => {
    await assertDocumentMutationAccess(args.id, "viewer", "id");
    try {
      setTimeout(() => {
        try {
          const delivery: unknown = countOutcome(
            "content_editor_merge_counts",
            { outcome: args.outcome },
          );
          void Promise.resolve(delivery).catch(() => {
            // coercion-ok: delivery cannot change the merge acknowledgement.
          });
        } catch {
          // coercion-ok: delivery cannot change the merge acknowledgement.
        }
      }, 0);
    } catch {
      // coercion-ok: scheduling telemetry cannot change the merge acknowledgement.
    }
    return { recorded: true as const };
  },
});
