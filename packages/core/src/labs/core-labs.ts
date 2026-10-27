import { defineLab } from "./registry.js";

export const CHATGPT_SUBSCRIPTION_LAB = defineLab({
  key: "chatgpt-subscription",
  displayName: "ChatGPT plan access",
  displayNameKey: "agentChat.settingsModel.chatgptTitle",
  descriptionKey: "agentChat.settingsModel.chatgptDescription",
  keywords: "OpenAI Codex GPT Plus Pro OAuth",
});

/**
 * Lets one person's MCP connections show MCP Apps cards (`_meta.ui`
 * resources) on tool results. The ChatGPT app-directory catalog and
 * first-party callers get cards without it. Registered by `mountMCP`.
 */
export const MCP_APP_CARDS_LAB = defineLab({
  key: "mcp-app-cards",
  displayName: "App cards in chat apps",
  displayNameKey: "agentChat.settingsShell.appGroup.mcpAppCards",
  descriptionKey: "agentChat.settingsShell.appGroup.mcpAppCardsDescription",
  keywords: "MCP Apps inline cards widgets Claude ChatGPT connector",
});

/** Labs that Core registers itself; Settings lists the ones a server reports. */
export const CORE_LABS = [CHATGPT_SUBSCRIPTION_LAB, MCP_APP_CARDS_LAB] as const;
