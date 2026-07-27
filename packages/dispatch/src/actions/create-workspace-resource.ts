import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { createWorkspaceResource } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    'Create a workspace-wide skill, instruction, agent profile, reference resource, or MCP server. Set scope to "all" for runtime inheritance by every app, or "selected" to grant per-app. When Dispatch approval policy is enabled, All-app creates queue an approval request before taking effect.',
  schema: z.object({
    kind: z
      .enum(["skill", "instruction", "agent", "knowledge", "mcp-server"])
      .describe(
        "Resource kind: skill, instruction, agent, knowledge, or mcp-server",
      ),
    name: z.string().describe("Human-readable name"),
    description: z.string().optional().describe("Short description"),
    path: z
      .string()
      .describe(
        'Resource path in target apps. Use "skills/<name>/SKILL.md" for skills, "AGENTS.md" or "instructions/<name>.md" for always-on guardrails, "context/<name>.md" for reference resources, "agents/<name>.md" for custom agents, and "mcp-servers/<name>.json" for HTTP MCP servers.',
      ),
    content: z.string().describe("Full resource content (markdown or JSON)"),
    scope: z
      .enum(["all", "selected"])
      .describe(
        '"all" = inherited by every app at runtime, "selected" = only apps with explicit grants',
      ),
  }),
  run: async (args) => createWorkspaceResource(args),
});
