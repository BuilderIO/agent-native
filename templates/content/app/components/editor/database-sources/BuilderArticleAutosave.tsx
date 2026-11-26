import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  BuilderArticleAutosaveReason,
  BuilderArticleAutosaveStatus,
  BuilderArticleRowStatus,
} from "@shared/api";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconCloud,
  IconCloudOff,
  IconExternalLink,
  IconInfoCircle,
} from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { toast } from "sonner";

import { AutoSyncToggle } from "@/components/editor/AutoSyncToggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  builderArticleAutosaveRows,
  builderArticleRowIdentity,
  builderArticleRowTarget,
  useBuilderArticleAutosaveRunner,
  useBuilderArticleAutosaves,
  useBuilderAutosaveRunError,
  useBuilderAutosaveRunning,
  useRunBuilderArticleAutosave,
  useSetBuilderArticleAutosave,
} from "@/hooks/use-builder-article-autosave";
import { cn } from "@/lib/utils";

type T = ReturnType<typeof useT>;

const REASON_KEYS: Record<BuilderArticleAutosaveReason, string> = {
  builder_editor_changes: "builderAutosave.reasonBuilderEditorChanges",
  checking_last_save: "builderAutosave.reasonCheckingLastSave",
  another_save_running: "builderAutosave.reasonAnotherSaveRunning",
  builder_body_unread: "builderAutosave.reasonBuilderBodyUnread",
  builder_body_unreadable: "builderAutosave.reasonBuilderBodyUnreadable",
  published: "builderAutosave.reasonPublished",
  needs_review: "builderAutosave.reasonNeedsReview",
  edit_conflict: "builderAutosave.reasonEditConflict",
  builder_changed: "builderAutosave.reasonBuilderChanged",
  save_failed: "builderAutosave.reasonSaveFailed",
  unconfirmed_save: "builderAutosave.reasonUnconfirmedSave",
};

export interface BuilderAutosaveView {
  tone: "muted" | "ok" | "waiting" | "error";
  icon: ReactNode;
  label: string;
  detail: string | null;
  canRetry: boolean;
}

export function builderAutosaveView(
  status: BuilderArticleAutosaveStatus,
  running: boolean,
  t: T,
  runError: string | null = null,
): BuilderAutosaveView {
  const reason = status.reason ? t(REASON_KEYS[status.reason]) : null;
  if (status.state === "review") {
    return {
      tone: "muted",
      icon: <IconInfoCircle className="size-3.5" aria-hidden />,
      label: t("builderAutosave.stateReview"),
      detail: reason,
      canRetry: false,
    };
  }
  if (!status.enabled) {
    return {
      tone: "muted",
      icon: <IconCloudOff className="size-3.5" aria-hidden />,
      label: t("builderAutosave.stateOff"),
      detail: t("builderAutosave.switchHint"),
      canRetry: false,
    };
  }
  if (running || status.state === "saving") {
    return {
      tone: "muted",
      icon: <Spinner className="size-3.5" aria-hidden />,
      label: t("builderAutosave.stateSaving"),
      detail: null,
      canRetry: false,
    };
  }
  if (runError !== null) {
    return {
      tone: "error",
      icon: <IconAlertTriangle className="size-3.5" aria-hidden />,
      label: t("builderAutosave.stateFailed"),
      detail: [t("builderAutosave.reasonRunFailed"), runError]
        .filter(Boolean)
        .join(" "),
      canRetry: true,
    };
  }
  if (status.state === "failed") {
    const error =
      status.error && status.reason !== "builder_changed" ? status.error : null;
    return {
      tone: "error",
      icon: <IconAlertTriangle className="size-3.5" aria-hidden />,
      label: t("builderAutosave.stateFailed"),
      detail: [reason, error].filter(Boolean).join(" ") || null,
      canRetry: true,
    };
  }
  if (status.state === "waiting") {
    return {
      tone: "waiting",
      icon: <IconClock className="size-3.5" aria-hidden />,
      label: t("builderAutosave.stateWaiting"),
      detail: reason,
      canRetry: false,
    };
  }
  if (status.state === "saved") {
    return {
      tone: "ok",
      icon: <IconCheck className="size-3.5" aria-hidden />,
      label: t("builderAutosave.stateSaved"),
      detail: status.lastSavedAt
        ? t("builderAutosave.savedAt", {
            time: new Date(status.lastSavedAt).toLocaleString(),
          })
        : null,
      canRetry: false,
    };
  }
  return {
    tone: "muted",
    icon: <IconCloud className="size-3.5" aria-hidden />,
    label: t("builderAutosave.stateIdle"),
    detail: t("builderAutosave.switchHint"),
    canRetry: false,
  };
}

const TONE_CLASS: Record<BuilderAutosaveView["tone"], string> = {
  muted: "text-muted-foreground",
  ok: "text-emerald-600 dark:text-emerald-500",
  waiting: "text-amber-600 dark:text-amber-500",
  error: "text-destructive",
};

