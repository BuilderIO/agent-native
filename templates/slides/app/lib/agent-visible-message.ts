function formatVisibleAgentMessage(
  action: string,
  prompt: string,
  fallback: string,
): string {
  return `${action}: ${prompt.trim() || fallback}`;
}

export function createDeckAgentMessage(prompt: string): string {
  return formatVisibleAgentMessage("Create deck", prompt, "new deck");
}

export function addSlideAgentMessage(prompt: string): string {
  return formatVisibleAgentMessage("Add slide", prompt, "a new slide");
}
