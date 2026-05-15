import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createWorkspaceResource } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    'Create a workspace-wide skill, instruction, agent profile, or reference resource. Set scope to "all" to push to every app, or "selected" to grant per-app.',
  schema: z.object({
    kind: z
      .enum(["skill", "instruction", "agent", "knowledge"])
      .describe("Resource kind: skill, instruction, agent, or knowledge"),
    name: z.string().describe("Human-readable name"),
    description: z.string().optional().describe("Short description"),
    path: z
      .string()
      .describe(
        'Resource path in target apps. Use "skills/<name>/SKILL.md" for skills, "AGENTS.md" or "instructions/<name>.md" for always-on guardrails, "context/<name>.md" for reference resources, and "agents/<name>.md" for custom agents.',
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
