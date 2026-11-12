import { z } from "zod";

export const mcpConfig = z.object({
  allowDevOpen: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_MCP_DEV_OPEN",
    doc: "Allow unauthenticated MCP requests from loopback during local development.",
  }),
  scriptTools: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_MCP_SCRIPT_TOOLS",
    doc: 'Let an MCP connection opt into the script catalog (`?catalog=script` or the `x-agent-native-mcp-catalog: script` header), which offers only search-actions and run-script over the actions that declare mcpScript: "read".',
  }),
  scriptWrites: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_MCP_SCRIPT_WRITES",
    doc: 'Let scripts on the script catalog also call the actions that declare mcpScript: "write", each recorded in the script ledger before it runs. Needs `mcp.scriptTools`. Turning it off stops new writes; writes already running finish or are left for recovery.',
  }),
  scriptWriteRowBudget: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(200)
    .meta({
      env: "AGENT_NATIVE_MCP_SCRIPT_WRITE_ROW_BUDGET",
      doc: "Rows one script may change, summed over its writes' declared upper bounds and reserved before each write runs.",
    }),
  scriptWriteRecoveryMs: z
    .number()
    .int()
    .min(60_000)
    .default(20 * 60_000)
    .meta({
      env: "AGENT_NATIVE_MCP_SCRIPT_WRITE_RECOVERY_MS",
      doc: "How long after a script write starts its ledger row may still become committed: the longest a server function can run on this platform, plus a margin. Past it, a write with no receipt is recorded as not applied.",
    }),
});
