import type {
  AgentParticipant,
  AgentWidget,
} from "@agent-native/agentkit/protocol";
import {
  AGENT_CALL_APPROVAL_WIDGET_KIND,
  sendToAgentChatAndConfirm,
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
  const { agent, id, tool, url, taskId, callId } = value as Record<
    string,
    unknown
  >;
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
    taskId &&
    typeof callId === "string" &&
    callId
    ? { agent, id, tool, url, taskId, callId }
    : undefined;
}

const SETTLED_PREFIX = "agent-native:agent-call-approval:";

// A reload renders the same widget again, so a card the person already
// continued or dismissed stays closed for the rest of the session. It records
// the calls its task had made by then, so a newer call that finds the same
// approval still waiting, or a newer call that failed, shows the card again.
function readSettled(id: string): readonly string[] | undefined {
  try {
    const saved: unknown = JSON.parse(
      window.sessionStorage.getItem(SETTLED_PREFIX + id) ?? "null",
    );
    return Array.isArray(saved)
      ? saved.filter((call): call is string => typeof call === "string")
      : undefined;
  } catch {
    // coercion-ok: an unreadable marker shows the card again.
    return undefined;
  }
}

function rememberSettled(id: string, calls: readonly string[]): void {
  try {
    window.sessionStorage.setItem(SETTLED_PREFIX + id, JSON.stringify(calls));
  } catch {
    // coercion-ok: without session storage the card just shows again on reload.
  }
}

type AgentThread = ReturnType<typeof useAgentThread>;

// Each call that finds an approval waiting moves that approval's card to its
// own reply, so the task waits on the approval whose card sits in the latest
// reply. An earlier approval's card on the same task is settled, and the saved
// thread shows that in every tab.
function laterApprovalOnTask(
  thread: AgentThread,
  widgetId: string,
  taskId: string,
): boolean {
  const order = new Map(
    thread.messages.map((message, index) => [message.id, index]),
  );
  const at = (id: string) => order.get(thread.widgetMessageIds[id] ?? "") ?? -1;
  const own = at(widgetId);
  return Object.values(thread.widgets).some(
    (other) =>
      other.id !== widgetId &&
      other.kind === AGENT_CALL_APPROVAL_WIDGET_KIND &&
      readApproval(other.data)?.taskId === taskId &&
      at(other.id) > own,
  );
}

// Another call on the task that is working means the task is being resumed,
// from this tab or another one, and Continue would only resume it twice. A
// call names its task only once it ends, so a working call to the same peer
// with no task yet counts too. A run that stopped can leave its call marked
// working, so this holds only while the chat has a run going.
function resumeRunning(
  thread: AgentThread,
  approval: AgentCallApprovalWidgetData,
): boolean {
  return (
    thread.activeRunIds.length > 0 &&
    Object.values(thread.agents).some(
      (call) =>
        call.id !== approval.callId &&
        call.status === "working" &&
        (call.activeTaskId === approval.taskId ||
          (call.activeTaskId === undefined && call.name === approval.agent)),
    )
  );
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
  const calls = Object.values(thread.agents).filter(
    (agent) => agent.activeTaskId === approval.taskId,
  );
  // A call on the same task that completed means the approved action already
  // ran, or the task ended. The task's own status can't tell: the chat settles
  // a paused task as soon as its own turn ends. A failed call doesn't count:
  // the resume itself can fail while the approval is still waiting.
  if (
    calls.some((call) => call.status === "completed") ||
    laterApprovalOnTask(thread, widget.id, approval.taskId) ||
    resumeRunning(thread, approval)
  ) {
    return null;
  }
  return (
    <AgentCallApprovalCard
      key={approval.id}
      approval={approval}
      calls={calls}
    />
  );
}

function AgentCallApprovalCard({
  approval,
  calls,
}: {
  approval: AgentCallApprovalWidgetData;
  calls: readonly AgentParticipant[];
}) {
  const t = useT();
  const { agent } = approval;
  const [phase, setPhase] = useState<"review" | "continue" | "sending">(
    "review",
  );
  const [settledCalls, setSettledCalls] = useState<
    readonly string[] | undefined
  >(() =>
    typeof window !== "undefined" ? readSettled(approval.id) : undefined,
  );
  // Continue can come before the approval: the peer then answers with the same
  // approval still waiting, on a newer call, and the card comes back for it. A
  // call that pauses on another approval writes that approval's card instead.
  // A call that failed after the card closed brings it back as well: the
  // approval may still be waiting.
  if (
    settledCalls &&
    settledCalls.includes(approval.callId) &&
    !calls.some(
      (call) => call.status === "failed" && !settledCalls.includes(call.id),
    )
  ) {
    return null;
  }

  const settle = () => {
    const known = Array.from(
      new Set([
        ...(settledCalls ?? []),
        approval.callId,
        ...calls.map((call) => call.id),
      ]),
    );
    rememberSettled(approval.id, known);
    setSettledCalls(known);
    setPhase("review");
  };
  // The card closes only once the chat took the continuation. If it didn't,
  // the card stays so Continue can be pressed again.
  const continueTask = async () => {
    setPhase("sending");
    let delivered = false;
    try {
      ({ delivered } = await sendToAgentChatAndConfirm({
        message: t("agentChat.tool.agentApprovalContinueMessage", { agent }),
        context:
          `The user approved the pending action in ${agent}. ` +
          `Call call-agent with agent="${agent}" and taskId="${approval.taskId}" ` +
          "and no message to continue that same task.",
        submit: true,
        chatTarget: "local",
      }));
    } catch {
      // coercion-ok: a send that threw was not delivered; Continue stays.
    }
    if (delivered) settle();
    else setPhase("continue");
  };
  const review = () => {
    window.open(approval.url, "_blank", "noopener,noreferrer");
    setPhase("continue");
  };
  const reviewLabel = t("agentChat.tool.agentApprovalReview", { agent });
  // Dismissing only closes the card: the approval stays pending in the peer
  // app, and nothing runs unless the person approves it there.
  const dismiss: ApprovalCardAction = {
    id: "dismiss",
    label: t("agentChat.common.dismiss"),
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
          dismiss,
        ]
      : [
          {
            id: "continue",
            label: t("agentChat.common.continue"),
            intent: "primary",
            pending: phase === "sending",
            disabled: phase === "sending",
            onPress: () => void continueTask(),
          },
          { id: "review", label: reviewLabel, onPress: review },
          dismiss,
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
