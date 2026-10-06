import type { AgentKitController } from "@agent-native/agentkit";
import type {
  AgentMessage,
  AgentMessagePart,
  AgentRunOptions,
  AgentThread,
} from "@agent-native/agentkit/protocol";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageText(message: AgentMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<AgentMessagePart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function runOptions(message: AgentMessage): AgentRunOptions {
  const metadata = message.metadata ?? {};
  const effort = metadata.reasoningEffort ?? metadata.effort;
  const reasoningEffort = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ].includes(String(effort))
    ? (String(effort) as AgentRunOptions["reasoningEffort"])
    : undefined;
  return {
    ...(typeof metadata.agentId === "string"
      ? { agentId: metadata.agentId }
      : {}),
    ...(typeof metadata.model === "string" ? { model: metadata.model } : {}),
    ...(typeof (metadata.requestMode ?? metadata.mode) === "string"
      ? { mode: String(metadata.requestMode ?? metadata.mode) }
      : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    metadata,
  };
}

export async function forkAndResubmitMobileMessage(
  client: AgentKitController,
  threadId: string,
  sourceMessageId: string,
  text?: string,
): Promise<AgentThread> {
  const thread = await client.loadThread(threadId);
  const sourceIndex = thread.messages.findIndex(
    (message) => message.id === sourceMessageId,
  );
  if (sourceIndex < 0) {
    throw new Error("The message is no longer available in this conversation.");
  }

  const source = thread.messages[sourceIndex]!;
  const userMessage =
    source.role === "user"
      ? source
      : [...thread.messages.slice(0, sourceIndex)]
          .reverse()
          .find((message) => message.role === "user");
  if (!userMessage) {
    throw new Error("This response has no user message to resend.");
  }
  const userIndex = thread.messages.findIndex(
    (message) => message.id === userMessage.id,
  );
  const previousMessage = thread.messages[userIndex - 1];
  const forkedThread = await client.forkThread(threadId, previousMessage?.id);
  const metadata = userMessage.metadata;

  await client.sendMessage({
    threadId: forkedThread.id,
    text: text ?? messageText(userMessage),
    attachments: userMessage.parts.filter(
      (part): part is Extract<AgentMessagePart, { type: "file" }> =>
        part.type === "file",
    ),
    options: runOptions(userMessage),
    ...(metadata ? { metadata } : {}),
  });

  return forkedThread;
}

export async function submitMobileMessageFeedback(
  client: AgentKitController,
  threadId: string,
  messageId: string,
  value: "positive" | "negative",
  runId?: string | null,
): Promise<void> {
  const thread = client.getThread(threadId);
  const messageSeq = thread.messages.findIndex(
    (message) => message.id === messageId,
  );
  if (messageSeq < 0) {
    throw new Error("The message is no longer available in this conversation.");
  }
  const message = thread.messages[messageSeq]!;
  const metadata = record(message.metadata);
  const custom = record(metadata?.custom);
  const resolvedRunId =
    runId ??
    (typeof custom?.runId === "string" ? custom.runId : undefined) ??
    (typeof metadata?.runId === "string" ? metadata.runId : undefined) ??
    [...thread.events]
      .reverse()
      .find(
        (event) =>
          ((event.type === "message.created" ||
            event.type === "message.completed") &&
            event.message.id === messageId) ||
          ((event.type === "message.delta" ||
            event.type === "reasoning.delta") &&
            event.messageId === messageId),
      )?.runId;
  await client.submitFeedback(threadId, messageId, value, {
    ...(resolvedRunId ? { runId: resolvedRunId } : {}),
    messageSeq,
  });
}