function OpenInBuilderLink({
  url,
  compact,
}: {
  url: string;
  compact?: boolean;
}) {
  const t = useT();
  const label = t("builderAutosave.openInBuilder");
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
          >
            <IconExternalLink className="size-3.5" aria-hidden />
          </a>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <IconExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function useRetry(row: BuilderArticleRowStatus) {
  const t = useT();
  const run = useRunBuilderArticleAutosave();
  return {
    pending: run.isPending,
    retry: () =>
      run.mutate(
        { ...builderArticleRowIdentity(row), retry: true },
        {
          onError: (error) =>
            toast.error(
              actionErrorMessage(error) ?? t("builderAutosave.retryFailed"),
            ),
        },
      ),
  };
}

export function BuilderArticleAutosaveRunner({
  collectionDocumentId,
  canEdit,
}: {
  collectionDocumentId: string;
  canEdit: boolean;
}) {
  const query = useBuilderArticleAutosaves({
    documentId: collectionDocumentId,
  });
  useBuilderArticleAutosaveRunner(canEdit ? query.data?.rows : undefined);
  return null;
}

export function BuilderArticleCellStatus({
  collectionDocumentId,
  documentId,
  canEdit,
}: {
  collectionDocumentId: string;
  documentId: string;
  canEdit: boolean;
}) {
  const query = useBuilderArticleAutosaves(
    { documentId: collectionDocumentId },
    { poll: false },
  );
  const row = builderArticleAutosaveRows(query.data).find(
    (candidate) => candidate.documentId === documentId,
  );
  if (!row) return null;
  return <BuilderArticleCellStatusView row={row} canEdit={canEdit} />;
}

export function BuilderArticleCellStatusView({
  row,
  canEdit,
}: {
  row: BuilderArticleRowStatus;
  canEdit: boolean;
}) {
  const t = useT();
  const running = useBuilderAutosaveRunning(row.documentId);
  const runError = useBuilderAutosaveRunError(row.documentId);
  const { retry, pending } = useRetry(row);
  const view = row.autosave
    ? builderAutosaveView(row.autosave, running || pending, t, runError)
    : null;
  if (!view && !row.builderUrl) return null;
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-0.5 pl-1"
      data-builder-autosave={row.autosave?.state ?? "none"}
    >
      {view ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {view.canRetry && canEdit && row.autosave?.canSave === true ? (
              <button
                type="button"
                aria-label={t("builderAutosave.retry")}
                className={cn(
                  "flex size-5 items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  TONE_CLASS[view.tone],
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  retry();
                }}
              >
                {view.icon}
              </button>
            ) : (
              <span
                role="img"
                tabIndex={0}
                aria-label={view.label}
                className={cn(
                  "flex size-5 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  TONE_CLASS[view.tone],
                )}
              >
                {view.icon}
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            <p className="font-medium">{view.label}</p>
            {view.detail ? <p>{view.detail}</p> : null}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {row.builderUrl ? (
        <OpenInBuilderLink url={row.builderUrl} compact />
      ) : null}
    </span>
  );
}

export function BuilderArticleAutosavePanel({
  documentId,
  databaseId,
  canEdit,
}: {
  documentId: string;
  databaseId?: string | null;
  canEdit: boolean;
}) {
  const query = useBuilderArticleAutosaves(
    builderArticleRowTarget(documentId, databaseId),
    { poll: false },
  );
  const row = builderArticleAutosaveRows(query.data).find(
    (candidate) => candidate.documentId === documentId,
  );
  if (!row) return null;
  return <BuilderArticleAutosavePanelView row={row} canEdit={canEdit} />;
}

export function BuilderArticleRowAutosaveRunner({
  documentId,
  databaseId,
  canEdit,
}: {
  documentId: string;
  databaseId?: string | null;
  canEdit: boolean;
}) {
  const query = useBuilderArticleAutosaves(
    builderArticleRowTarget(documentId, databaseId),
  );
  const row = builderArticleAutosaveRows(query.data).find(
    (candidate) => candidate.documentId === documentId,
  );
  const rows = useMemo(
    () => (canEdit && row ? [row] : undefined),
    [canEdit, row],
  );
  useBuilderArticleAutosaveRunner(rows);
  return null;
}

export function BuilderArticleAutosavePanelView({
  row,
  canEdit,
}: {
  row: BuilderArticleRowStatus;
  canEdit: boolean;
}) {
  const t = useT();
  const running = useBuilderAutosaveRunning(row.documentId);
  const runError = useBuilderAutosaveRunError(row.documentId);
  const { retry, pending } = useRetry(row);
  const setAutosave = useSetBuilderArticleAutosave();
  const status = row.autosave;
  const view = status
    ? builderAutosaveView(status, running || pending, t, runError)
    : null;
  if (!view && !row.builderUrl) return null;
  const switchLocked =
    status?.state === "review" && status.reason === "published";
  return (
    <div
      className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-1 pb-1 sm:grid-cols-[calc(160px-var(--property-name-inset,0px))_minmax(0,1fr)]"
      data-builder-autosave-panel={row.documentId}
    >
      <span aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        {view ? (
          <div
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            role="status"
          >
            <span
              className={cn(
                "inline-flex items-center gap-1",
                TONE_CLASS[view.tone],
              )}
            >
              {view.icon}
              {view.label}
            </span>
            {view.canRetry && canEdit && status?.canSave === true ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={retry}
              >
                {t("builderAutosave.retry")}
              </Button>
            ) : null}
            {row.builderUrl ? <OpenInBuilderLink url={row.builderUrl} /> : null}
          </div>
        ) : row.builderUrl ? (
          <OpenInBuilderLink url={row.builderUrl} />
        ) : null}
        {view?.detail ? (
          <p className="text-xs text-muted-foreground">{view.detail}</p>
        ) : null}
        {status && canEdit && !switchLocked ? (
          <AutoSyncToggle
            label={t("builderAutosave.switchLabel")}
            checked={status.enabled}
            disabled={setAutosave.isPending}
            title={t("builderAutosave.switchHint")}
            className="-ml-3 w-auto self-start"
            onCheckedChange={(enabled) =>
              setAutosave.mutate(
                { ...builderArticleRowIdentity(row), enabled },
                {
                  onError: (error) =>
                    toast.error(
                      actionErrorMessage(error) ??
                        t("builderAutosave.switchFailed"),
                    ),
                },
              )
            }
          />
        ) : null}
      </div>
    </div>
  );
}
