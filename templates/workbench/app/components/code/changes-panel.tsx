import { useQuery } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { IconFile, IconGitBranch } from "@tabler/icons-react";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
}

interface ChangesResult {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  staged: ChangedFile[];
  unstaged: ChangedFile[];
  untracked: string[];
}

interface ChangesPanelProps {
  workspaceId: string;
  /** Called when the user clicks a changed file — opens the diff view. */
  onOpenDiff: (path: string) => void;
}

/**
 * The "Changes" sidebar panel — VS Code style Staged / Unstaged /
 * Untracked sections with a quick branch header at the top. Clicking a
 * row opens the corresponding diff in the editor pane.
 */
export function ChangesPanel({ workspaceId, onOpenDiff }: ChangesPanelProps) {
  const query = useQuery<ChangesResult>({
    queryKey: ["code", "git-changes", workspaceId],
    queryFn: async () => {
      const params = new URLSearchParams({ workspaceId, scope: "all" });
      const res = await fetch(
        agentNativePath(
          `/_agent-native/actions/git-changes?${params.toString()}`,
        ),
      );
      if (!res.ok) throw new Error(`git-changes failed (${res.status})`);
      return (await res.json()) as ChangesResult;
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Changes
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {query.isPending ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Loading…
          </div>
        ) : query.isError ? (
          <div className="px-1 py-2 text-xs text-destructive">
            Couldn't read git status.
          </div>
        ) : !query.data?.isRepo ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            This workspace isn't a git repository.
          </div>
        ) : (
          <div className="space-y-3">
            <BranchHeader
              branch={query.data.branch ?? ""}
              ahead={query.data.ahead ?? 0}
              behind={query.data.behind ?? 0}
            />
            <Section
              label="Staged"
              count={query.data.staged.length}
              files={query.data.staged}
              onOpenDiff={onOpenDiff}
            />
            <Section
              label="Unstaged"
              count={query.data.unstaged.length}
              files={query.data.unstaged}
              onOpenDiff={onOpenDiff}
            />
            <SectionUntracked
              count={query.data.untracked.length}
              files={query.data.untracked}
              onOpenDiff={onOpenDiff}
            />
            {query.data.staged.length === 0 &&
            query.data.unstaged.length === 0 &&
            query.data.untracked.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                Working tree is clean.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function BranchHeader({
  branch,
  ahead,
  behind,
}: {
  branch: string;
  ahead: number;
  behind: number;
}) {
  return (
    <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
      <IconGitBranch size={12} aria-hidden />
      <span className="truncate font-mono">{branch || "(detached)"}</span>
      {ahead > 0 ? <span>↑{ahead}</span> : null}
      {behind > 0 ? <span>↓{behind}</span> : null}
    </div>
  );
}

function Section({
  label,
  count,
  files,
  onOpenDiff,
}: {
  label: string;
  count: number;
  files: ChangedFile[];
  onOpenDiff: (path: string) => void;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label} <span className="text-muted-foreground/60">· {count}</span>
      </div>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={`${label}:${f.path}`}>
            <FileRow
              path={f.path}
              status={f.status}
              onClick={() => onOpenDiff(f.path)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionUntracked({
  count,
  files,
  onOpenDiff,
}: {
  count: number;
  files: string[];
  onOpenDiff: (path: string) => void;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Untracked <span className="text-muted-foreground/60">· {count}</span>
      </div>
      <ul className="space-y-0.5">
        {files.map((p) => (
          <li key={`untracked:${p}`}>
            <FileRow
              path={p}
              status="untracked"
              onClick={() => onOpenDiff(p)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileRow({
  path,
  status,
  onClick,
}: {
  path: string;
  status: ChangedFile["status"];
  onClick: () => void;
}) {
  const tone = STATUS_TONE[status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50"
      title={path}
    >
      <IconFile
        size={12}
        className="shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
      <Badge
        variant="outline"
        className={cn("h-4 px-1 font-mono text-[9px] uppercase", tone)}
      >
        {STATUS_LETTER[status]}
      </Badge>
    </button>
  );
}

const STATUS_LETTER: Record<ChangedFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

const STATUS_TONE: Record<ChangedFile["status"], string> = {
  modified: "border-amber-500/30 text-amber-700 dark:text-amber-300",
  added: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  deleted: "border-red-500/30 text-red-700 dark:text-red-300",
  renamed: "border-blue-500/30 text-blue-700 dark:text-blue-300",
  untracked: "border-muted-foreground/30 text-muted-foreground",
};
