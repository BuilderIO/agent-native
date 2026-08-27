export const MAX_AGENT_VISIBLE_MESSAGE_CHARS = 60_000;

const PROMPT_TRUNCATION_SUFFIX = "\n\n[Prompt truncated for reliability]";

function limitAgentVisibleMessage(prompt: string, fallback: string): string {
  if (prompt.length === 0) return fallback;
  if (prompt.length <= MAX_AGENT_VISIBLE_MESSAGE_CHARS) return prompt;
  const maxPromptChars = Math.max(
    0,
    MAX_AGENT_VISIBLE_MESSAGE_CHARS - PROMPT_TRUNCATION_SUFFIX.length,
  );
  return `${prompt.slice(0, maxPromptChars)}${PROMPT_TRUNCATION_SUFFIX}`;
}

export function createDeckAgentMessage(prompt: string): string {
  return limitAgentVisibleMessage(prompt, "new deck");
}

export function addSlideAgentMessage(prompt: string): string {
  return limitAgentVisibleMessage(prompt, "a new slide");
}
