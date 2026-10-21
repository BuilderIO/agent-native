export const AGENT_INTERNAL_CONTINUE_PROMPT =
  "Continue from where you left off and finish the user's original request. Do not repeat completed work, do not mention internal reconnects, time limits, or step limits, and continue as if this is the same uninterrupted run.";

export function isAgentInternalContinuationPrompt(text: string): boolean {
  return text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT);
}
