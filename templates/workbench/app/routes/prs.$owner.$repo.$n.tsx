import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconExternalLink,
  IconGitBranch,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconLoader2,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoomHeader } from "@/components/room-header";
import { EmptyState } from "@/components/empty-state";
import {
  PRConversation,
  type PRComment,
} from "@/components/pr/pr-conversation";
import { PRDiff, type PRDiffFile } from "@/components/pr/pr-diff";
import { PRFileTree, type PRFile } from "@/components/pr/pr-file-tree";
import { PRRelated } from "@/components/pr/pr-related";
import {
  PRReviewBar,
  type PRReviewAction,
  type PRReviewTemplate,
} from "@/components/pr/pr-review-bar";
import { PRSummaryCard, type PRSummary } from "@/components/pr/pr-summary-card";

export function meta() {
  return [{ title: "Workbench — PR Review" }];
}

interface ReviewPRResponse {
  connected: boolean;
  connectHint?: string;
  connectUrl?: string;
  viewer?: { login: string; avatarUrl: string | null };
  permissions?: {
    canApprove: boolean;
    canRequestChanges: boolean;
    canComment: boolean;
    isAuthor: boolean;
  };
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: { login: string; avatarUrl: string; url: string } | null;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  baseRef: string;
  headRef: string;
  headSha: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  commits: number;
  ciStatus: "pending" | "success" | "failure" | "neutral" | "unknown";
  files: (PRDiffFile & PRFile)[];
  comments: PRComment[];
  reviewComments: PRComment[];
}

/**
 * Single-PR review surface.
 *
 * Three-column body: file tree (left), unified diff (center), conversation
 * + related rail (right). The Workbench summary card sits above the body
 * and stays expanded by default — it's the v1 differentiator. The sticky
 * review bar at the bottom owns approval/comment/request-changes submit.
 *
 * v1 uses a unified diff per file (the file the user picks in the left rail)
 * — Monaco's `<DiffEditor>` is heavy and a per-file unified view matches
 * GitHub's Files Changed UX more cleanly. The Monaco dep stays in
 * `package.json` so v1.1 can swap in a side-by-side viewer without churn.
 */
