import { z } from "zod";

export const mcpConfig = z.object({
  allowDevOpen: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_MCP_DEV_OPEN",
    doc: "Allow unauthenticated MCP requests from loopback during local development.",
  }),
  scriptTools: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_MCP_SCRIPT_TOOLS",
    doc: 'Let an MCP connection opt into the script catalog (`?catalog=script` or the `x-agent-native-mcp-catalog: script` header), which offers only search-actions and run-script over the actions that declare mcpScript: "read". Only callers in an organization on `mcp.scriptOrgs` get it.',
  }),
  scriptOrgs: z.array(z.string().trim().min(1)).default([]).meta({
    env: "AGENT_NATIVE_MCP_SCRIPT_ORGS",
    doc: "Organization IDs, comma-separated, whose MCP connections may use the script catalog once `mcp.scriptTools` is on. Each request checks the caller's own organization, so asking for the catalog never grants it. A caller with no organization never gets it, and the default empty list offers it to no one.",
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
    .min(2 * 60_000)
    .default(2 * 60_000)
    .meta({
      env: "AGENT_NATIVE_MCP_SCRIPT_WRITE_RECOVERY_MS",
      doc: "How long after a script write starts before recovery may close a write whose result was lost and that left no receipt. Recovery then fences the write's key, so it can never commit, and records it as not applied. A busy database can make that later, never sooner. At least 2 minutes, the age at which recovery first looks at a write.",
    }),
});
