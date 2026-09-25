import {
  IconAlertTriangle,
  IconChevronRight,
  IconDots,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useLayoutEffect, useRef, type RefObject, type ReactNode } from "react";

import { desktopRecoveryCopy as copy } from "../i18n/en-US";
import {
  classifyRecordingRecoveryError,
  recordingRecoveryKey,
  recordingRecoverySeverity,
  type PendingDesktopUpload,
  type RecoveryLookupError,
} from "../lib/recording-recovery";
import { BackToApp } from "./BackToApp";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Empty, EmptyHeader, EmptyTitle } from "./ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "./ui/item";
import { Spinner } from "./ui/spinner";

export interface RecordingRecoveryState {
  uploads: PendingDesktopUpload[];
  lookupErrors: RecoveryLookupError[];
  actionErrors: Record<string, string>;
  refreshing: boolean;
  retryingUploadId: string | null;
  retryingUploadStatus: string | null;
  exportingUploadId: string | null;
  authenticated: boolean;
  finalizing: boolean;
  finalizingRecordingId?: string | null;
  showFinalizing?: boolean;
}

export interface RecordingRecoveryProps extends RecordingRecoveryState {
  needsStorage: (message?: string | null) => boolean;
  onRefresh: () => void;
  onRetry: (upload: PendingDesktopUpload) => void;
  onCancelRetry: (upload: PendingDesktopUpload) => void;
  onExport: (upload: PendingDesktopUpload) => void;
  onOpenFolder: (upload: PendingDesktopUpload) => void;
  onConnectStorage: (upload: PendingDesktopUpload) => void;
  onReviewFiles: (key: string) => void;
  onOpenLogs: (key: string) => void;
}

function uploadSeverity(
  upload: PendingDesktopUpload,
  props: RecordingRecoveryState,
) {
  const key = recordingRecoveryKey(upload);
  return recordingRecoverySeverity(
    [
      upload.lastError,
      props.actionErrors[key],
      props.actionErrors["failure:" + upload.recordingId],
    ],
    {
      incomplete: upload.kind === "native" && upload.corrupt,
      inProgress:
        props.retryingUploadId === key || props.exportingUploadId === key,
    },
  );
}

function lookupDiagnostic(errors: RecoveryLookupError[]) {
  return errors
    .map(({ cause }) =>
      cause instanceof Error ? cause.message : String(cause),
    )
    .join("\n\n");
}

function recoveryPresentation(props: RecordingRecoveryState) {
  const uploads = props.uploads.filter(
    (upload) =>
      !props.finalizing ||
      upload.recordingId !== props.finalizingRecordingId ||
      !!upload.lastError ||
      !!props.actionErrors["failure:" + upload.recordingId],
  );
  const orphanErrors = new Map<
    string,
    { key: string; message: string; messages: string[] }
  >();
  for (const [key, message] of Object.entries(props.actionErrors)) {
    const id = key.replace(/^(failure|native|browser):/, "");
    if (!uploads.some((upload) => upload.recordingId === id))
      orphanErrors.set(id, {
        key,
        message,
        messages: [...(orphanErrors.get(id)?.messages || []), message],
      });
  }
  const attentionCount = uploads.filter(
    (upload) => uploadSeverity(upload, props) !== "neutral",
  ).length;
  const unknownFailures =
    props.lookupErrors.length > 0 || orphanErrors.size > 0;
  const severities = [
    ...uploads.map((upload) => uploadSeverity(upload, props)),
    ...[...orphanErrors.values()].map((error) =>
      recordingRecoverySeverity(error.messages),
    ),
    ...(props.lookupErrors.length
      ? [recordingRecoverySeverity([lookupDiagnostic(props.lookupErrors)])]
      : []),
  ];
  const severity = severities.includes("error")
    ? "error"
    : severities.includes("warning")
      ? "warning"
      : "neutral";
  return {
    uploads,
    orphanErrors: [...orphanErrors.values()],
    attentionCount,
    unknownFailures,
    severity,
  };
}

