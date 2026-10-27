import type { AgentApprovalRequest } from "@agent-native/agentkit/protocol";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  ApprovalCard,
  approvalRequestKind,
  type ApprovalCardAction,
} from "../../agentkit/react/approval-card.js";
import { AgentApprovalPrompt } from "../../agentkit/react/components.js";
import {
  useAgentKit,
  useAgentKitControl,
  useAgentKitMutation,
  useAgentThread,
  type AgentKitRenderProps,
} from "../../agentkit/react/context.js";

type ApprovalSlotProps = AgentKitRenderProps<AgentApprovalRequest> & {
  runId: string;
};

function safeToolName(request: AgentApprovalRequest): string | undefined {
  const value = request.metadata?.toolName;
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)
  ) {
    return undefined;
  }
  return value.replace(/[._:-]+/g, " ");
}

function safeTarget(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
  ) {
    return undefined;
  }
  return value;
}

function safeReleaseSummary(
  request: AgentApprovalRequest,
  t: ReturnType<typeof useT>,
): string | undefined {
  const toolName = safeToolName(request);
  const metadataInput = request.metadata?.input;
  if (
    !toolName?.includes("release") ||
    !metadataInput ||
    typeof metadataInput !== "object" ||
    Array.isArray(metadataInput)
  ) {
    return undefined;
  }

  const input = metadataInput as Record<string, unknown>;
  const release = safeTarget(input.release);
  if (!release) return undefined;

  const environment =
    input.environment === undefined ? undefined : safeTarget(input.environment);
  if (input.environment !== undefined && !environment) return undefined;
  return environment
    ? t("agentChat.approval.releaseSummary", { release, environment })
    : t("agentChat.approval.releaseSummaryWithoutEnvironment", { release });
}

function SimpleToolApproval({
  request,
  threadId,
  runId,
  toolName,
}: {
  request: AgentApprovalRequest;
  threadId: string;
  runId: string;
  toolName?: string;
}) {
  const t = useT();
  const { requestComposerFocus } = useAgentKit();
  const control = useAgentKitControl(threadId);
  const thread = useAgentThread(threadId);
  const editPrompt = t("agentChat.approval.editPrompt");
  const queuedEdit = thread.queuedMessages.find(
    (message) =>
      message.metadata?.["agent-native.core.approval-edit"] === request.id,
  );
  const resolution = useAgentKitMutation(
    async (options: {
      decision: "approve" | "deny";
      requestRevision?: boolean;
    }) => {
      if (options.requestRevision) {
        if (!queuedEdit) {
          await control.queueMessage({
            text: editPrompt,
            metadata: { "agent-native.core.approval-edit": request.id },
          });
        }
      } else if (queuedEdit) {
        await control.removeQueued(queuedEdit.id);
      }
      await control.resolveApproval(runId, request.id, {
        decision: options.decision,
        optionIds: [options.decision],
      });
    },
  );
  const question =
    safeReleaseSummary(request, t) ??
    t("agentChat.approval.question", {
      tool: toolName ?? t("agentChat.approval.action"),
    });
  const [pressedId, setPressedId] = useState<string>();
  const resolve = (
    actionId: string,
    decision: "approve" | "deny",
    requestRevision = false,
  ) => {
    setPressedId(actionId);
    void resolution
      .execute({ decision, requestRevision })
      .catch(() => undefined)
      .finally(() => requestComposerFocus(threadId));
  };

  const actions = (
    [
      {
        id: "approve",
        label: t("agentChat.approval.approve"),
        intent: "primary",
        onPress: () => resolve("approve", "approve"),
      },
      {
        id: "deny",
        label: t("agentChat.approval.deny"),
        onPress: () => resolve("deny", "deny"),
      },
      {
        id: "edit",
        label: t("agentChat.approval.edit"),
        onPress: () => resolve("edit", "deny", true),
      },
    ] satisfies ApprovalCardAction[]
  ).map(
    (action): ApprovalCardAction => ({
      ...action,
      pending: resolution.pending && pressedId === action.id,
    }),
  );

  return (
    <ApprovalCard
      title={question}
      status={t("agentChat.approval.pending")}
      actions={actions}
      busy={resolution.pending}
      error={resolution.error?.message}
    />
  );
}

export function CoreAgentKitApproval(props: ApprovalSlotProps) {
  const { value: request, runId } = props;
  const toolName = safeToolName(request);
  const simpleToolApproval =
    approvalRequestKind(request) === "approval" &&
    !request.input &&
    (!request.options || request.options.length === 0);

  return simpleToolApproval ? (
    <SimpleToolApproval
      request={request}
      threadId={props.threadId}
      runId={runId}
      toolName={toolName}
    />
  ) : (
    <AgentApprovalPrompt request={request} runId={runId} />
  );
}