export default function PRDetail() {
  const { owner, repo, n } = useParams<{
    owner: string;
    repo: string;
    n: string;
  }>();
  const number = Number(n);

  if (!owner || !repo || !Number.isFinite(number)) {
    return (
      <div className="flex h-full flex-col">
        <RoomHeader title="PR Review" subtitle="Invalid PR reference" />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            icon={IconGitPullRequest}
            title="Couldn't parse PR reference"
            description="Open a PR from the list or via the agent to drop here."
          />
        </div>
      </div>
    );
  }

  const detail = useActionQuery<ReviewPRResponse>(
    "review-pr" as any,
    { owner, repo, number } as any,
  );

  const summary = useActionQuery<PRSummary & { connected: boolean }>(
    "summarize-pr" as any,
    { owner, repo, number } as any,
  );

  const templates = useReviewTemplates();

  const approve = useActionMutation("approve-pr" as any);
  const requestChanges = useActionMutation("request-changes-pr" as any);
  const comment = useActionMutation("comment-pr" as any);
  const inlineCommentMutation = useActionMutation(
    "add-pr-inline-comment" as any,
  );
  const submitting =
    approve.isPending || requestChanges.isPending || comment.isPending;

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [inlineComment, setInlineComment] = useState<{
    path: string;
    line: number;
    message: string;
    submitting: boolean;
  } | null>(null);

  useEffect(() => {
    // Default-select the first file once data lands so the diff isn't blank.
    if (!selectedPath && detail.data?.files?.[0]?.filename) {
      setSelectedPath(detail.data.files[0].filename);
    }
  }, [detail.data, selectedPath]);

  async function handleSubmit(action: PRReviewAction, message: string) {
    const params = { owner: owner!, repo: repo!, number };
    try {
      if (action === "approve") {
        await approve.mutateAsync({ ...params, message } as any);
        toast.success(`Approved ${owner}/${repo}#${number}`);
      } else if (action === "request-changes") {
        await requestChanges.mutateAsync({ ...params, message } as any);
        toast.success(`Requested changes on ${owner}/${repo}#${number}`);
      } else {
        await comment.mutateAsync({ ...params, message } as any);
        toast.success("Comment posted");
      }
      detail.refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't submit review.",
      );
    }
  }

  if (detail.isPending) {
    return <PRDetailSkeleton owner={owner!} repo={repo!} number={number} />;
  }
  if (detail.error) {
    return (
      <div className="flex h-full flex-col">
        <RoomHeader
          title="PR Review"
          subtitle={`${owner}/${repo} #${number}`}
        />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            icon={IconGitPullRequest}
            title="Couldn't load PR"
            description={
              detail.error instanceof Error
                ? detail.error.message
                : "Something went wrong."
            }
            action={
              <Button
                onClick={() => detail.refetch()}
                className="cursor-pointer"
              >
                Try again
              </Button>
            }
          />
        </div>
      </div>
    );
  }
  const pr = detail.data!;
  if (!pr.connected) {
    return (
      <div className="flex h-full flex-col">
        <RoomHeader
          title="PR Review"
          subtitle={`${owner}/${repo} #${number}`}
        />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            icon={IconGitPullRequest}
            title="Connect GitHub to review PRs"
            description={
              pr.connectHint ??
              "Connect GitHub once in Dispatch and grant Workbench access."
            }
            action={
              pr.connectUrl ? (
                <Button asChild className="cursor-pointer">
                  <a href={pr.connectUrl}>Connect via Dispatch</a>
                </Button>
              ) : null
            }
          />
        </div>
      </div>
    );
  }

  const selectedFile =
    pr.files.find((file) => file.filename === selectedPath) ?? null;

  const permissions = pr.permissions ?? {
    canApprove: false,
    canRequestChanges: false,
    canComment: true,
    isAuthor: false,
  };

  return (
    <div className="flex h-full flex-col">
      <Header pr={pr} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="space-y-3 px-4 pt-4">
          {summary.data && summary.data.connected !== false ? (
            <PRSummaryCard summary={summary.data} />
          ) : summary.isPending ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              <Spinner className="mr-2 inline-block size-3" />
              Generating Workbench summary…
            </div>
          ) : null}
        </div>
        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[240px_minmax(0,1fr)_320px]">
          <aside className="hidden border-r md:flex md:flex-col md:overflow-hidden">
            <ScrollableSection label={`Files (${pr.files.length})`}>
              <PRFileTree
                files={pr.files}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            </ScrollableSection>
          </aside>
          <section className="overflow-auto bg-muted/10">
            <PRDiff
              file={selectedFile}
              onComposeInlineComment={(path, line) =>
                setInlineComment({
                  path,
                  line,
                  message: "",
                  submitting: false,
                })
              }
            />
          </section>
          <aside className="hidden flex-col border-l md:flex md:overflow-hidden">
            <Tabs defaultValue="conversation" className="flex h-full flex-col">
              <TabsList className="mx-3 mt-3 grid grid-cols-2">
                <TabsTrigger value="conversation" className="cursor-pointer">
                  Conversation
                </TabsTrigger>
                <TabsTrigger value="related" className="cursor-pointer">
                  Related
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="conversation"
                className="m-0 flex-1 overflow-auto"
              >
                <PRConversation
                  comments={[...pr.comments, ...pr.reviewComments]}
                />
              </TabsContent>
              <TabsContent value="related" className="m-0 flex-1 overflow-auto">
                <PRRelated owner={pr.owner} repo={pr.repo} number={pr.number} />
              </TabsContent>
            </Tabs>
          </aside>
        </div>
        <PRReviewBar
          permissions={permissions}
          templates={templates}
          submitting={submitting}
          onSubmit={handleSubmit}
        />
      </div>
      <InlineCommentDialog
        state={inlineComment}
        onChangeMessage={(message) =>
          setInlineComment((current) =>
            current ? { ...current, message } : current,
          )
        }
        onCancel={() => setInlineComment(null)}
        onSubmit={async () => {
          if (!inlineComment) return;
          if (!inlineComment.message.trim()) return;
          setInlineComment({ ...inlineComment, submitting: true });
          try {
            await inlineCommentMutation.mutateAsync({
              owner: pr.owner,
              repo: pr.repo,
              number: pr.number,
              path: inlineComment.path,
              line: inlineComment.line,
              message: inlineComment.message,
            } as any);
            toast.success(
              `Inline comment posted on ${inlineComment.path}:${inlineComment.line}`,
            );
            setInlineComment(null);
            detail.refetch();
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : "Couldn't post inline comment.",
            );
            setInlineComment((current) =>
              current ? { ...current, submitting: false } : current,
            );
          }
        }}
      />
    </div>
  );
}

interface InlineCommentDialogState {
  path: string;
  line: number;
  message: string;
  submitting: boolean;
}