export function RecordingRecovery(
  props: RecordingRecoveryState & {
    onOpen: () => void;
    triggerRef?: RefObject<HTMLButtonElement | null>;
  },
) {
  const { uploads, attentionCount, unknownFailures, severity } =
    recoveryPresentation(props);
  const showFinalizing = props.finalizing && props.showFinalizing !== false;
  if (uploads.length === 0 && !unknownFailures && !showFinalizing) return null;
  const label = unknownFailures
    ? copy.recordingsNeedAttention
    : attentionCount === 1
      ? copy.attentionOne
      : attentionCount > 1
        ? copy.attentionMany.replace("{count}", String(attentionCount))
        : showFinalizing
          ? copy.finishing
          : props.exportingUploadId
            ? copy.exporting
            : copy.retrying;
  return (
    <div data-tw-surface className="recording-recovery-entry">
      <Button
        ref={props.triggerRef}
        variant="ghost"
        size="recovery-row"
        onClick={props.onOpen}
      >
        <span className="row-icon" data-recovery-tone={severity}>
          {severity !== "neutral" ? (
            <IconAlertTriangle stroke={1.75} aria-hidden />
          ) : (
            <Spinner />
          )}
        </span>
        <span className="flex-1 text-start">{label}</span>
        <IconChevronRight aria-hidden />
      </Button>
    </div>
  );
}

