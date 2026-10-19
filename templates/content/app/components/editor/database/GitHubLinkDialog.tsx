import { useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import {
  parseGitHubFolderUrl,
  type GitHubFolderPreview,
  type GitHubLinkBlockedReason,
} from "@shared/github-source";
import { IconBrandGithub } from "@tabler/icons-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useLinkGitHubFolder } from "@/hooks/use-github-folder";

import {
  githubBlockedText,
  githubProblemFromErrorCode,
  githubProblemText,
  githubSkipReasonText,
  shortCommit,
} from "./github-source-text";
import { githubActionErrorText } from "./GitHubSourceStatusLine";
import { dbText } from "./text";

/** Files a list in the preview shows before it stops. */
const PREVIEW_LIST_LIMIT = 8;

interface LinkPreview {
  url: string;
  preview: GitHubFolderPreview;
  blockedReason: GitHubLinkBlockedReason | null;
}

function urlProblem(url: string): string | null {
  const parsed = parseGitHubFolderUrl(url);
  if (parsed.ok) return null;
  return parsed.reason === "file"
    ? dbText("githubLinkFileUrl")
    : dbText("githubLinkInvalidUrl");
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** What linking the folder would do, before anything changes. */
export function GitHubFolderPreviewView({
  preview,
  blockedReason,
}: {
  preview: GitHubFolderPreview;
  blockedReason: GitHubLinkBlockedReason | null;
}) {
  const t = useT();
  return (
    <div
      className="grid min-w-0 gap-4 rounded-lg border border-border bg-muted/20 p-3 text-sm"
      data-github-folder-preview
    >
      <div className="grid min-w-0 gap-0.5">
        <a
          href={preview.folderUrl}
          target="_blank"
          rel="noreferrer"
          className="break-words font-medium underline-offset-2 hover:underline"
        >
          {dbText("githubLinkFolderAt", {
            folder: preview.label,
            commit: shortCommit(preview.commitSha),
          })}
        </a>
        <div className="text-muted-foreground">
          {preview.markdownFiles === 0
            ? dbText("githubLinkNoFiles")
            : preview.markdownFiles === 1
              ? dbText("githubLinkFilesOne")
              : dbText("githubLinkFiles", { count: preview.markdownFiles })}
        </div>
      </div>

      {blockedReason ? (
        <div
          className="break-words rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
          role="alert"
        >
          {githubBlockedText(blockedReason)}
        </div>
      ) : null}

      {preview.markdownFiles > 0 ? (
        <PreviewSection title={dbText("githubLinkColumns")}>
          {preview.fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {dbText("githubLinkNoColumns")}
            </p>
          ) : (
            <ul className="grid min-w-0 gap-1 text-xs">
              {preview.fields.map((field) => (
                <li
                  key={field.key}
                  className="flex min-w-0 items-baseline gap-2"
                >
                  <span className="shrink-0 font-medium">{field.key}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {t(`editor.propertyTypes.${field.type}`)}
                  </span>
                  {field.examples.length > 0 ? (
                    <span className="min-w-0 truncate text-muted-foreground/80">
                      {[...new Set(field.examples)].slice(0, 3).join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PreviewSection>
      ) : null}

      {preview.sample.length > 0 ? (
        <PreviewSection title={dbText("githubLinkPages")}>
          <ul className="grid min-w-0 gap-1 text-xs">
            {preview.sample.slice(0, PREVIEW_LIST_LIMIT).map((page) => (
              <li key={page.path} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate font-medium">
                  {page.title}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {page.path}
                </span>
              </li>
            ))}
          </ul>
        </PreviewSection>
      ) : null}

      {preview.skipped.length > 0 ? (
        <PreviewSection title={dbText("githubLinkSkipped")}>
          <ul className="grid min-w-0 gap-1 text-xs">
            {preview.skipped.slice(0, PREVIEW_LIST_LIMIT).map((file) => (
              <li key={file.path} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate">{file.path}</span>
                <span className="shrink-0 text-muted-foreground">
                  {githubSkipReasonText(file.reason)}
                </span>
              </li>
            ))}
            {preview.skipped.length > PREVIEW_LIST_LIMIT ? (
              <li className="text-muted-foreground">
                {dbText("githubSkippedFiles", {
                  count: preview.skipped.length,
                })}
              </li>
            ) : null}
          </ul>
        </PreviewSection>
      ) : null}

      {preview.images > 0 && !preview.storageReady ? (
        <p className="text-xs text-muted-foreground">
          {dbText("githubLinkImagesWaiting")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Links an empty collection to a GitHub folder: paste the folder's link,
 * preview what it becomes, then link it.
 */
export function GitHubLinkDialog({
  databaseId,
  open,
  onOpenChange,
}: {
  databaseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const previewFolder = useLinkGitHubFolder();
  const linkFolder = useLinkGitHubFolder();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<LinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsConnection, setNeedsConnection] = useState(false);
  // Counts previews and edits, so a preview that answers after the link
  // changed is dropped rather than shown under the new link.
  const previewRun = useRef(0);
  const pending = previewFolder.isPending || linkFolder.isPending;

  function reset() {
    previewRun.current += 1;
    setResult(null);
    setError(null);
    setNeedsConnection(false);
  }

  function handleError(cause: unknown) {
    const code = (cause as { errorCode?: unknown } | null)?.errorCode;
    // A missing or ungranted connection comes from the shared provider
    // runtime as `connection_required`; a rejected one, from GitHub.
    if (
      code === "connection_required" ||
      githubProblemFromErrorCode(code) === "connection"
    ) {
      setNeedsConnection(true);
      setError(null);
      return;
    }
    setError(githubActionErrorText(cause));
  }

  function runPreview(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = url.trim();
    reset();
    const problem = urlProblem(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    const run = previewRun.current;
    previewFolder.mutate(
      { databaseId, url: trimmed, dryRun: true },
      {
        onSuccess: (response) => {
          if (!response.dryRun || run !== previewRun.current) return;
          setResult({
            url: trimmed,
            preview: response.preview,
            blockedReason: response.blockedReason,
          });
        },
        onError: (cause) => {
          if (run === previewRun.current) handleError(cause);
        },
      },
    );
  }

  function runLink() {
    if (!result) return;
    linkFolder.mutate(
      { databaseId, url: result.url },
      {
        onSuccess: (response) => {
          const folder = response.preview.label;
          const sync = response.dryRun ? null : response.sync;
          // The link is saved even when its first sync fails; say both, and
          // the status line keeps showing the problem after this closes.
          if (sync?.state === "error") {
            toast.error(dbText("githubLinkedSyncFailed", { folder }), {
              description: sync.problem
                ? githubProblemText(sync.problem.code)
                : dbText("githubProblemUnavailable"),
            });
          } else {
            toast.success(dbText("githubLinkedToast", { folder }));
          }
          onOpenChange(false);
          setUrl("");
          reset();
        },
        onError: handleError,
      },
    );
  }

  const canLink =
    !!result &&
    !result.blockedReason &&
    result.preview.markdownFiles > 0 &&
    result.url === url.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <IconBrandGithub className="size-4" aria-hidden />
              {dbText("githubLinkTitle")}
            </span>
          </DialogTitle>
          <DialogDescription>
            {dbText("githubLinkDescription")}
          </DialogDescription>
        </DialogHeader>

        <form className="grid min-w-0 gap-1.5" onSubmit={runPreview}>
          <label
            htmlFor="github-folder-url"
            className="text-xs font-medium text-muted-foreground"
          >
            {dbText("githubLinkUrlLabel")}
          </label>
          <div className="flex min-w-0 gap-2">
            <Input
              id="github-folder-url"
              value={url}
              placeholder="https://github.com/owner/repo/tree/main/docs"
              autoComplete="off"
              spellCheck={false}
              disabled={linkFolder.isPending}
              onChange={(event) => {
                setUrl(event.target.value);
                reset();
              }}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!url.trim() || pending}
            >
              {dbText("githubLinkPreview")}
            </Button>
          </div>
        </form>

        {previewFolder.isPending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {dbText("githubLinkReading")}
          </div>
        ) : null}

        {needsConnection ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <span className="min-w-0 break-words">
              {dbText("githubLinkNeedsConnection")}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                startWorkspaceProviderOAuth("github", {
                  appId: "content",
                  returnPath: `${window.location.pathname}${window.location.search}`,
                  scope: "user",
                })
              }
            >
              <IconBrandGithub className="mr-1 size-3.5" aria-hidden />
              {dbText("githubConnect")}
            </Button>
          </div>
        ) : null}

        {error ? (
          <p className="break-words text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {result && !previewFolder.isPending ? (
          <GitHubFolderPreviewView
            preview={result.preview}
            blockedReason={result.blockedReason}
          />
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={linkFolder.isPending}
            onClick={() => onOpenChange(false)}
          >
            {dbText("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canLink || pending}
            onClick={runLink}
          >
            {linkFolder.isPending ? (
              <Spinner className="mr-1 size-3.5" />
            ) : null}
            {dbText("githubLinkSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
