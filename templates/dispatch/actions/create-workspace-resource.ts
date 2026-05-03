import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createWorkspaceResource } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    'Create a workspace-wide skill, instruction, or agent profile. Set scope to "all" to push to every app, or "selected" to grant per-app.',
  schema: z.object({
    kind: z
      .enum(["skill", "instruction", "agent"])
      .describe("Resource kind: skill, instruction, or agent"),
    name: z.string().describe("Human-readable name"),
    description: z.string().optional().describe("Short description"),
    path: z
      .string()
      .describe(
        'Resource path, e.g. "skills/designer.md", "agents/researcher.md", or "remote-agents/researcher.json"',
      ),
    content: z
      .string()
      .describe("Full resource content (markdown or remote-agent JSON)"),
    scope: z
      .enum(["all", "selected"])
      .describe(
        '"all" = push to every app, "selected" = only apps with explicit grants',
      ),
  }),
  run: async (args) => createWorkspaceResource(args),
});
