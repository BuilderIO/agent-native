import type {
  AgentMessage,
  AgentMessagePart,
  AgentToolCall,
} from "@agent-native/agentkit/protocol";
import type { ContentPart } from "@agent-native/core/client/agent-chat";

import {
  useAgentThread,
  type AgentKitRenderProps,
} from "../../agentkit/react/index.js";
import { StreamingText } from "../chat/markdown-renderer.js";
import { FilesChangedSummary } from "../chat/tool-call-display.js";

type TextPart = Extract<AgentMessagePart, { type: "text" }>;

export function AgentKitMarkdownText({
  value,
  threadId,
  active,
  resetKey,
}: AgentKitRenderProps<TextPart>) {
  if (value.format !== "markdown") {
    return <p className="whitespace-pre-wrap">{value.text}</p>;
  }

  return (
    <StreamingText
      text={value.text}
      streaming={active === true}
      resetKey={resetKey ?? `${threadId}:markdown`}
    />
  );
}

export function agentKitFileChangeParts(
  tools: readonly AgentToolCall[],
  messageId: string,
  runId?: string,
): ContentPart[] {
  return tools.flatMap((tool) => {
    if (
      tool.messageId !== messageId &&
      !(runId && tool.runId === runId && !tool.messageId)
    ) {
      return [];
    }
    const metadata = tool.metadata ?? {};
    const toolKind = metadata.toolKind;
    if (toolKind !== "edit" && toolKind !== "write") return [];
    const input =
      tool.input && typeof tool.input === "object" && !Array.isArray(tool.input)
        ? (tool.input as Record<string, unknown>)
        : {};

    return [
      {
        type: "tool-call" as const,
        toolCallId: tool.id,
        toolName: tool.name,
        argsText: JSON.stringify(input),
        args: Object.fromEntries(
          Object.entries(input).map(([key, value]) => [key, String(value)]),
        ),
        result: typeof tool.output === "string" ? tool.output : undefined,
        structuredMeta: metadata,
      },
    ];
  });
}

export function AgentKitFilesChangedSummary({
  value,
  threadId,
}: AgentKitRenderProps<AgentMessage>) {
  const thread = useAgentThread(threadId);
  const runId =
    typeof value.metadata?.runId === "string"
      ? value.metadata.runId
      : undefined;
  const parts = agentKitFileChangeParts(
    Object.values(thread.tools),
    value.id,
    runId,
  );
  return <FilesChangedSummary parts={parts} />;
}
