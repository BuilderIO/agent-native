import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { T3_CODE_AGENTS_LAB } from "../../labs/core-labs.js";
import { assertLabEnabled } from "../../labs/guard.js";
import { disconnectT3Code } from "../../mcp-client/t3-code.js";

export default defineAction({
  requiresSignedInBrowser: true,
  description:
    "Sign the current user out of T3 Code. Their agents leave the @ menu at once; T3 is asked to revoke the sign-in.",
  schema: z.object({}),
  outputSchema: z.object({ disconnected: z.boolean() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  mcpTool: false,
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    await assertLabEnabled(T3_CODE_AGENTS_LAB, ctx);
    return disconnectT3Code(email);
  },
});
