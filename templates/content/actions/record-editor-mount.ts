import { defineAction } from "@agent-native/core/action";
import { countOutcome } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  EDITOR_MOUNT_MODES,
  EDITOR_MOUNT_OUTCOMES,
} from "../shared/editor-mount-outcomes.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

export default defineAction({
  description: "Record a bounded editor mount count without changing the page.",
  readOnly: true,
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  schema: z.object({
    id: z.string().min(1).describe("Document ID"),
    visitId: z
      .string()
      .min(1)
      .max(100)
      .describe("Tab-local visit ID; excluded from count dimensions"),
    outcome: z
      .enum(EDITOR_MOUNT_OUTCOMES)
      .describe("Creation class: initial, navigation, mode_switch, or remount"),
    mode: z
      .enum(EDITOR_MOUNT_MODES)
      .describe("Editor mode: editing, suggesting, or readonly"),
  }),
  run: async (args) => {
    await assertDocumentMutationAccess(args.id, "viewer", "id");
    try {
      setTimeout(() => {
        try {
          const delivery: unknown = countOutcome(
            "content_editor_mount_counts",
            {
              outcome: args.outcome,
              mode: args.mode,
            },
          );
          void Promise.resolve(delivery).catch(() => {
            // coercion-ok: delivery cannot change the mount acknowledgement.
          });
        } catch {
          // coercion-ok: delivery cannot change the mount acknowledgement.
        }
      }, 0);
    } catch {
      // coercion-ok: scheduling telemetry cannot change the mount acknowledgement.
    }
    return { recorded: true as const };
  },
});
