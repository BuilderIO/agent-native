import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  IconAlertCircle,
  IconBrandGithub,
  IconBug,
  IconCheck,
  IconExternalLink,
  IconLayoutDashboard,
  IconMessageCircle,
  IconPlus,
  IconSettings,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";
import { RoomHeader } from "@/components/room-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Workbench — Settings" }];
}

/**
 * Shape returned by the `get-workbench-connections` action. Mirrors the
 * `WorkbenchConnectionsResult` defined in
 * `actions/get-workbench-connections.ts` (kept in sync by hand for v1
 * until the generated action-types registry covers this template).
 */
interface WorkbenchConnections {
  github: {
    connected: boolean;
    accountLabel?: string;
    scopes?: string[];
    lastError?: string;
    connectUrl: string;
  };
  sentry: {
    connected: false;
    comingSoon: true;
  };
}

/**
 * Workbench Settings — connections, repos, review templates, mute rules,
 * and per-host MCP install snippets.
 *
 * v1 lights up the GitHub connection (via the shared workspace
 * integration in Dispatch). Sentry, repos, review templates, muted card
 * types, and MCP install snippets render as collapsed "Coming soon"
 * sections so the user can see the shape of the surface without each
 * piece being half-wired.
 *
 * Connections are NEVER wired with Workbench-owned OAuth. GitHub is
 * connected once in Dispatch and granted to Workbench (and Brain,
 * Analytics, etc.). See `templates/workbench/AGENTS.md`.
 */
