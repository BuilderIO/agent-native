import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { T3_CODE_AGENTS_LAB } from "../../labs/core-labs.js";
import { assertLabEnabled } from "../../labs/guard.js";
import { getT3CodeStatus } from "../../mcp-client/t3-code.js";

export default defineAction({
  description:
    "Return the current user's T3 Code connection: its computer, access level, the agents it offers, and when T3 will ask them to sign in again.",
  schema: z.object({}),
  outputSchema: z.object({
    state: z.enum(["disconnected", "connected", "reconnect", "unreachable"]),
    url: z.string().optional(),
    computer: z.string().optional(),
    access: z.enum(["read", "operate"]).optional(),
    agents: z.array(
      z.object({
        kind: z.enum(["claude-code", "codex"]),
        name: z.string(),
        providerInstanceId: z.string(),
        model: z.string(),
      }),
    ),
    expiresAt: z.number().optional(),
  }),
  http: { method: "GET" },
  mcpTool: false,
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    await assertLabEnabled(T3_CODE_AGENTS_LAB, ctx);
    return getT3CodeStatus(email);
  },
});
