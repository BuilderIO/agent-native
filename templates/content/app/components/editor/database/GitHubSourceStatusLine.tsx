import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import type {
  ContentDatabaseSource,
  ContentGitHubSourceStatus,
} from "@shared/api";
import {
  GITHUB_SOURCE_TYPE,
  githubFolderLabel,
  githubFolderName,
  type GitHubSourceProblemCode,
} from "@shared/github-source";
import {
  IconBrandGithub,
  IconChevronDown,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  useSyncGitHubFolder,
  type SyncGitHubFolderResponse,
} from "@/hooks/use-github-folder";
import { openGitHubLinkDialog } from "@/lib/github-link-dialog";

import {
  githubProblemFromErrorCode,
  githubProblemStopsUpdates,
  githubProblemText,
  githubRelativeTime,
  githubSkipReasonText,
  shortCommit,
} from "./github-source-text";
import { GitHubUnlinkDialog } from "./GitHubUnlinkDialog";
import { dbText } from "./text";

/** How often "2 minutes ago" moves on. */
const RELATIVE_TIME_TICK_MS = 30_000;

/** Stands in for a name while a sentence is split around it. */
const NAME_MARK = "\u0000";

export function useNow(intervalMs = RELATIVE_TIME_TICK_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "From the **docs** folder on GitHub", with the name in bold in any language. */
function FromFolder({ status }: { status: ContentGitHubSourceStatus }) {
  const name = githubFolderName(status);
  const sentence = status.path
    ? dbText("githubFromFolder", { folder: NAME_MARK })
    : dbText("githubFromRepo", { repo: NAME_MARK });
  const [before, after = ""] = sentence.split(NAME_MARK);
  return (
    <span className="min-w-0 break-words text-foreground">
      {before}
      <strong className="font-medium">{name}</strong>
      {after}
    </span>
  );
}

/** "Updated 2 minutes ago", or "Not updated yet" before the first update. */
export function githubUpdatedText(
  status: ContentGitHubSourceStatus,
  now: number,
): string {
  return status.syncedAt
    ? dbText("githubUpdatedAgo", {
        time: githubRelativeTime(status.syncedAt, now),
      })
    : dbText("githubNotUpdatedYet");
}

function announceSync(
  result: SyncGitHubFolderResponse,
  status: ContentGitHubSourceStatus,
) {
  const { state, problem, created, updated, renamed, trashed } = result.sync;
  if (state === "error") {
    toast.error(githubProblemText(problem?.code ?? "unavailable", status));
  } else if (state === "busy") {
    toast(dbText("githubSyncBusy"));
  } else if (state === "unchanged") {
    toast.success(dbText("githubAlreadyUpToDate"));
  } else if (state === "partial") {
    const progress = result.source?.metadata.github?.progress;
    toast.success(
      dbText("githubSyncPartialToast", {
        done: progress?.done ?? created + updated,
        total: progress?.total ?? created + updated + result.sync.remaining,
      }),
    );
  } else {
    const changed = created + updated + renamed + trashed;
    toast.success(
      changed === 1
        ? dbText("githubSyncedToastOne")
        : dbText("githubSyncedToast", { count: changed }),
    );
  }
}

/** "Check for updates", which asks GitHub now instead of waiting. */
export function useCheckGitHubForUpdates(source: ContentDatabaseSource) {
  const sync = useSyncGitHubFolder();
  const status = source.metadata.github;
  return {
    pending: sync.isPending,
    run: () =>
      sync.mutate(
        { databaseId: source.databaseId },
        {
          onSuccess: (result) => status && announceSync(result, status),
          onError: (error) => {
            const problem = githubProblemFromErrorCode(
              (error as { errorCode?: unknown } | null)?.errorCode,
            );
            toast.error(
              problem
                ? githubProblemText(problem, status)
                : (actionErrorMessage(error) ??
                    dbText("githubLinkUnavailable")),
            );
          },
        },
      ),
  };
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** Where the folder is and how current it is, as Details and the Sources panel show it. */
export function GitHubFolderFacts({
  status,
  now,
}: {
  status: ContentGitHubSourceStatus;
  now: number;
}) {
  return (
    <dl className="grid min-w-0 gap-1.5 text-xs">
      <DetailRow label={dbText("githubDetailFolder")}>
        <a
          href={status.folderUrl}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          {githubFolderLabel(status)}
        </a>
      </DetailRow>
      <DetailRow label={dbText("githubDetailBranch")}>
        {status.branch}
      </DetailRow>
      {status.syncedCommitSha ? (
        <DetailRow label={dbText("githubDetailVersion")}>
          {shortCommit(status.syncedCommitSha)}
        </DetailRow>
      ) : null}
      <DetailRow label={dbText("githubDetailUpdated")}>
        {status.syncedAt
          ? githubRelativeTime(status.syncedAt, now)
          : dbText("githubNotUpdatedYet")}
      </DetailRow>
    </dl>
  );
}

/** "1 file not shown", which opens the list of files and why. */
function NotShownFiles({
  files,
  count,
}: {
  files: ContentGitHubSourceStatus["skipped"];
  count: number;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-sm underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {count === 1
            ? dbText("githubNotShownOne")
            : dbText("githubNotShown", { count })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="grid min-w-0 gap-2 text-xs">
          <div className="font-medium">{dbText("githubNotShownHeading")}</div>
          <ul className="grid max-h-60 min-w-0 gap-1 overflow-y-auto">
            {files.map((file) => (
              <li key={file.path} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate" title={file.path}>
                  {file.path}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {githubSkipReasonText(file.reason)}
                </span>
              </li>
            ))}
            {count > files.length ? (
              <li className="text-muted-foreground">
                {dbText("githubLinkMore", { count: count - files.length })}
              </li>
            ) : null}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** What each stopping problem offers, besides waiting. */
function problemActions(code: GitHubSourceProblemCode): {
  reconnect: boolean;
  open: boolean;
  unlink: boolean;
} {
  return {
    reconnect: code === "connection",
    open:
      code === "forbidden" ||
      code === "repository_not_found" ||
      code === "folder_not_found",
    unlink:
      code === "repository_not_found" ||
      code === "branch_not_found" ||
      code === "folder_not_found" ||
      code === "too_large",
  };
}

function reconnectGitHub() {
  startWorkspaceProviderOAuth("github", {
    appId: "content",
    returnPath: `${window.location.pathname}${window.location.search}`,
    scope: "user",
  });
}

/**
 * The line above a collection that comes from a GitHub folder: which folder,
 * when it last updated, where to edit it, and Details. A problem that stops
 * updates gets its own red line with the one thing to do about it.
 */
export function GitHubSourceStatusLine({
  source,
  documentId,
  canEdit,
  pageCount,
}: {
  source: ContentDatabaseSource | null;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
}) {
  const now = useNow();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status =
    source?.sourceType === GITHUB_SOURCE_TYPE
      ? source.metadata.github
      : undefined;
  if (!source || !status) return null;
  return (
    <GitHubStatusLineContent
      source={source}
      status={status}
      now={now}
      documentId={documentId}
      canEdit={canEdit}
      pageCount={pageCount}
      detailsOpen={detailsOpen}
      onDetailsOpenChange={setDetailsOpen}
      unlinkOpen={unlinkOpen}
      onUnlinkOpenChange={setUnlinkOpen}
    />
  );
}

function GitHubStatusLineContent({
  source,
  status,
  now,
  documentId,
  canEdit,
  pageCount,
  detailsOpen,
  onDetailsOpenChange,
  unlinkOpen,
  onUnlinkOpenChange,
}: {
  source: ContentDatabaseSource;
  status: ContentGitHubSourceStatus;
  now: number;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  unlinkOpen: boolean;
  onUnlinkOpenChange: (open: boolean) => void;
}) {
  const check = useCheckGitHubForUpdates(source);
  const problem = status.problem;
  const stops = problem ? githubProblemStopsUpdates(problem.code) : false;
  const actions = problem && stops ? problemActions(problem.code) : null;
  const syncing = !!status.pendingCommitSha && !!status.progress;
  // Pictures waiting on storage are a note, not a stop: the pages still update.
  const picturesWaiting =
    problem?.code === "storage_unavailable" || status.imagesWaiting > 0;
  const paused = !!problem && !stops && problem.code !== "storage_unavailable";
  const openUnlink = () => {
    onDetailsOpenChange(false);
    onUnlinkOpenChange(true);
  };

  return (
    <div className="mb-2 grid min-w-0 gap-1 text-xs" data-github-source-status>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
        <IconBrandGithub className="size-3.5 shrink-0" aria-hidden />
        <FromFolder status={status} />
        {stops ? null : (
          <>
            <span aria-hidden>·</span>
            <span>{githubUpdatedText(status, now)}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <a
          href={status.folderUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {dbText("githubEditOnGitHub")}
          <IconExternalLink className="size-3" aria-hidden />
        </a>
        {status.skippedCount > 0 ? (
          <>
            <span aria-hidden>·</span>
            <NotShownFiles files={status.skipped} count={status.skippedCount} />
          </>
        ) : null}
        <Popover open={detailsOpen} onOpenChange={onDetailsOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ms-1 inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {dbText("githubDetails")}
              <IconChevronDown className="size-3" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="grid min-w-0 gap-3">
              <GitHubFolderFacts status={status} now={now} />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={check.pending}
                  onClick={check.run}
                >
                  {check.pending ? <Spinner /> : <IconRefresh aria-hidden />}
                  {dbText("githubCheckForUpdates")}
                </Button>
                {canEdit ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline-destructive"
                    onClick={openUnlink}
                  >
                    {dbText("githubUnlinkFolder")}
                  </Button>
                ) : null}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {problem && stops ? (
        // Only the problem is announced: the line above holds controls and a
        // time that moves on every half minute.
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-destructive"
          role="alert"
          data-github-source-problem
        >
          <span className="min-w-0 break-words">
            {githubProblemText(problem.code, status)}{" "}
            {status.syncedAt
              ? dbText("githubShowingAsOf", {
                  time: githubRelativeTime(status.syncedAt, now),
                })
              : null}
          </span>
          {actions?.reconnect && canEdit ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={reconnectGitHub}
            >
              <IconBrandGithub aria-hidden />
              {dbText("githubReconnect")}
            </Button>
          ) : null}
          {actions?.open ? (
            <Button asChild size="xs" variant="outline">
              <a href={status.folderUrl} target="_blank" rel="noreferrer">
                {dbText("githubOpenFolder")}
                <IconExternalLink aria-hidden />
              </a>
            </Button>
          ) : null}
          {actions?.unlink && canEdit ? (
            <Button
              type="button"
              size="xs"
              variant="outline-destructive"
              onClick={openUnlink}
            >
              {dbText("githubUnlinkFolder")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {paused && problem ? (
        <div className="break-words text-muted-foreground">
          {githubProblemText(problem.code, status)}
        </div>
      ) : null}

      {picturesWaiting ? (
        <div className="break-words text-muted-foreground">
          {dbText("githubPicturesWaiting")}
        </div>
      ) : null}

      {syncing && status.progress ? (
        <div className="grid max-w-sm gap-1">
          <div className="text-muted-foreground">
            {dbText("githubSyncingProgress", {
              done: status.progress.done,
              total: status.progress.total,
            })}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full w-(--github-sync-progress) rounded-full bg-foreground/70 transition-all"
              style={
                {
                  "--github-sync-progress": `${Math.round(
                    (status.progress.done /
                      Math.max(status.progress.total, 1)) *
                      100,
                  )}%`,
                } as CSSProperties
              }
            />
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <GitHubUnlinkDialog
          open={unlinkOpen}
          onOpenChange={onUnlinkOpenChange}
          documentId={documentId}
          sourceId={source.id}
          pageCount={pageCount}
        />
      ) : null}
    </div>
  );
}

/**
 * Under an empty collection's toolbar, for editors: one muted line that opens
 * the GitHub folder dialog, so the option is found where a collection starts.
 */
export function GitHubEmptyCollectionHint({
  databaseId,
  documentId,
  spaceId,
  parentId,
}: {
  databaseId: string;
  documentId: string;
  spaceId?: string;
  parentId?: string | null;
}) {
  return (
    <div className="mb-2 text-xs" data-github-empty-hint>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={(event) =>
          openGitHubLinkDialog({
            target: {
              kind: "collection",
              databaseId,
              documentId,
              spaceId,
              parentId,
            },
            returnFocusTo: event.currentTarget,
          })
        }
      >
        <IconBrandGithub className="size-3.5" aria-hidden />
        {dbText("githubEmptyHint")}
      </button>
    </div>
  );
}
