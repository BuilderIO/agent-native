export const AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND =
  "npx @agent-native/core@latest upgrade --codemods";

export function migrationMoveMessage(from: string, to: string): string {
  return `${from} moved to ${to}. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}`;
}
