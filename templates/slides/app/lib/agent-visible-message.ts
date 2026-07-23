export const MAX_AGENT_VISIBLE_MESSAGE_CHARS = 60_000;

function formatVisibleAgentMessage(
  action: string,
  prompt: string,
  fallback: string,
): string {
  const prefix = `${action}: `;
  const trimmedPrompt = prompt.trim() || fallback;
  if (prefix.length + trimmedPrompt.length <= MAX_AGENT_VISIBLE_MESSAGE_CHARS) {
    return `${prefix}${trimmedPrompt}`;
  }

  const suffix = "\n\n[Prompt truncated for reliability]";
  const maxPromptChars = Math.max(
    0,
    MAX_AGENT_VISIBLE_MESSAGE_CHARS - prefix.length - suffix.length,
  );
  return `${prefix}${trimmedPrompt.slice(0, maxPromptChars)}${suffix}`;
}

export function createDeckAgentMessage(prompt: string): string {
  return formatVisibleAgentMessage("Create deck", prompt, "new deck");
}

export function addSlideAgentMessage(prompt: string): string {
  return formatVisibleAgentMessage("Add slide", prompt, "a new slide");
}
