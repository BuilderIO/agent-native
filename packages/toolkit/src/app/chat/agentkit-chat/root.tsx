import { describeModelForEngine } from "@agent-native/core/agent/model-catalog";
import {
  getAgentNativeAgentKitUploadDriver,
  clearAgentNativeAgentKitUploads,
} from "@agent-native/core/client/agentkit-chat/transport";
import { callAction } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { readFileUploadStatus } from "@agent-native/core/client/uploads";
import { useSession } from "@agent-native/core/client/use-session";
import { useMemo, useEffect } from "react";

import { CoreFileStorageSetupContext } from "../../agentkit/react/core-file-storage.js";
import { AgentKitRoot } from "../../agentkit/react/root.js";
import type { AgentKitRootProps } from "../../agentkit/react/root.js";
import { FileStorageSetupPopover } from "../FileStorageSetupPopover.js";
import { AgentKitActionWidget } from "./action-widget.js";
import { CoreAgentKitApproval } from "./approval-card.js";
import { agentKitChatLabels } from "./labels.js";

// Every agent-native app serves this framework action, so run details can
// show credits and the model that ran without each host wiring a loader.
const loadCoreRunUsage: NonNullable<
  AgentKitRootProps["loadRunUsage"]
> = async ({ runId, signal }) => {
  const run = await callAction<undefined, "get-usage-run">(
    "get-usage-run",
    { runId, scope: "me" },
    { method: "GET", signal },
  );
  if (!run) return null;
  // The usage store reports "unknown" when no call recorded a model.
  return { ...run, model: run.model === "unknown" ? null : run.model };
};

/** The catalog's short name, or the id itself for a model it does not know. */
function coreModelDisplayName(model: string): string {
  return describeModelForEngine(model).shortName ?? model;
}

export function CoreAgentKitRoot(props: AgentKitRootProps) {
  const t = useT();
  const { formatDate } = useFormatters();
  const nativeUpload = props.transport
    ? getAgentNativeAgentKitUploadDriver(props.transport)
    : undefined;
  const { session } = useSession();
  const scopeKey = JSON.stringify([
    session?.email ?? null,
    session?.orgId ?? null,
    session?.authUserId ?? null,
  ]);
  const storageScope = useMemo(
    () =>
      nativeUpload
        ? {
            scopeKey,
            readStatus: readFileUploadStatus,
            Setup: FileStorageSetupPopover,
          }
        : null,
    [nativeUpload, scopeKey],
  );
  useEffect(
    () => () => {
      if (props.transport) clearAgentNativeAgentKitUploads(props.transport);
    },
    [props.transport, scopeKey],
  );
  const upload = useMemo(
    () =>
      nativeUpload
        ? async (...args: Parameters<typeof nativeUpload>) => {
            try {
              await nativeUpload(...args);
            } catch (cause) {
              const code =
                cause && typeof cause === "object" && "code" in cause
                  ? cause.code
                  : undefined;
              const key =
                code === "upload_too_large"
                  ? "agentChat.composer.fileTooLarge"
                  : code === "upload_session_expired"
                    ? "agentChat.composer.sessionExpired"
                    : code === "upload_unsupported_type"
                      ? "agentChat.composer.unsupportedFileType"
                      : code === "upload_network_error"
                        ? "agentChat.composer.uploadOffline"
                        : code === "upload_unavailable"
                          ? "agentChat.composer.uploadUnavailable"
                          : "agentChat.composer.uploadFailed";
              throw Object.assign(new Error(t(key, { size: 25 }), { cause }), {
                code,
                ...(cause && typeof cause === "object" && "status" in cause
                  ? { status: cause.status }
                  : {}),
                ...(cause && typeof cause === "object" && "retryable" in cause
                  ? { retryable: cause.retryable }
                  : {}),
              });
            }
          }
        : undefined,
    [nativeUpload, t],
  );
  const clientOptions = useMemo(
    () => ({
      ...props.clientOptions,
      ...(!props.clientOptions?.upload && upload ? { upload } : {}),
    }),
    [props.clientOptions, upload],
  );
  const slots = useMemo(
    () => ({
      ...props.slots,
      widget: props.slots?.widget ?? AgentKitActionWidget,
      approval: props.slots?.approval ?? CoreAgentKitApproval,
    }),
    [props.slots],
  );
  const labels = useMemo(
    () => ({
      ...agentKitChatLabels(t, formatDate),
      threadLoadFailed: t("agentChat.message.threadLoadFailed"),
      threadLoadRetry: t("agentChat.common.retry"),
      composerPlaceholder: t("agentChat.composer.newChatPlaceholder"),
      ...props.labels,
    }),
    [formatDate, props.labels, t],
  );
  const rootProps: AgentKitRootProps = props.controller
    ? props
    : { ...props, clientOptions };
  return (
    <CoreFileStorageSetupContext.Provider value={storageScope}>
      <AgentKitRoot
        {...rootProps}
        slots={slots}
        labels={labels}
        loadRunUsage={props.loadRunUsage ?? loadCoreRunUsage}
        formatModelName={props.formatModelName ?? coreModelDisplayName}
      />
    </CoreFileStorageSetupContext.Provider>
  );
}
