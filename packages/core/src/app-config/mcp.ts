import { z } from "zod";

export const mcpConfig = z.object({
  allowDevOpen: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_MCP_DEV_OPEN",
    doc: "Allow unauthenticated MCP requests from loopback during local development.",
  }),
});
