import {
  parseQueueMessageInput,
  type AgentSubmissionReference,
} from "@agent-native/agentkit/protocol";

export function parseAgentChatReferences(
  value: unknown,
): AgentSubmissionReference[] {
  return (
    parseQueueMessageInput({
      threadId: "composer-handoff",
      text: "",
      references: value,
    }).references ?? []
  );
}
