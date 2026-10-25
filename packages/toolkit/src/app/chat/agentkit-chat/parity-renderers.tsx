import type {
  AgentMessage,
  AgentMessagePart,
  AgentToolCall,
} from "@agent-native/agentkit/protocol";
import type { ContentPart } from "@agent-native/core/client/agent-chat";
import { useMemo } from "react";

import {
  useAgentThreadSelector,
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

function isFileChangeTool(
  tool: AgentToolCall,
  messageId: string,
  runId?: string,
): boolean {
  if (
    tool.messageId !== messageId &&
    !(runId && tool.runId === runId && !tool.messageId)
  ) {
    return false;
  }
  const toolKind = tool.metadata?.toolKind;
  return toolKind === "edit" || toolKind === "write";
}

export function agentKitFileChangeParts(
  tools: readonly AgentToolCall[],
  messageId: string,
  runId?: string,
): ContentPart[] {
  return tools
    .filter((tool) => isFileChangeTool(tool, messageId, runId))
    .map((tool) => {
      const metadata = tool.metadata ?? {};
      const input =
        tool.input &&
        typeof tool.input === "object" &&
        !Array.isArray(tool.input)
          ? (tool.input as Record<string, unknown>)
          : {};

      return {
        type: "tool-call" as const,
        toolCallId: tool.id,
        toolName: tool.name,
        argsText: JSON.stringify(input),
        args: Object.fromEntries(
          Object.entries(input).map(([key, value]) => [key, String(value)]),
        ),
        ...(typeof tool.output === "string" ? { result: tool.output } : {}),
        structuredMeta: metadata,
      };
    });
}

function sameTools(
  previous: readonly AgentToolCall[],
  next: readonly AgentToolCall[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((tool, index) => tool === next[index])
  );
}

export function AgentKitFilesChangedSummary({
  value,
  threadId,
}: AgentKitRenderProps<AgentMessage>) {
  const runId =
    typeof value.metadata?.runId === "string"
      ? value.metadata.runId
      : undefined;
  const tools = useAgentThreadSelector(
    (thread) =>
      Object.values(thread.tools).filter((tool) =>
        isFileChangeTool(tool, value.id, runId),
      ),
    sameTools,
    threadId,
  );
  const parts = useMemo(
    () => agentKitFileChangeParts(tools, value.id, runId),
    [runId, tools, value.id],
  );
  return <FilesChangedSummary parts={parts} />;
}
