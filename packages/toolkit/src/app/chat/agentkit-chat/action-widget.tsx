import type { AgentWidget } from "@agent-native/agentkit/protocol";
import {
  ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER,
  ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
  normalizeActionChangeResult,
  normalizeAgentTeamProgressResult,
} from "@agent-native/core/action-ui";

import { AgentWidgetView } from "../../agentkit/react/components.js";
import {
  useAgentKit,
  useAgentThread,
  type AgentKitRenderProps,
} from "../../agentkit/react/context.js";
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

export function AgentKitActionWidget({
  value: widget,
  threadId,
}: AgentKitRenderProps<AgentWidget>) {
  const { dataChartLayout } = useAgentKit();
  const thread = useAgentThread(threadId);
  const data = asRecord(widget.data);
  const toolCallId = data?.toolCallId;
  const tool = typeof toolCallId === "string" ? thread.tools[toolCallId] : null;

  if (!tool) return <AgentWidgetView value={widget} threadId={threadId} />;

  // The run's task group already shows its tasks, so the card keeps the rest.
  let resultJson = tool.output;
  const teamTasks =
    widget.kind === ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER
      ? normalizeAgentTeamProgressResult(resultJson)?.tasks
      : undefined;
  if (teamTasks?.length && tool.runId) {
    const runTaskIds = new Set(
      thread.events.flatMap((event) =>
        event.runId === tool.runId &&
        (event.type === "task.created" ||
          event.type === "task.updated" ||
          event.type === "task.completed")
          ? [event.task.id]
          : [],
      ),
    );
    const untracked = teamTasks.filter((task) => !runTaskIds.has(task.taskId));
    if (untracked.length === 0) return null;
    if (untracked.length < teamTasks.length) resultJson = { tasks: untracked };
  }
  const messageId = thread.widgetMessageIds[widget.id];
  const attachedChangeWidgets =
    widget.kind === ACTION_CHAT_UI_RECORD_CHANGE_RENDERER && messageId
      ? Object.values(thread.widgets).filter(
          (candidate) =>
            candidate.kind === ACTION_CHAT_UI_RECORD_CHANGE_RENDERER &&
            thread.widgetMessageIds[candidate.id] === messageId,
        )
      : [];
  const relatedResults: Array<{
    widgetId: string;
    result: unknown;
    toolName: string;
  }> = attachedChangeWidgets
    .map((candidate) => {
      const candidateData = asRecord(candidate.data);
      const candidateToolCallId = candidateData?.toolCallId;
      const candidateTool =
        typeof candidateToolCallId === "string"
          ? thread.tools[candidateToolCallId]
          : null;
      return candidateTool?.status !== "completed" ||
        candidateTool.output === undefined
        ? null
        : {
            widgetId: candidate.id,
            result: candidateTool.output as unknown,
            toolName: candidateTool.name,
          };
    })
    .filter(
      (
        entry,
      ): entry is { widgetId: string; result: unknown; toolName: string } =>
        entry !== null && normalizeActionChangeResult(entry.result) !== null,
    );
  const primaryChangeWidgetId =
    relatedResults[0]?.widgetId ?? attachedChangeWidgets[0]?.id;
  if (attachedChangeWidgets.length > 1 && primaryChangeWidgetId !== widget.id) {
    return null;
  }

  const context: ToolRendererContext = {
    toolName: tool.name,
    args: asRecord(tool.input) ?? {},
    resultText:
      typeof resultJson === "string"
        ? resultJson
        : resultJson === undefined
          ? undefined
          : JSON.stringify(resultJson),
    resultJson,
    ...(relatedResults.length > 1 ? { relatedResults } : {}),
    widgetId: widget.id,
    status: tool.status,
    isRunning: tool.status === "running",
    dataChartLayout,
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
