import {
  createAgentChatPlugin,
  defaultAuthPlugin,
  type AgentChatPluginOptions,
  type NitroPluginDef,
} from "@agent-native/core/server";

export function createWorkspaceAgentChatPlugin(
  options?: AgentChatPluginOptions,
): NitroPluginDef {
  return createAgentChatPlugin(options);
}

export const defaultAgentChatPlugin: NitroPluginDef =
  createWorkspaceAgentChatPlugin();
export { defaultAuthPlugin };
