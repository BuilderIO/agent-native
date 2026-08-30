/** Stored Factory automation prompts keep the previous action names until repair. */
export const FACTORY_ACTION_RENAMES = [
  ["start-builder-for-item", "dispatch-factory-item"],
  ["govern-agent-native-pull-request", "govern-factory-pull-request"],
  ["babysit-agent-native-pull-request", "babysit-factory-pull-request"],
  ["babysit-pull-request", "propose-pr-babysit-status"],
] as const;

export function renameFactoryActionMentions(content: string): string {
  let next = content;
  for (const [from, to] of FACTORY_ACTION_RENAMES) {
    next = next.replaceAll(from, to);
  }
  return next;
}
