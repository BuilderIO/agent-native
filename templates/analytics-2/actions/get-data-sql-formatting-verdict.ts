import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { manager } from "../server/model/data-connections.js";
import { readSqlFluffVerdict } from "../server/model/sqlfluff-verdicts.js";

/**
 * The safe companion to the private SQLFluff validation POST. It returns only
 * the verdict and a known error code for this actor's exact personal/org
 * scope. The raw config, a config hash, and the runtime message never leave
 * the private POST.
 */
const verdictErrors = defineActionErrors(
  "data_sqlfluff_verdict_not_found",
  "data_sqlfluff_verdict_unreadable",
);

const outputSchema = z
  .object({
    valid: z.boolean(),
    errorCode: z.string().nullable(),
  })
  .strict();

export default defineAction({
  description:
    "Read the safe valid/errorCode verdict for this signed-in account's private SQLFluff validation request.",
  schema: z.object({ requestId: z.string().uuid() }).strict(),
  outputSchema,
  errors: verdictErrors,
  http: { method: "GET" },
  readOnly: true,
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInBrowser: false,
  persistInChatHistory: false,
  audit: { recordInputs: false },
  run: async ({ requestId }) => {
    const scope = await manager();
    return readSqlFluffVerdict(scope, requestId);
  },
});
