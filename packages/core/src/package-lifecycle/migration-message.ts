export const AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND =
  "npx @agent-native/core@latest upgrade --codemods";
export const AGENT_NATIVE_MIGRATION_GUIDE_URL =
  "https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/migrations/README.md";
export const AGENTKIT_CHAT_MIGRATION_GUIDE_URL = new URL(
  "../../docs/migrations/agentkit-chat.md",
  import.meta.url,
).href;

const AGENTKIT_CHAT_MIGRATION_GUIDE_SOURCE_URL =
  "https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/migrations/agentkit-chat.md";

export function resolveRemovedExportMigrationGuide(guide?: string): string {
  return !guide || guide === AGENTKIT_CHAT_MIGRATION_GUIDE_SOURCE_URL
    ? AGENTKIT_CHAT_MIGRATION_GUIDE_URL
    : guide;
}

export function migrationMoveMessage(from: string, to: string): string {
  return `${from} moved to ${to}. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}. Migration guide: ${AGENT_NATIVE_MIGRATION_GUIDE_URL}`;
}
