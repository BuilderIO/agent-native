import type { AgentWidget } from "@agent-native/agentkit/protocol";
import { AgentWidgetView } from "@agent-native/agentkit/react/components";
import {
  useAgentThread,
  type AgentKitRenderProps,
} from "@agent-native/agentkit/react/context";

import { ActionChatUiSurface } from "../chat/action-chat-ui-surface.js";
import { resolveToolRenderer } from "../chat/tool-render-registry.js";
import type { ToolRendererContext } from "../chat/tool-render-registry.js";
import {
  isBuiltinConnectRequiredResult,
  isBuiltinDataWidgetActionRenderer,
  isBuiltinWorkspaceFileResult,
  resolveBuiltinActionChatRenderer,
  resolveBuiltinFallbackToolRenderer,
} from "../chat/widgets/builtin-tool-renderers.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function AgentKitActionWidget({
  value: widget,
  threadId,
}: AgentKitRenderProps<AgentWidget>) {
  const thread = useAgentThread(threadId);
  const data = asRecord(widget.data);
  const toolCallId = data?.toolCallId;
  const tool = typeof toolCallId === "string" ? thread.tools[toolCallId] : null;

  if (!tool) return <AgentWidgetView value={widget} threadId={threadId} />;

  const resultJson = parseResult(tool.output);
  const context: ToolRendererContext = {
    toolName: tool.name,
    args: asRecord(tool.input) ?? {},
    resultText:
      typeof tool.output === "string"
        ? tool.output
        : tool.output === undefined
          ? undefined
          : JSON.stringify(tool.output),
    resultJson,
    isRunning: tool.status === "running",
    chatUI: {
      renderer: widget.kind,
      ...(widget.title ? { title: widget.title } : {}),
      ...(typeof widget.metadata?.description === "string"
        ? { description: widget.metadata.description }
        : {}),
    },
  };
  const Renderer =
    resolveBuiltinActionChatRenderer(context) ??
    resolveToolRenderer(context) ??
    resolveBuiltinFallbackToolRenderer(context);

  if (!Renderer) return <AgentWidgetView value={widget} threadId={threadId} />;

  return (
    <ActionChatUiSurface
      context={context}
      isBuiltinDataWidget={
        isBuiltinDataWidgetActionRenderer(context) ||
        isBuiltinWorkspaceFileResult(context) ||
        isBuiltinConnectRequiredResult(context)
      }
    >
      <Renderer context={context} />
    </ActionChatUiSurface>
  );
}
