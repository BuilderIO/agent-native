import { defineAction, fail } from "@agent-native/core/action";
import { ATTACHMENT_REF_MAX_CHARS } from "@agent-native/core/private-blob";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { discardFigmaReference } from "../server/lib/figma-reference-attachment.js";

export default defineAction({
  description:
    "Delete a staged Figma attachment the user removed from the prompt before sending it. UI-only: the composer calls it when a Figma chip is dropped; a sent attachment is kept for place-figma-frames.",
  schema: z.object({ ref: z.string().min(1).max(ATTACHMENT_REF_MAX_CHARS) }),
  outputSchema: z.object({ deleted: z.boolean() }),
  http: { method: "POST" },
  agentTool: false,
  toolCallable: false,
  run: async ({ ref }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to remove a Figma attachment.", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    return { deleted: await discardFigmaReference(ref, ownerEmail) };
  },
});
