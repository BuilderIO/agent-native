export const AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND =
  "npx agent-native upgrade --codemods";
export const AGENT_NATIVE_MIGRATION_GUIDE_URL =
  "https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx";
export const AGENTKIT_CHAT_MIGRATION_GUIDE_URL =
  "https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/migrations/agentkit-chat.md";

export function migrationMoveMessage(from: string, to: string): string {
  return `${from} moved to ${to}. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}. Migration guide: ${AGENT_NATIVE_MIGRATION_GUIDE_URL}`;
}
