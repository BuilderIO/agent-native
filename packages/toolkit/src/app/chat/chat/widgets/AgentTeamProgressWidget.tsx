import {
  normalizeAgentTeamProgressResult,
  type AgentTeamProgressTask,
} from "@agent-native/core/action-ui";
import { useT } from "@agent-native/core/client/i18n";
import { IconUsers } from "@tabler/icons-react";

import type { ToolRendererProps } from "../tool-render-registry.js";
import { ActionCard } from "./ActionCard.js";

function taskStatusLabel(
  status: AgentTeamProgressTask["status"],
  t: ReturnType<typeof useT>,
): string {
  switch (status) {
    case "queued":
      return t("agentChat.agent.queued");
    case "completed":
      return t("agentChat.agent.completed");
    case "errored":
      return t("agentChat.agent.failed");
    default:
      return t("agentChat.status.working");
  }
}

export function AgentTeamProgressWidget({ context }: ToolRendererProps) {
  const result = normalizeAgentTeamProgressResult(context.resultJson);
  const t = useT();
  if (!result) return null;

  const cards = result.tasks.map((task) => (
    <ActionCard
      key={task.taskId}
      icon={<IconUsers aria-hidden="true" className="size-4" />}
      title={task.title}
      detail={task.detail}
      status={taskStatusLabel(task.status, t)}
      className={
        result.tasks.length > 1
          ? "rounded-none border-0 bg-transparent px-0 shadow-none"
          : ""
      }
    />
  ));

  return result.tasks.length === 1 ? (
    cards[0]
  ) : (
    <div
      role="group"
      aria-label={t("agentChat.activity.tasks")}
      className="overflow-hidden rounded-lg border border-border bg-card px-3 text-card-foreground shadow-sm"
    >
      <div className="divide-y divide-border">{cards}</div>
    </div>
  );
}
