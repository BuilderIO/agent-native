import {
  sendToAgentChat,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";

interface OverviewChatOptions {
  openSidebar?: boolean;
  selectedEngine?: string | null;
  selectedEffort?: AgentChatMessage["effort"];
}

export function submitOverviewPrompt(
  message: string,
  selectedModel?: string | null,
  options?: OverviewChatOptions,
): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  return sendToAgentChat({
    message: trimmed,
    submit: true,
    newTab: true,
    model: selectedModel || undefined,
    ...(options?.selectedEngine ? { engine: options.selectedEngine } : {}),
    ...(options?.selectedEffort ? { effort: options.selectedEffort } : {}),
    ...(options?.openSidebar === false ? { openSidebar: false } : {}),
  });
}
