import { isInBuilderFrame, sendToAgentChat } from "@agent-native/core/client";

export function submitOverviewPrompt(
  message: string,
  selectedModel?: string | null,
  options?: { openSidebar?: boolean },
): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  if (isInBuilderFrame()) {
    return sendToAgentChat({
      message: trimmed,
      submit: true,
      type: "code",
    });
  }

  return sendToAgentChat({
    message: trimmed,
    submit: true,
    newTab: true,
    model: selectedModel || undefined,
    ...(options?.openSidebar === false ? { openSidebar: false } : {}),
  });
}