function RecoveryAction({
  label,
  children,
  onClick,
  disabled = false,
  busy = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="recovery-icon"
          aria-label={label}
          aria-busy={busy || undefined}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RecoveryDescription({
  text,
  diagnostic,
}: {
  text: string;
  diagnostic?: string | null;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ItemDescription role="status" tabIndex={0}>
          {text}
        </ItemDescription>
      </TooltipTrigger>
      <TooltipContent className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
        {diagnostic || text}
      </TooltipContent>
    </Tooltip>
  );
}

function RecoveryMore({
  onOpenLogs,
  onConnectStorage,
  localAction,
}: {
  onOpenLogs: () => void;
  onConnectStorage?: () => void;
  localAction?: { label: string; onSelect: () => void; disabled?: boolean };
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="recovery-icon"
          aria-label={copy.moreOptions}
          title={copy.moreOptions}
        >
          <IconDots aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12}>
        <DropdownMenuGroup>
          {localAction ? (
            <DropdownMenuItem
              disabled={localAction.disabled}
              onSelect={localAction.onSelect}
            >
              {localAction.label}
            </DropdownMenuItem>
          ) : null}
          {onConnectStorage ? (
            <DropdownMenuItem onSelect={onConnectStorage}>
              {copy.connectStorage}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onOpenLogs}>
            {copy.openLogs}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RecordingRecoveryPage(
  props: RecordingRecoveryProps & { onBack: () => void },
) {
  const backRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    backRef.current?.focus();
  }, []);
  const { uploads, orphanErrors } = recoveryPresentation(props);
  const busy = !!props.retryingUploadId || !!props.exportingUploadId;
  return (
    <section
      data-tw-surface
      className="recording-recovery-page"
      aria-label={copy.title}
    >
      <header className="recording-recovery-header">
        <BackToApp ref={backRef} onClick={props.onBack} />
      </header>
      <ItemGroup className="max-h-96 overflow-y-auto">
        {props.finalizing ? (
          <Item size="recovery" role="listitem">
            <ItemMedia data-recovery-tone="neutral">
              <Spinner />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{copy.finishing}</ItemTitle>
            </ItemContent>
          </Item>
        ) : null}
        {props.lookupErrors.length > 0 ? (
          <Item size="recovery" role="listitem">
            <ItemMedia
              data-recovery-tone={recordingRecoverySeverity([
                lookupDiagnostic(props.lookupErrors),
              ])}
            >
              <IconAlertTriangle size={20} stroke={1.75} aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{copy.localFiles}</ItemTitle>
              <RecoveryDescription
                text={copy.lookupFailed}
                diagnostic={lookupDiagnostic(props.lookupErrors)}
              />
            </ItemContent>
            <ItemActions>
              <RecoveryAction
                label={copy.refresh}
                disabled={props.refreshing}
                busy={props.refreshing}
                onClick={props.onRefresh}
              >
                {props.refreshing ? <Spinner /> : <IconRefresh aria-hidden />}
              </RecoveryAction>
              <RecoveryMore onOpenLogs={() => props.onOpenLogs("lookup")} />
            </ItemActions>
          </Item>
        ) : null}
        {uploads.map((upload) => {
          const key = recordingRecoveryKey(upload);
          const retrying = props.retryingUploadId === key;
          const exporting = props.exportingUploadId === key;
          const corrupt = upload.kind === "native" && !!upload.corrupt;
          const actionError = props.actionErrors[key];
          const error =
            actionError ||
            props.actionErrors["failure:" + upload.recordingId] ||
            (retrying ? null : upload.lastError);
          const storageRequired = props.needsStorage(error);
          const date = new Date(upload.savedAt);
          const dateValid = !Number.isNaN(date.getTime());
          const dateLabel = dateValid
            ? date.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : copy.unknownRecording;
          const fullLabel = dateValid
            ? date.toLocaleString()
            : upload.recordingId;
          const failureKind = classifyRecordingRecoveryError(error || "", {
            storageRequired,
            incomplete: corrupt,
            actionError: !!actionError,
          });
          const severity = uploadSeverity(upload, props);
          const status = retrying
            ? props.retryingUploadStatus || copy.retrying
            : exporting
              ? copy.exporting
              : corrupt
                ? copy.recordingIncomplete
                : !props.authenticated
                  ? copy.signInToRetry
                  : error
                    ? copy[failureKind]
                    : copy.uploadPending;
          return (
            <Item
              key={key}
              size="recovery"
              role="listitem"
              aria-label={fullLabel}
            >
              <ItemMedia data-recovery-tone={severity}>
                {retrying || exporting ? (
                  <Spinner />
                ) : (
                  <IconAlertTriangle size={16} stroke={1.75} aria-hidden />
                )}
              </ItemMedia>
              <ItemContent>
                <ItemTitle title={fullLabel}>{dateLabel}</ItemTitle>
                <RecoveryDescription text={status} diagnostic={error} />
              </ItemContent>
              <ItemActions>
                {!corrupt ? (
                  <RecoveryAction
                    label={retrying ? copy.cancelRetry : copy.retry}
                    disabled={
                      retrying
                        ? props.retryingUploadStatus === copy.cancelling
                        : busy || !props.authenticated || props.finalizing
                    }
                    onClick={() =>
                      retrying
                        ? props.onCancelRetry(upload)
                        : props.onRetry(upload)
                    }
                  >
                    {retrying ? (
                      <IconX aria-hidden />
                    ) : (
                      <IconRefresh aria-hidden />
                    )}
                  </RecoveryAction>
                ) : null}
                <RecoveryMore
                  localAction={
                    upload.kind === "native" && upload.folderPath
                      ? {
                          label: copy.openFolder,
                          onSelect: () => props.onOpenFolder(upload),
                        }
                      : upload.kind === "browser"
                        ? {
                            label: exporting ? copy.exporting : copy.export,
                            disabled: busy,
                            onSelect: () => props.onExport(upload),
                          }
                        : {
                            label: copy.reviewFiles,
                            onSelect: () => props.onReviewFiles(key),
                          }
                  }
                  onOpenLogs={() => props.onOpenLogs(key)}
                  onConnectStorage={
                    storageRequired && props.authenticated && !corrupt
                      ? () => props.onConnectStorage(upload)
                      : undefined
                  }
                />
              </ItemActions>
            </Item>
          );
        })}
        {orphanErrors.map(({ key, message, messages }) => {
          const failureKind = classifyRecordingRecoveryError(message, {
            actionError: !key.startsWith("failure:"),
          });
          return (
            <Item key={key} size="recovery" role="listitem">
              <ItemMedia
                data-recovery-tone={recordingRecoverySeverity(messages)}
              >
                <IconAlertTriangle size={16} stroke={1.75} aria-hidden />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{copy.unknownRecording}</ItemTitle>
                <RecoveryDescription
                  text={copy[failureKind]}
                  diagnostic={message}
                />
              </ItemContent>
              <ItemActions>
                <RecoveryMore
                  localAction={{
                    label: copy.reviewFiles,
                    onSelect: () => props.onReviewFiles(key),
                  }}
                  onOpenLogs={() => props.onOpenLogs(key)}
                />
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
      {!uploads.length &&
      !orphanErrors.length &&
      !props.lookupErrors.length &&
      !props.finalizing ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{copy.noIssues}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
    </section>
  );
}
