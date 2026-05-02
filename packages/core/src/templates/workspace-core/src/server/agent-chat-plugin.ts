/**
 * Workspace-wide agent-chat plugin for @{{APP_NAME}}/shared.
 *
 * This mounts the framework's default agent-chat plugin so every app in
 * the workspace gets the same chat endpoint, mention providers, and
 * built-in tools. The ENTERPRISE-WIDE system prompt additions — things
 * the agent should know across every app — live in the workspace's
 * AGENTS.md file, which is loaded automatically into the prompt as a
 * `<resource scope="workspace">` block.
 *
 * Customize this wrapper when you need agent behavior that can't be
 * expressed in AGENTS.md — e.g. injecting enterprise-specific mention
 * providers, pre-loading a custom set of MCP servers, or rewriting
 * model choice based on your company's allowlist.
 */
import { defaultAgentChatPlugin } from "@agent-native/core/server";

export const agentChatPlugin = async (nitroApp: any): Promise<void> => {
  await defaultAgentChatPlugin(nitroApp);

  // Hook for enterprise customization:
  //
  //   const chat = createAgentChatPlugin({
  //     systemPrompt: (base) => `${base}\n\nCompany policy: …`,
  //     mentionProviders: {
  //       people: async (query) => searchCompanyDirectory(query),
  //     },
  //   });
  //   await chat(nitroApp);
};
