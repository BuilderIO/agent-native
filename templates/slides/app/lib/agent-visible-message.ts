export function createDeckAgentMessage(prompt: string): string {
  return prompt.length > 0 ? prompt : "new deck";
}

export function addSlideAgentMessage(prompt: string): string {
  return prompt.length > 0 ? prompt : "a new slide";
}
