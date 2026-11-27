import { defineLab } from "./registry.js";

export const CHATGPT_SUBSCRIPTION_LAB = defineLab({
  key: "chatgpt-subscription",
  displayName: "ChatGPT plan access",
  displayNameKey: "agentChat.settingsModel.chatgptTitle",
  descriptionKey: "agentChat.settingsModel.chatgptDescription",
  keywords: "OpenAI Codex GPT Plus Pro OAuth",
});

export const T3_CODE_AGENTS_LAB = defineLab({
  key: "t3-code-agents",
  displayName: "T3 Code agents",
  displayNameKey: "agentChat.settingsModel.t3CodeTitle",
  descriptionKey: "agentChat.settingsModel.t3CodeDescription",
  keywords: "T3 Code Claude Code Codex agents comments tag MCP",
});

/** Labs Core defines; Settings lists the ones an app's server registered. */
export const CORE_LABS = [
  CHATGPT_SUBSCRIPTION_LAB,
  T3_CODE_AGENTS_LAB,
] as const;
