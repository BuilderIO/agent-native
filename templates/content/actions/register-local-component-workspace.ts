import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  localComponentWorkspaceScope,
  registerLocalComponentWorkspace,
} from "../shared/local-component-workspaces.js";

export default defineAction({
  description:
    "Register a local workspace's components folder for Content MDX previews. This is used by the Local files UI after a trusted Desktop folder pick.",
  agentTool: false,
  schema: z.object({
    workspacePath: z
      .string()
      .min(1)
      .describe("Absolute local workspace folder path selected by Desktop"),
  }),
  run: async ({ workspacePath }, context) => {
    const result = await registerLocalComponentWorkspace({
      workspacePath,
      scope: localComponentWorkspaceScope(context?.userEmail),
    });
    return {
      ok: true,
      workspace: result.workspace,
      componentDirs: result.componentDirs,
      componentCount: result.componentDirs.length,
      reloadRequired: true,
    };
  },
});
