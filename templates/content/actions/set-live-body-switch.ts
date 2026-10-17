import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { LiveBodyConversionError } from "../server/live-copy/persist.js";
import {
  switchPageToLegacy,
  switchPageToLiveCopy,
} from "../server/live-copy/switch.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

export default defineAction({
  description:
    "Switch one page's body writes to its live copy, or back to the legacy writer, for the live-copy rollout.",
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  mcpTool: false,
  schema: z.object({
    id: z.string().min(1).describe("Document ID"),
    switched: z
      .boolean()
      .describe("true writes through the live copy; false goes back"),
  }),
  run: async (args, ctx) => {
    await assertDocumentMutationAccess(args.id, "editor", "id");
    try {
      const gate = args.switched
        ? await switchPageToLiveCopy(args.id, { ctx })
        : await switchPageToLegacy(args.id);
      return { id: args.id, ...gate };
    } catch (error) {
      if (error instanceof LiveBodyConversionError) {
        throw new ActionContractError(error.message, {
          errorCode:
            error.code === "flag_off"
              ? "LIVE_BODY_WRITER_OFF"
              : "LIVE_BODY_SWITCH_CONFLICT",
          statusCode: 409,
        });
      }
      throw error;
    }
  },
});
