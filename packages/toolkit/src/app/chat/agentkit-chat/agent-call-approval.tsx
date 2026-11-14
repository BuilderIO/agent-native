import type { AgentWidget } from "@agent-native/agentkit/protocol";
import {
  sendToAgentChat,
  type AgentCallApprovalWidgetData,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  ApprovalCard,
  type ApprovalCardAction,
} from "../../agentkit/react/approval-card.js";
import {
  useAgentThread,
  type AgentKitRenderProps,
} from "../../agentkit/react/context.js";

function isWebPage(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    // coercion-ok: a link that does not parse shows no card.
    return false;
  }
}

function readApproval(value: unknown): AgentCallApprovalWidgetData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { agent, id, tool, url, taskId } = value as Record<string, unknown>;
  // A restored thread is data too: open only a web page, never a script URL.
  return typeof agent === "string" &&
    agent &&
    typeof id === "string" &&
    id &&
    typeof tool === "string" &&
    tool &&
    typeof url === "string" &&
    isWebPage(url) &&
    typeof taskId === "string" &&
    taskId
    ? { agent, id, tool, url, taskId }
    : undefined;
}

const SETTLED_PREFIX = "agent-native:agent-call-approval:";

// A reload renders the same widget again, so a card the person already
// continued or dismissed stays closed for the rest of the session.
function isSettled(id: string): boolean {
  try {
    return window.sessionStorage.getItem(SETTLED_PREFIX + id) === "settled";
  } catch {
    // coercion-ok: without session storage the card just shows again on reload.
    return false;
  }
}

function rememberSettled(id: string): void {
  try {
    window.sessionStorage.setItem(SETTLED_PREFIX + id, "settled");
  } catch {
    // coercion-ok: without session storage the card just shows again on reload.
  }
}

/**
 * The peer runs the action only after the person approves it on the peer's
 * own page. Continuing then resumes the same delegated task, which returns the
 * approved action's result.
 */
export function AgentKitAgentCallApproval({
  value: widget,
  threadId,
}: AgentKitRenderProps<AgentWidget>) {
  const thread = useAgentThread(threadId);
  const approval = readApproval(widget.data);
  if (!approval) return null;
  // Once the continued task has finished, there is nothing left to approve.
  const task = thread.tasks[approval.taskId];
  if (
    task?.status === "completed" ||
    task?.status === "failed" ||
    task?.status === "cancelled"
  ) {
    return null;
  }
  return <AgentCallApprovalCard key={approval.id} approval={approval} />;
}

function AgentCallApprovalCard({
  approval,
}: {
  approval: AgentCallApprovalWidgetData;
}) {
  const t = useT();
  const { agent } = approval;
  const [phase, setPhase] = useState<"review" | "continue" | "settled">(() =>
    typeof window !== "undefined" && isSettled(approval.id)
      ? "settled"
      : "review",
  );
  if (phase === "settled") return null;

  const settle = () => {
    rememberSettled(approval.id);
    setPhase("settled");
  };
  const review = () => {
    window.open(approval.url, "_blank", "noopener,noreferrer");
    setPhase("continue");
  };
  const reviewLabel = t("agentChat.tool.agentApprovalReview", { agent });
  const cancel: ApprovalCardAction = {
    id: "cancel",
    label: t("agentChat.common.cancel"),
    onPress: settle,
  };
  const actions: ApprovalCardAction[] =
    phase === "review"
      ? [
          {
            id: "review",
            label: reviewLabel,
            intent: "primary",
            onPress: review,
          },
          cancel,
        ]
      : [
          {
            id: "continue",
            label: t("agentChat.common.continue"),
            intent: "primary",
            onPress: () => {
              sendToAgentChat({
                message: t("agentChat.tool.agentApprovalContinueMessage", {
                  agent,
                }),
                context:
                  `The user approved the pending action in ${agent}. ` +
                  `Call call-agent with agent="${agent}" and taskId="${approval.taskId}" ` +
                  "and no message to continue that same task.",
                submit: true,
              });
              settle();
            },
          },
          { id: "review", label: reviewLabel, onPress: review },
          cancel,
        ];
  return (
    <ApprovalCard
      title={t("agentChat.tool.agentApprovalTitle", { agent })}
      detail={approval.tool}
      status={
        phase === "review"
          ? t("agentChat.approval.pending")
          : t("agentChat.tool.agentApprovalReturn", { agent })
      }
      className="agent-call-approval-card my-2 w-full max-w-[30rem]"
      actions={actions}
    />
  );
}
