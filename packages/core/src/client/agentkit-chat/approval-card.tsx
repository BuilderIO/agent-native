import type { AgentApprovalRequest } from "@agent-native/agentkit/protocol";
import { AgentApprovalPrompt } from "@agent-native/agentkit/react/components";
import {
  useAgentKit,
  useAgentKitControl,
  useAgentKitMutation,
  useAgentThread,
  type AgentKitRenderProps,
} from "@agent-native/agentkit/react/context";
import { IconShieldCheck } from "@tabler/icons-react";

import { ActionCard } from "../chat/widgets/ActionCard.js";
import { compactOutlineButtonClassName } from "../components/ui/button-classes.js";
import { useT } from "../i18n.js";

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
  const metadataInput = request.metadata?.input;
  if (
    request.metadata?.toolName !== "accept-agentkit-release" ||
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
  const resolve = (decision: "approve" | "deny", requestRevision = false) =>
    void resolution
      .execute({ decision, requestRevision })
      .catch(() => undefined)
      .finally(() => requestComposerFocus(threadId));

  return (
    <div
      className="agentkit-approval"
      role="group"
      aria-label={question}
      aria-busy={resolution.pending}
    >
      <ActionCard
        icon={<IconShieldCheck aria-hidden="true" className="size-4" />}
        title={question}
        status={t("agentChat.approval.pending")}
        className="border-0 bg-transparent shadow-none"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={resolution.pending}
              onClick={() => resolve("approve")}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            >
              {t("agentChat.approval.approve")}
            </button>
            <button
              type="button"
              disabled={resolution.pending}
              onClick={() => resolve("deny")}
              className={compactOutlineButtonClassName}
            >
              {t("agentChat.approval.deny")}
            </button>
            <button
              type="button"
              disabled={resolution.pending}
              onClick={() => resolve("deny", true)}
              className={compactOutlineButtonClassName}
            >
              {t("agentChat.approval.edit")}
            </button>
          </div>
        }
      />
      {resolution.error ? (
        <p
          role="alert"
          className="agentkit-command-error block px-3 pb-3 text-xs"
        >
          {resolution.error.message}
        </p>
      ) : null}
    </div>
  );
}

export function CoreAgentKitApproval(props: ApprovalSlotProps) {
  const { value: request, runId } = props;
  const toolName = safeToolName(request);
  const simpleToolApproval =
    (request.kind === undefined || request.kind === "approval") &&
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
