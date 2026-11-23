import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";

const RESOURCES_WRITE_INSTRUCTION = '`resources` tool with `action: "write"`';

export function routeSkillRequestToWriteResource(
  message: AgentChatMessage,
): AgentChatMessage {
  const { context } = message;
  if (
    typeof context !== "string" ||
    !context.includes(RESOURCES_WRITE_INSTRUCTION)
  ) {
    return message;
  }
  return {
    ...message,
    context: context.replace(
      RESOURCES_WRITE_INSTRUCTION,
      "`write-resource` tool, passing only `path`, `content` and `scope` (no other fields)",
    ),
  };
}