export default function Settings() {
  return (
    <div className="flex h-full flex-col">
      <RoomHeader
        title="Settings"
        subtitle="Connections, repos, review templates, and host install snippets."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
          <ConnectionsSection />
          <ConnectedReposSection />
          <PreferencesSection />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function ConnectionsSection() {
  const query = useActionQuery<WorkbenchConnections>(
    "get-workbench-connections" as any,
    {} as any,
  );

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Connections"
        description="Shared workspace integrations Workbench reuses across rooms. Connect each provider once in Dispatch and grant Workbench access — no per-app OAuth."
      />

      <GitHubConnectionCard
        status={query.data?.github}
        loading={query.isPending}
        error={query.error}
      />

      <SentryConnectionCard />
    </section>
  );
}

function GitHubConnectionCard({
  status,
  loading,
  error,
}: {
  status: WorkbenchConnections["github"] | undefined;
  loading: boolean;
  error: unknown;
}) {
  // `connectUrl` is always returned by `get-workbench-connections`
  // (resolved server-side via `getDispatchIntegrationsUrl`). Fall back to
  // the empty string only while the query is still loading — the Connect
  // CTA is hidden in that state anyway, so we never render an `<a href="">`.
  const connectUrl = status?.connectUrl ?? "";
  const connected = Boolean(status?.connected);
  const accountLabel = status?.accountLabel;
  const scopes = status?.scopes ?? [];
  const lastError = status?.lastError;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
              <IconBrandGithub size={18} aria-hidden />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base leading-tight">GitHub</CardTitle>
              <CardDescription>
                Required. Powers PR cards in the Queue, the PR Room, and CI
                status. Connected via Dispatch.
              </CardDescription>
            </div>
          </div>
          <ConnectionStatusBadge
            loading={loading}
            error={Boolean(error)}
            connected={connected}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            <span>Checking GitHub connection…</span>
          </div>
        ) : connected ? (
          <ConnectedGitHubBody
            accountLabel={accountLabel}
            scopes={scopes}
            connectUrl={connectUrl}
          />
        ) : (
          <DisconnectedGitHubBody
            connectUrl={connectUrl}
            error={
              error
                ? "Couldn't load connection status. Try again in a moment."
                : lastError
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectedGitHubBody({
  accountLabel,
  scopes,
  connectUrl,
}: {
  accountLabel?: string;
  scopes: string[];
  connectUrl: string;
}) {
  return (
    <>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Account
          </dt>
          <dd className="mt-1 font-medium text-foreground">
            {accountLabel ?? "GitHub workspace connection"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Scopes
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {scopes.length > 0 ? (
              scopes.map((scope) => (
                <Badge key={scope} variant="secondary" className="font-mono">
                  {scope}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">None advertised</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild className="cursor-pointer">
          <a href={connectUrl}>
            <IconExternalLink size={14} aria-hidden />
            Manage in Dispatch
          </a>
        </Button>
      </div>
    </>
  );
}

function DisconnectedGitHubBody({
  connectUrl,
  error,
}: {
  connectUrl: string;
  error?: string;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        GitHub isn't connected yet. Connect once in Dispatch and grant Workbench
        access — the same connection is reused by Brain, Analytics, and any
        other workspace app that needs GitHub.
      </p>
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <IconAlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" asChild className="cursor-pointer">
          <a href={connectUrl}>
            <IconBrandGithub size={14} aria-hidden />
            Connect via Dispatch
          </a>
        </Button>
      </div>
    </>
  );
}

function SentryConnectionCard() {
  return (
    <Card className="bg-card/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <IconBug size={18} aria-hidden />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base leading-tight">Sentry</CardTitle>
              <CardDescription>
                Optional. Surfaces error cards in the Queue and links them to
                PRs touching the same files.
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
          >
            Coming soon
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Optional. Surfaces new production errors as cards in your Attention
          Queue, with links to PRs touching the same code.
        </p>
      </CardContent>
    </Card>
  );
}

function ConnectionStatusBadge({
  loading,
  error,
  connected,
}: {
  loading: boolean;
  error: boolean;
  connected: boolean;
}) {
  if (loading) {
    return (
      <Badge variant="outline" className="gap-1">
        <Spinner className="size-3" />
        Checking
      </Badge>
    );
  }
  if (error) {
    return (
      <Badge variant="destructive" className="gap-1">
        <IconAlertCircle size={12} aria-hidden />
        Error
      </Badge>
    );
  }
  if (connected) {
    return (
      <Badge
        variant="secondary"
        className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      >
        <IconCheck size={12} aria-hidden />
        Connected
      </Badge>
    );
  }
  return <Badge variant="outline">Not connected</Badge>;
}

// ---------------------------------------------------------------------------
// Connected repos
// ---------------------------------------------------------------------------

/**
 * Shape returned by `list-workbench-repos`. Mirrored by hand for v1 until
 * the generated action-types registry covers this template.
 */
interface WorkbenchRepo {
  id: string;
  owner: string;
  name: string;
  addedAt: string;
}
interface WorkbenchReposResult {
  repos: WorkbenchRepo[];
}

/**
 * Shape returned by `add-repo-to-queue`. Includes a soft "connect GitHub"
 * branch when the workspace integration isn't ready.
 */
interface AddRepoResult {
  ok: boolean;
  connected?: boolean;
  alreadyAdded?: boolean;
  repo?: WorkbenchRepo;
  message?: string;
  connectUrl?: string;
}

/** Shape of the `remove-repo-from-queue` response. */
interface RemoveRepoResult {
  ok: boolean;
  id: string;
  removed: boolean;
  repo?: { owner: string; name: string };
  message?: string;
}

const REPOS_QUERY_KEY = ["action", "list-workbench-repos"] as const;
const REPOS_COUNT_QUERY_KEY = [
  "action",
  "list-workbench-repos",
  "count",
] as const;

function ConnectedReposSection() {
  const query = useActionQuery<WorkbenchReposResult>(
    "list-workbench-repos" as any,
    {} as any,
  );
  const repos = query.data?.repos ?? [];

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Connected repos"
        description="GitHub repos Workbench pulls into your Attention Queue and PR Room. Add one per row — remove anytime."
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
                <IconBrandGithub size={18} aria-hidden />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base leading-tight">Repos</CardTitle>
                <CardDescription>
                  Each repo's open PRs and CI status appear in your Attention
                  Queue.
                </CardDescription>
              </div>
            </div>
            <AddRepoPopover />
          </div>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              <span>Loading repos…</span>
            </div>
          ) : query.error ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <IconAlertCircle
                size={16}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              <span>Couldn't load repos. Try again in a moment.</span>
            </div>
          ) : repos.length === 0 ? (
            <ReposEmptyState />
          ) : (
            <ul className="divide-y rounded-md border">
              {repos.map((repo) => (
                <RepoRow key={repo.id} repo={repo} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ReposEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/40 px-4 py-8 text-center">
      <IconBrandGithub
        size={20}
        className="text-muted-foreground"
        aria-hidden
      />
      <p className="text-sm font-medium text-foreground">No repos yet</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Add a repo and Workbench will start surfacing its open PRs and CI status
        in your Attention Queue.
      </p>
    </div>
  );
}

function RepoRow({ repo }: { repo: WorkbenchRepo }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const qc = useQueryClient();
  const remove = useActionMutation<RemoveRepoResult, { id: string }>(
    "remove-repo-from-queue" as any,
  );

  async function handleRemove() {
    // Optimistic: drop the row from the cache immediately.
    const prev = qc.getQueryData<WorkbenchReposResult>(REPOS_QUERY_KEY);
    if (prev) {
      qc.setQueryData<WorkbenchReposResult>(REPOS_QUERY_KEY, {
        repos: prev.repos.filter((r) => r.id !== repo.id),
      });
    }
    setConfirmOpen(false);
    try {
      await remove.mutateAsync({ id: repo.id });
      qc.invalidateQueries({ queryKey: REPOS_COUNT_QUERY_KEY });
      toast.success(`Removed ${repo.owner}/${repo.name}.`);
    } catch (err) {
      // Roll back on failure.
      if (prev) qc.setQueryData(REPOS_QUERY_KEY, prev);
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove the repo.",
      );
    }
  }

  return (
    <li className="group flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-accent/30">
      <div className="flex min-w-0 items-center gap-2">
        <IconBrandGithub
          size={14}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="truncate font-mono text-sm">
          {repo.owner}/{repo.name}
        </span>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 cursor-pointer p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`Remove ${repo.owner}/${repo.name}`}
          >
            <IconX size={14} aria-hidden />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {repo.owner}/{repo.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This repo will stop appearing in your Attention Queue and PR Room.
              You can add it back anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function AddRepoPopover() {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const qc = useQueryClient();
  const add = useActionMutation<AddRepoResult, { owner: string; repo: string }>(
    "add-repo-to-queue" as any,
  );

  function reset() {
    setOwner("");
    setRepo("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedOwner = owner.trim();
    const trimmedRepo = repo.trim();
    if (!trimmedOwner || !trimmedRepo) {
      toast.error("Enter both an owner and a repo name.");
      return;
    }

    // Optimistic: tack the new repo onto the list immediately.
    const optimisticId = `optimistic_${Date.now()}`;
    const optimisticRepo: WorkbenchRepo = {
      id: optimisticId,
      owner: trimmedOwner,
      name: trimmedRepo,
      addedAt: new Date().toISOString(),
    };
    const prev = qc.getQueryData<WorkbenchReposResult>(REPOS_QUERY_KEY);
    if (prev) {
      qc.setQueryData<WorkbenchReposResult>(REPOS_QUERY_KEY, {
        repos: [optimisticRepo, ...prev.repos],
      });
    }
    setOpen(false);
    reset();

    try {
      const result = await add.mutateAsync({
        owner: trimmedOwner,
        repo: trimmedRepo,
      });
      if (result.ok === false && result.connected === false) {
        // Roll back and surface the connect-GitHub CTA.
        if (prev) qc.setQueryData(REPOS_QUERY_KEY, prev);
        toast.error(
          result.message ||
            "Connect GitHub first to validate repos before adding them.",
          {
            action: result.connectUrl
              ? {
                  label: "Connect",
                  onClick: () => {
                    window.location.href = result.connectUrl!;
                  },
                }
              : undefined,
          },
        );
        return;
      }
      // Replace the optimistic row with the server row.
      const saved = result.repo;
      if (saved) {
        qc.setQueryData<WorkbenchReposResult>(REPOS_QUERY_KEY, (current) =>
          current
            ? {
                repos: current.repos.map((r) =>
                  r.id === optimisticId ? saved : r,
                ),
              }
            : { repos: [saved] },
        );
      } else {
        qc.invalidateQueries({ queryKey: REPOS_QUERY_KEY });
      }
      qc.invalidateQueries({ queryKey: REPOS_COUNT_QUERY_KEY });
      if (result.alreadyAdded) {
        toast.success(
          `${trimmedOwner}/${trimmedRepo} is already in your queue.`,
        );
      } else {
        toast.success(`Added ${trimmedOwner}/${trimmedRepo}.`);
      }
    } catch (err) {
      if (prev) qc.setQueryData(REPOS_QUERY_KEY, prev);
      toast.error(
        err instanceof Error ? err.message : "Couldn't add the repo.",
      );
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="cursor-pointer">
          <IconPlus size={14} aria-hidden />
          Add repo
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">Add a GitHub repo</h4>
            <p className="text-xs text-muted-foreground">
              Workbench will validate it via your workspace GitHub connection.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repo-owner">Owner</Label>
            <Input
              id="repo-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="acme"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repo-name">Repo</Label>
            <Input
              id="repo-name"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="api"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="cursor-pointer"
              disabled={add.isPending || !owner.trim() || !repo.trim()}
            >
              {add.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function PreferencesSection() {
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Workbench preferences"
        description="Workbench-specific defaults. Each section lights up alongside its owning room."
      />

      <PreferencePlaceholder
        icon={IconMessageCircle}
        title="Review templates"
        description="Saved comment templates the PR Room offers when approving, requesting changes, or commenting. Wired with the PR Room."
      />

      <PreferencePlaceholder
        icon={IconVolumeOff}
        title="Muted card types"
        description="Hide entire card types from the Queue (e.g. draft PRs, low-severity errors). Wired with the Queue."
      />

      <PreferencePlaceholder
        icon={IconLayoutDashboard}
        title="MCP install snippets"
        description="Per-host snippets (Claude Code, Cursor, Codex, VS Code) for installing Workbench as an MCP App. Lands with the MCP exposure milestone."
      />
    </section>
  );
}

function PreferencePlaceholder({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof IconSettings;
  title: string;
  description: string;
}) {
  return (
    <Card className="bg-card/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <Icon size={18} aria-hidden />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base leading-tight">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
          >
            Coming soon
          </Badge>
        </div>
      </CardHeader>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
