import { actionErrorMessage } from "@agent-native/core/client/hooks";
import type {
  ContentDatabaseSource,
  ContentGitHubSourceStatus,
} from "@shared/api";
import { GITHUB_SOURCE_TYPE, githubFolderLabel } from "@shared/github-source";
import {
  IconBrandGithub,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import {
  Fragment,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
import { cn } from "@/lib/utils";

import {
  githubProblemFromErrorCode,
  githubProblemText,
  githubRelativeTime,
  githubSkipReasonText,
  shortCommit,
} from "./github-source-text";
import { dbText } from "./text";

/** How often "2 minutes ago" moves on. */
const RELATIVE_TIME_TICK_MS = 30_000;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** A GitHub action error in the reader's language, when it names a GitHub problem. */
export function githubActionErrorText(error: unknown): string {
  const problem = githubProblemFromErrorCode(
    (error as { errorCode?: unknown } | null)?.errorCode,
  );
  if (problem) return githubProblemText(problem);
  return (
    actionErrorMessage(error) ??
    (error instanceof Error
      ? error.message
      : dbText("githubProblemUnavailable"))
  );
}

function announceSync(result: SyncGitHubFolderResponse) {
  const { state, commitSha, problem } = result.sync;
  if (state === "error") {
    toast.error(
      problem
        ? githubProblemText(problem.code)
        : dbText("githubProblemUnavailable"),
    );
  } else if (state === "busy") {
    toast(dbText("githubSyncBusy"));
  } else if (state === "unchanged") {
    toast.success(dbText("githubAlreadyUpToDate"));
  } else if (state === "partial") {
    const progress = result.source?.metadata.github?.progress;
    toast.success(
      progress && commitSha
        ? dbText("githubSyncingProgress", {
            commit: shortCommit(commitSha),
            done: progress.done,
            total: progress.total,
          })
        : result.summary,
    );
  } else if (commitSha) {
    toast.success(
      dbText("githubSyncedToast", { commit: shortCommit(commitSha) }),
    );
  }
}

/**
 * "2 files skipped", which opens the list of files and why each was skipped.
 * The link keeps up to 50 of them, so the count can be longer than the list.
 */
function SkippedFiles({
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
            ? dbText("githubSkippedFilesOne")
            : dbText("githubSkippedFiles", { count })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="grid min-w-0 gap-2 text-xs">
          <div className="font-medium">{dbText("githubLinkSkipped")}</div>
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
                {dbText("githubSkippedFiles", { count })}
              </li>
            ) : null}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The line above a collection that follows a GitHub folder: which folder and
 * branch, that its pages are view only, the commit they match and when it
 * synced, and anything keeping it from staying current.
 */
export function GitHubSourceStatusLine({
  source,
}: {
  source: ContentDatabaseSource | null;
}) {
  const sync = useSyncGitHubFolder();
  const now = useNow(RELATIVE_TIME_TICK_MS);
  const status =
    source?.sourceType === GITHUB_SOURCE_TYPE
      ? source.metadata.github
      : undefined;
  if (!source || !status) return null;

  const problem = status.problem;
  const syncing = !!status.pendingCommitSha && !!status.progress;
  const details: ReactNode[] = [
    dbText("githubViewOnly"),
    status.syncedCommitSha && status.syncedAt
      ? dbText("githubSyncedTo", {
          commit: shortCommit(status.syncedCommitSha),
          time: githubRelativeTime(status.syncedAt, now),
        })
      : dbText("githubNotSyncedYet"),
    status.skippedCount > 0 ? (
      <SkippedFiles
        key="skipped"
        files={status.skipped}
        count={status.skippedCount}
      />
    ) : null,
    status.imagesWaiting > 0 && problem?.code !== "storage_unavailable"
      ? dbText("githubImagesWaiting")
      : null,
  ].filter((detail) => !!detail);

  return (
    <div
      className={cn(
        "mx-6 mb-3 grid gap-2 rounded-lg border p-3 text-xs",
        problem
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-muted/35",
      )}
      data-github-source-status
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <IconBrandGithub className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="break-words font-medium text-foreground">
              {dbText("githubFollows", {
                folder: githubFolderLabel(status),
                branch: status.branch,
              })}
            </div>
            <div className="mt-0.5 break-words text-muted-foreground">
              {details.map((detail, index) => (
                <Fragment key={index}>
                  {index > 0 ? " · " : null}
                  {detail}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button asChild size="xs" variant="ghost">
            <a href={status.folderUrl} target="_blank" rel="noreferrer">
              <IconExternalLink aria-hidden />
              {dbText("githubOpenFolder")}
            </a>
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={sync.isPending}
            onClick={() =>
              sync.mutate(
                { databaseId: source.databaseId },
                {
                  onSuccess: announceSync,
                  onError: (error) => toast.error(githubActionErrorText(error)),
                },
              )
            }
          >
            {sync.isPending ? <Spinner /> : <IconRefresh aria-hidden />}
            {dbText("githubSyncNow")}
          </Button>
        </div>
      </div>
      {problem ? (
        // Only the problem is announced: the rest of the line holds controls
        // and a time that moves on every half minute.
        <div
          className="break-words text-destructive"
          role="alert"
          data-github-source-problem
        >
          {githubProblemText(problem.code)}
        </div>
      ) : null}
      {syncing && status.progress ? (
        <div className="grid gap-1">
          <div className="text-muted-foreground">
            {dbText("githubSyncingProgress", {
              commit: shortCommit(status.pendingCommitSha!),
              done: status.progress.done,
              total: status.progress.total,
            })}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-background">
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
    </div>
  );
}