function InlineCommentDialog({
  state,
  onChangeMessage,
  onCancel,
  onSubmit,
}: {
  state: InlineCommentDialogState | null;
  onChangeMessage: (message: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const open = state !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Inline comment</AlertDialogTitle>
          <AlertDialogDescription asChild>
            {state ? (
              <span className="text-sm text-muted-foreground">
                Comment on{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                  {state.path}:{state.line}
                </code>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground" />
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <textarea
          value={state?.message ?? ""}
          onChange={(e) => onChangeMessage(e.target.value)}
          placeholder="What would you like to say?"
          rows={4}
          autoFocus
          aria-label="Inline comment body"
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        />
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            disabled={!state || !state.message.trim() || state.submitting}
            className="cursor-pointer"
          >
            {state?.submitting ? (
              <IconLoader2 size={14} className="mr-1 animate-spin" />
            ) : null}
            Post comment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Header({ pr }: { pr: ReviewPRResponse }) {
  return (
    <div className="border-b bg-background px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="size-7 cursor-pointer"
        >
          <Link to="/prs" aria-label="Back to PRs">
            <IconArrowLeft size={14} aria-hidden />
          </Link>
        </Button>
        <PRStateBadge pr={pr} />
        <span className="truncate text-xs text-muted-foreground">
          {pr.owner}/{pr.repo} · #{pr.number}
          {pr.author ? ` · ${pr.author.login}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Badge variant="outline" className="gap-1 font-mono text-[10px]">
            <IconGitBranch size={10} aria-hidden />
            {pr.headRef} → {pr.baseRef}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="cursor-pointer"
          >
            <a href={pr.url} target="_blank" rel="noreferrer">
              <IconExternalLink size={14} aria-hidden />
              Open in GitHub
            </a>
          </Button>
        </div>
      </div>
      <h1 className="truncate text-lg font-semibold leading-tight">
        {pr.title}
      </h1>
    </div>
  );
}

function PRStateBadge({ pr }: { pr: ReviewPRResponse }) {
  if (pr.isDraft) {
    return (
      <Badge variant="outline" className="gap-1">
        <IconGitPullRequestDraft size={10} aria-hidden />
        Draft
      </Badge>
    );
  }
  if (pr.state === "merged") {
    return (
      <Badge
        variant="secondary"
        className="gap-1 border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300"
      >
        <IconGitPullRequest size={10} aria-hidden />
        Merged
      </Badge>
    );
  }
  if (pr.state === "closed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <IconGitPullRequestClosed size={10} aria-hidden />
        Closed
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    >
      <IconGitPullRequest size={10} aria-hidden />
      Open
    </Badge>
  );
}

function ScrollableSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </>
  );
}

function PRDetailSkeleton({
  owner,
  repo,
  number,
}: {
  owner: string;
  repo: string;
  number: number;
}) {
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="border-b bg-background px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="size-7 animate-pulse rounded-md bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-48 animate-pulse rounded bg-muted/70" />
        </div>
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <p className="sr-only">
          Loading {owner}/{repo} #{number}
        </p>
      </div>
      <div className="space-y-3 px-4 pt-4">
        <div className="h-20 animate-pulse rounded-md border bg-card" />
      </div>
      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[240px_minmax(0,1fr)_320px]">
        <div className="hidden border-r p-3 md:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="my-2 h-6 w-full animate-pulse rounded bg-muted/60"
            />
          ))}
        </div>
        <div className="flex items-center justify-center p-8">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
        <div className="hidden border-l p-3 md:block">
          <div className="my-2 h-8 w-full animate-pulse rounded bg-muted/60" />
          <div className="my-2 h-24 w-full animate-pulse rounded bg-muted/40" />
        </div>
      </div>
    </div>
  );
}

/**
 * Loads the user's review templates from `list-workbench-review-templates`
 * (still on the v1.1 milestone — the action lands with the review-templates
 * settings UI). For v1 we fall back to a curated set of defaults so the
 * Template menu is non-empty on first run.
 */
function useReviewTemplates(): PRReviewTemplate[] {
  // `list-workbench-review-templates` is owned by the Settings room and lands
  // alongside the review-templates UI. Until it's wired we ship sensible
  // defaults so the Template menu is non-empty.
  return useMemo(
    () => [
      { id: "lgtm", label: "LGTM", body: "LGTM, shipping it." },
      {
        id: "lgtm-nit",
        label: "LGTM with nit",
        body: "LGTM — one nit: …",
      },
      {
        id: "needs-tests",
        label: "Needs tests",
        body: "Can we add tests covering this change before merging?",
      },
      {
        id: "discuss",
        label: "Let's discuss",
        body: "Could you walk me through the reasoning here before we merge?",
      },
    ],
    [],
  );
}
