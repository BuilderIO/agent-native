// Export workspace-wide server plugin overrides here when you need them.
// Starter apps inherit these exports, so provide explicit framework defaults
// to keep generated workspaces warning-free until a workspace customizes them.
import {
  createAgentChatPlugin,
  defaultAuthPlugin,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";

export function createWorkspaceAgentChatPlugin(
  options?: AgentChatPluginOptions,
) {
  return createAgentChatPlugin(options);
}

export const defaultAgentChatPlugin = createWorkspaceAgentChatPlugin();
export { defaultAuthPlugin };
