import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { notebookMessages } from "../app/i18n/messages/notebook.js";
import { controlNotebookKernel } from "../server/model/kernel-access.js";
import {
  kernelControlInputSchema,
  kernelControlReceiptSchema,
  kernelUnavailableSchema,
} from "../server/model/kernel-namespaces.js";

export default defineAction({
  description:
    "Interrupt an active notebook attempt, stop its kernel, or restart and optionally run all cells.",
  schema: kernelControlInputSchema,
  outputSchema: z.union([kernelControlReceiptSchema, kernelUnavailableSchema]),
  requiresAuth: true,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async (input) => {
    const result = await controlNotebookKernel(input);
    if ("status" in result && result.status === "rejected")
      fail(notebookMessages.notebook.runFailedExecution, {
        statusCode: 409,
        errorCode: result.reason,
      });
    return result;
  },
});
