import { useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import type { ContentDatabaseSource } from "@shared/api";
import {
  githubFolderName,
  type GitHubFolderPreview,
  type GitHubLinkBlockedReason,
} from "@shared/github-source";
import { IconBrandGithub, IconCheck } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
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
import { startPageOpenDocumentReads } from "@/hooks/use-documents";
import {
  useCreateGitHubCollection,
  useGitHubConnection,
  useLinkGitHubFolder,
  type GitHubFolderSyncSummary,
} from "@/hooks/use-github-folder";
import {
  GITHUB_LINK_DIALOG_OPEN_EVENT,
  githubLinkRequestFromSearch,
  githubLinkReturnPath,
  searchWithoutGitHubLink,
  type GitHubLinkDialogRequest,
  type GitHubLinkTarget,
} from "@/lib/github-link-dialog";

import {
  githubBlockedFromErrorCode,
  githubBlockedText,
  githubErrorNeedsConnection,
  githubExampleText,
  githubLinkErrorText,
  githubList,
  githubListWithMore,
  githubProblemText,
  githubSkipReasonText,
  githubUrlProblem,
  shortCommit,
} from "./github-source-text";
import { dbText } from "./text";

/** Pages, columns or files a details list shows before "and N more". */
const DETAILS_LIST_LIMIT = 8;
/** Page titles the summary names before "and N more". */
const SUMMARY_TITLES = 3;
/** Column names the summary names before "and N more". */
const SUMMARY_COLUMNS = 6;

interface CheckedFolder {
  url: string;
  preview: GitHubFolderPreview;
  blockedReason: GitHubLinkBlockedReason | null;
}

interface LinkProblem {
  text: string;
  /** The folder a file link points into, to use instead. */
  folder?: { url: string; name: string } | null;
  /** The collection can't take a folder, so offer a new one. */
  offerNewCollection?: boolean;
}

/** Whether the folder link would fill in fewer pages than it has files. */
function pagesAreEstimate(preview: GitHubFolderPreview): boolean {
  // Only the first files are read before linking; the others can still turn
  // out unreadable, so the count is a ceiling until then.
  return preview.sampledFiles < preview.markdownFiles;
}

function pagesLine(preview: GitHubFolderPreview): string {
  const count = preview.markdownFiles;
  const titles = githubListWithMore(
    preview.sample.map((page) => page.title),
    count,
    SUMMARY_TITLES,
  );
  if (pagesAreEstimate(preview)) {
    return dbText("githubLinkPagesUpTo", { count, titles });
  }
  return count === 1
    ? dbText("githubLinkPagesOne", { titles })
    : dbText("githubLinkPages", { count, titles });
}

function linkButtonText(preview: GitHubFolderPreview): string {
  const count = preview.markdownFiles;
  if (pagesAreEstimate(preview)) {
    return dbText("githubLinkSubmitUpTo", { count });
  }
  return count === 1
    ? dbText("githubLinkSubmitOne")
    : dbText("githubLinkSubmit", { count });
}

function folderLine(preview: GitHubFolderPreview): string {
  const { location } = preview;
  return location.path
    ? dbText("githubLinkFolderIn", {
        folder: githubFolderName(location),
        repo: location.repo,
      })
    : location.repo;
}

/** Says how the link went, once the dialog closes. */
function announceLink(
  preview: GitHubFolderPreview,
  sync: GitHubFolderSyncSummary,
  source: ContentDatabaseSource | null,
) {
  const folder = githubFolderName(preview.location);
  // The link is saved even when its first update fails; say both, and the
  // status line keeps showing the problem after this closes.
  if (sync.state === "error") {
    toast.error(dbText("githubLinkedSyncFailed", { folder }), {
      description: githubProblemText(
        sync.problem?.code ?? "unavailable",
        preview.location,
      ),
    });
    return;
  }
  if (sync.state === "partial") {
    const progress = source?.metadata.github?.progress;
    toast.success(
      dbText("githubLinkedPartialToast", {
        done: progress?.done ?? sync.created,
        total: progress?.total ?? sync.created + sync.remaining,
      }),
    );
    return;
  }
  const count = sync.created || preview.markdownFiles;
  toast.success(
    count === 1
      ? dbText("githubLinkedToastOne", { folder })
      : dbText("githubLinkedToast", { count, folder }),
  );
}

function DetailsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-1">
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Everything the summary leaves out, for the person who wants to look. */
function GitHubFolderDetails({ preview }: { preview: GitHubFolderPreview }) {
  const t = useT();
  const morePages = preview.markdownFiles - DETAILS_LIST_LIMIT;
  const moreSkipped = preview.skipped.length - DETAILS_LIST_LIMIT;
  return (
    <div
      id="github-folder-details"
      className="grid min-w-0 gap-3 border-t border-border pt-3 text-xs"
      data-github-folder-details
    >
      {preview.sample.length > 0 ? (
        <DetailsSection title={dbText("githubDetailsPages")}>
          <ul className="grid min-w-0 gap-0.5">
            {preview.sample.slice(0, DETAILS_LIST_LIMIT).map((page) => (
              <li key={page.path} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate">{page.title}</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {page.path}
                </span>
              </li>
            ))}
            {morePages > 0 ? (
              <li className="text-muted-foreground">
                {dbText("githubLinkMore", { count: morePages })}
              </li>
            ) : null}
          </ul>
        </DetailsSection>
      ) : null}
      {preview.fields.length > 0 ? (
        <DetailsSection title={dbText("githubDetailsColumns")}>
          <ul className="grid min-w-0 gap-0.5">
            {preview.fields.map((field) => (
              <li key={field.key} className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0">{field.key}</span>
                <span className="shrink-0 text-muted-foreground">
                  {t(`editor.propertyTypes.${field.type}`)}
                </span>
                {field.examples.length > 0 ? (
                  <span className="min-w-0 truncate text-muted-foreground/80">
                    {githubList(
                      [...new Set(field.examples)]
                        .slice(0, 3)
                        .map((example) =>
                          githubExampleText(field.type, example),
                        ),
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {pagesAreEstimate(preview) ? (
            <p className="text-muted-foreground">
              {dbText("githubDetailsColumnsSampled", {
                count: preview.sampledFiles,
                total: preview.markdownFiles,
              })}
            </p>
          ) : null}
        </DetailsSection>
      ) : null}
      {preview.skipped.length > 0 ? (
        <DetailsSection title={dbText("githubDetailsNotShown")}>
          <ul className="grid min-w-0 gap-0.5">
            {preview.skipped.slice(0, DETAILS_LIST_LIMIT).map((file) => (
              <li key={file.path} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate">{file.path}</span>
                <span className="shrink-0 text-muted-foreground">
                  {githubSkipReasonText(file.reason)}
                </span>
              </li>
            ))}
            {moreSkipped > 0 ? (
              <li className="text-muted-foreground">
                {dbText("githubLinkMore", { count: moreSkipped })}
              </li>
            ) : null}
          </ul>
        </DetailsSection>
      ) : null}
      <DetailsSection title={dbText("githubDetailsFrom")}>
        <p className="text-muted-foreground">
          {dbText("githubDetailsBranchVersion", {
            branch: preview.location.branch,
            commit: shortCommit(preview.commitSha),
          })}
        </p>
      </DetailsSection>
    </div>
  );
}

/**
 * What linking the folder would do, in four plain lines: which folder, its
 * pages, its columns, and what won't show. The rest waits behind "Show
 * details".
 */
export function GitHubFolderSummary({
  preview,
  blockedReason,
  onNewCollection,
}: {
  preview: GitHubFolderPreview;
  blockedReason: GitHubLinkBlockedReason | null;
  onNewCollection?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const hasPages = preview.markdownFiles > 0;
  const columns = githubListWithMore(
    preview.fields.map((field) => field.key),
    preview.fields.length,
    SUMMARY_COLUMNS,
  );
  const skipped = preview.skipped.length;
  return (
    <div
      className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-muted/20 p-3 text-sm"
      data-github-folder-preview
    >
      <a
        href={preview.folderUrl}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 items-center gap-1.5 break-words font-medium underline-offset-2 hover:underline"
      >
        <IconCheck className="size-4 shrink-0 text-foreground" aria-hidden />
        <span className="min-w-0 break-words">{folderLine(preview)}</span>
      </a>
      <p className="break-words text-muted-foreground">
        {hasPages ? pagesLine(preview) : dbText("githubLinkNoFiles")}
      </p>
      {hasPages ? (
        <p className="break-words text-muted-foreground">
          {preview.fields.length > 0
            ? dbText("githubLinkColumns", { columns })
            : dbText("githubLinkNoColumns")}
        </p>
      ) : null}
      {preview.images > 0 && !preview.storageReady ? (
        <p className="break-words text-muted-foreground">
          {dbText("githubLinkPicturesWaiting")}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="break-words text-muted-foreground">
          {skipped === 0
            ? null
            : skipped === 1
              ? dbText("githubLinkNotShownOne")
              : dbText("githubLinkNotShown", { count: skipped })}
        </span>
        <button
          type="button"
          className="ms-auto rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={showDetails}
          aria-controls="github-folder-details"
          onClick={() => setShowDetails((open) => !open)}
        >
          {showDetails
            ? dbText("githubHideDetails")
            : dbText("githubShowDetails")}
        </button>
      </div>
      {blockedReason ? (
        <div
          className="mt-1 grid min-w-0 gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
          role="alert"
        >
          <span className="break-words">
            {githubBlockedText(blockedReason)}
          </span>
          {onNewCollection ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="justify-self-start"
              onClick={onNewCollection}
            >
              {dbText("githubNewCollectionInstead")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {showDetails ? <GitHubFolderDetails preview={preview} /> : null}
    </div>
  );
}

/**
 * Links a collection to a GitHub folder, or makes a new collection from one:
 * connect GitHub if needed, paste the folder's link, check what it becomes,
 * then link it.
 */
export function GitHubLinkDialog({
  request,
  open,
  onOpenChange,
}: {
  request: GitHubLinkDialogRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const linkFolder = useLinkGitHubFolder();
  const createCollection = useCreateGitHubCollection();
  const connection = useGitHubConnection(open);
  const [target, setTarget] = useState<GitHubLinkTarget>(request.target);
  const [url, setUrl] = useState(request.url ?? "");
  const [checked, setChecked] = useState<CheckedFolder | null>(null);
  const [problem, setProblem] = useState<LinkProblem | null>(null);
  const [checking, setChecking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [triedOnce, setTriedOnce] = useState(false);
  // Counts checks and edits, so a check that answers after the link changed
  // is dropped rather than shown under the new link.
  const checkRun = useRef(0);
  const startedFromUrl = useRef(false);

  const isNew = target.kind === "new";
  const newCollectionPlace =
    target.kind === "new"
      ? target
      : target.spaceId
        ? { spaceId: target.spaceId, parentId: target.parentId ?? null }
        : null;
  const connected = connection.data?.connected;
  const showConnect =
    needsConnection || (connected === false && !checked && !linking);
  const waitingForConnection =
    !needsConnection && connection.isPending && !checked;
  const ready =
    !!checked &&
    !checked.blockedReason &&
    checked.preview.markdownFiles > 0 &&
    checked.url === url.trim();

  function clearCheck() {
    checkRun.current += 1;
    setChecked(null);
    setProblem(null);
    setChecking(false);
  }

  function handleError(error: unknown, typed: string) {
    if (githubErrorNeedsConnection(error)) {
      setNeedsConnection(true);
      setProblem(null);
      return;
    }
    const blocked = githubBlockedFromErrorCode(
      (error as { errorCode?: unknown } | null)?.errorCode,
    );
    setProblem({
      text: githubLinkErrorText(error, typed),
      offerNewCollection: !!blocked && !!newCollectionPlace,
    });
  }

  async function check(nextUrl = url, into: GitHubLinkTarget = target) {
    const typed = nextUrl.trim();
    clearCheck();
    if (!typed) return;
    setTriedOnce(true);
    const urlProblem = githubUrlProblem(typed);
    if (urlProblem) {
      setProblem({
        text: urlProblem.text,
        folder:
          urlProblem.folderUrl && urlProblem.folder
            ? { url: urlProblem.folderUrl, name: urlProblem.folder }
            : null,
      });
      return;
    }
    const run = checkRun.current;
    setChecking(true);
    try {
      const response =
        into.kind === "collection"
          ? await linkFolder.mutateAsync({
              databaseId: into.databaseId,
              url: typed,
              dryRun: true,
            })
          : await createCollection.mutateAsync({
              url: typed,
              spaceId: into.spaceId,
              parentId: into.parentId,
              dryRun: true,
            });
      if (run !== checkRun.current || !response.dryRun) return;
      setChecked({
        url: typed,
        preview: response.preview,
        blockedReason:
          "blockedReason" in response ? response.blockedReason : null,
      });
    } catch (error) {
      if (run === checkRun.current) handleError(error, typed);
    } finally {
      if (run === checkRun.current) setChecking(false);
    }
  }

  async function link() {
    if (!checked || !ready) return;
    const { preview } = checked;
    setLinking(true);
    setProblem(null);
    try {
      if (target.kind === "collection") {
        const response = await linkFolder.mutateAsync({
          databaseId: target.databaseId,
          url: checked.url,
        });
        if (response.dryRun) return;
        announceLink(preview, response.sync, response.source);
        onOpenChange(false);
        return;
      }
      const response = await createCollection.mutateAsync({
        url: checked.url,
        spaceId: target.spaceId,
        parentId: target.parentId,
      });
      if (response.dryRun) return;
      announceLink(preview, response.sync, response.source);
      onOpenChange(false);
      const documentId = response.database.documentId;
      startPageOpenDocumentReads(queryClient, documentId);
      void navigate(`/page/${documentId}`);
    } catch (error) {
      handleError(error, checked.url);
    } finally {
      setLinking(false);
    }
  }

  function connectGitHub() {
    startWorkspaceProviderOAuth("github", {
      appId: "content",
      returnPath: githubLinkReturnPath(window.location, target, url),
      scope: "user",
    });
  }

  /** Keeps the link and checks it again, for a new collection beside this one. */
  function switchToNewCollection() {
    if (!newCollectionPlace) return;
    const next: GitHubLinkTarget = { kind: "new", ...newCollectionPlace };
    setTarget(next);
    void check(url, next);
  }

  // A link carried back from GitHub's sign-in is checked once the
  // connection allows it.
  const canCheckStartUrl =
    !!request.url?.trim() && !waitingForConnection && !showConnect;
  useEffect(() => {
    if (startedFromUrl.current || !canCheckStartUrl) return;
    startedFromUrl.current = true;
    void check(request.url);
    // Runs once, when the dialog can first check; `check` is the latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCheckStartUrl]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) void link();
    else if (!checking) void check();
  }

  function pasteLink(event: ClipboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const replacesAll =
      input.value === "" ||
      (input.selectionStart === 0 && input.selectionEnd === input.value.length);
    const pasted = event.clipboardData.getData("text").trim();
    if (!replacesAll || !pasted) return;
    event.preventDefault();
    setUrl(pasted);
    void check(pasted);
  }

  const primaryText = linking
    ? dbText("githubLinking")
    : ready && checked
      ? linkButtonText(checked.preview)
      : dbText("githubLinkCheck");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (linking && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        hideClose={linking}
        onCloseAutoFocus={(event) => {
          const returnTo = request.returnFocusTo;
          if (returnTo?.isConnected) {
            event.preventDefault();
            returnTo.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <IconBrandGithub className="size-4" aria-hidden />
              {isNew
                ? dbText("githubNewCollectionTitle")
                : dbText("githubLinkTitle")}
            </span>
          </DialogTitle>
          <DialogDescription>
            {isNew
              ? dbText("githubNewCollectionDescription")
              : dbText("githubLinkDescription")}
          </DialogDescription>
        </DialogHeader>

        {waitingForConnection ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Spinner className="size-3.5" />
            {dbText("githubConnectChecking")}
          </div>
        ) : showConnect ? (
          <p className="break-words text-sm" data-github-connect-step>
            {dbText("githubConnectPrompt")}
          </p>
        ) : (
          <form
            id="github-link-form"
            className="grid min-w-0 gap-1.5"
            onSubmit={submit}
          >
            <label
              htmlFor="github-folder-url"
              className="text-xs font-medium text-muted-foreground"
            >
              {dbText("githubLinkUrlLabel")}
            </label>
            <Input
              id="github-folder-url"
              value={url}
              placeholder="https://github.com/your-team/website/tree/main/docs"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={linking}
              aria-describedby={
                triedOnce ? undefined : "github-folder-url-help"
              }
              aria-invalid={problem ? true : undefined}
              onPaste={pasteLink}
              onChange={(event) => {
                setUrl(event.target.value);
                clearCheck();
              }}
            />
            {triedOnce ? null : (
              <p
                id="github-folder-url-help"
                className="text-xs text-muted-foreground"
              >
                {dbText("githubLinkUrlHelp")}
              </p>
            )}
          </form>
        )}

        {checking ? (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            <Spinner className="size-3.5" />
            {dbText("githubLinkReading")}
          </div>
        ) : null}

        {problem ? (
          <div className="grid min-w-0 gap-2" role="alert">
            <p className="break-words text-xs text-destructive">
              {problem.text}
            </p>
            {problem.folder ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="justify-self-start"
                onClick={() => {
                  const folderUrl = problem.folder!.url;
                  setUrl(folderUrl);
                  void check(folderUrl);
                }}
              >
                {dbText("githubLinkUseFolder", { folder: problem.folder.name })}
              </Button>
            ) : null}
            {problem.offerNewCollection ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="justify-self-start"
                onClick={switchToNewCollection}
              >
                {dbText("githubNewCollectionInstead")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {checked && !checking && !showConnect ? (
          <GitHubFolderSummary
            preview={checked.preview}
            blockedReason={checked.blockedReason}
            onNewCollection={
              newCollectionPlace ? switchToNewCollection : undefined
            }
          />
        ) : null}

        {linking && checked ? (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            <Spinner className="size-3.5" />
            {checked.preview.markdownFiles === 1
              ? dbText("githubLinkingProgressOne")
              : dbText("githubLinkingProgress", {
                  count: checked.preview.markdownFiles,
                })}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={linking}
            onClick={() => onOpenChange(false)}
          >
            {dbText("cancel")}
          </Button>
          {waitingForConnection ? null : showConnect ? (
            <Button type="button" onClick={connectGitHub}>
              <IconBrandGithub className="mr-1 size-3.5" aria-hidden />
              {dbText("githubConnect")}
            </Button>
          ) : (
            <Button
              type="submit"
              form="github-link-form"
              disabled={
                linking ||
                checking ||
                !url.trim() ||
                (!!checked && !ready && checked.url === url.trim())
              }
            >
              {linking ? <Spinner className="mr-1 size-3.5" /> : null}
              {primaryText}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one GitHub folder dialog for the app. Anything can open it with
 * `openGitHubLinkDialog`, and it reopens after GitHub's sign-in from the
 * page's address.
 */
export function GitHubLinkDialogHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<{
    request: GitHubLinkDialogRequest;
    open: boolean;
    key: number;
  } | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const request = (event as CustomEvent<GitHubLinkDialogRequest>).detail;
      if (!request?.target) return;
      setState((current) => ({
        request,
        open: true,
        key: (current?.key ?? 0) + 1,
      }));
    };
    window.addEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, onOpen);
    return () =>
      window.removeEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, onOpen);
  }, []);

  // Back from GitHub's sign-in: reopen the dialog the address names, then
  // drop it from the address so a reload doesn't open it again.
  useEffect(() => {
    const request = githubLinkRequestFromSearch(location.search);
    if (!request) return;
    setState((current) => ({
      request,
      open: true,
      key: (current?.key ?? 0) + 1,
    }));
    void navigate(
      {
        pathname: location.pathname,
        search: searchWithoutGitHubLink(location.search),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate]);

  if (!state) return null;
  return (
    <GitHubLinkDialog
      key={state.key}
      request={state.request}
      open={state.open}
      onOpenChange={(open) =>
        setState((current) => (current ? { ...current, open } : current))
      }
    />
  );
}
