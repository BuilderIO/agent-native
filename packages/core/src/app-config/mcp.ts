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
});
