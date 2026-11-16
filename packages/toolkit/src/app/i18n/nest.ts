import type { ToolkitAgentChatTranslation } from "./types.js";

export type ToolkitLocaleMessages = Record<string, unknown>;

const legacyAliases = [
  ["onboarding.fileStorage", "onboarding.fileStorage"],
  ["agentPanel.addOwnKeys", "composer.addOwnKeys"],
  ["agentPanel.builderModelCredits", "composer.builderModelCredits"],
  ["agentPanel.builderOrOwnKeys", "setup.builderOrOwnKeys"],
  ["agentPanel.chat", "shell.chat"],
  ["agentPanel.closeTab", "tabs.closeTab"],
  ["agentPanel.configureProviderKeys", "composer.configureProviderKeys"],
  ["agentPanel.connectAi", "setup.connectAi"],
  ["agentPanel.connectBuilderIo", "composer.connectBuilder"],
  ["agentPanel.connectingBuilder", "composer.connectingBuilder"],
  ["agentPanel.loadingTerminal", "shell.loadingTerminal"],
  ["agentPanel.newChat", "tabs.newChat"],
  ["agentPanel.toggleAgent", "shell.toggleAgent"],
  ["agentPanel.voiceMode", "voiceMode"],
  ["contextXray", "contextXray"],
  ["mcpIntegrations", "mcpIntegrations"],
] as const;

function setNestedMessage(
  messages: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const parts = path.split(".");
  const leaf = parts.pop();
  if (leaf === undefined) return;
  let cursor = messages;
  for (const part of parts) {
    const nested = cursor[part];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[leaf] = value;
}

function getNestedMessage(messages: Record<string, unknown>, path: string) {
  let value: unknown = messages;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Pure nesting/legacy-alias transform shared by the synchronous aggregate
 * (`catalog.ts`) and the lazy per-locale loaders. This module imports no
 * catalogs, so the async path never pulls the aggregate.
 */
export function nestAgentChatMessages(
  flatMessages: ToolkitAgentChatTranslation,
): ToolkitLocaleMessages {
  const agentChat: Record<string, unknown> = {};
  for (const [flatKey, message] of Object.entries(flatMessages)) {
    setNestedMessage(agentChat, flatKey, message);
  }

  const messages: ToolkitLocaleMessages = { agentChat };
  for (const [legacyPath, agentChatPath] of legacyAliases) {
    const value = getNestedMessage(agentChat, agentChatPath);
    if (value !== undefined) setNestedMessage(messages, legacyPath, value);
  }

  messages.observability = Object.fromEntries(
    [
      "summarizeWithAgent",
      "regenerateSummary",
      "summarizeWithAgentHelp",
      "regenerateSummaryHelp",
      "summarySending",
      "summaryQueued",
      "summaryFailed",
      "summaryExpired",
    ].map((key) => [
      key,
      flatMessages[`observability.${key}` as keyof ToolkitAgentChatTranslation],
    ]),
  );

  return messages;
}
