import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import {
  IconGitBranch,
  IconGitPullRequest,
  IconFile,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CreatePrDialog } from "@/components/code/create-pr-dialog";
import { Badge } from "@/components/ui/badge";

interface ChangesResult {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  staged: Array<{ path: string; status: string }>;
  unstaged: Array<{ path: string; status: string }>;
  untracked: string[];
}

interface SourceControlPanelProps {
  workspaceId: string;
  onOpenDiff: (path: string) => void;
}

/**
 * Source Control panel — the "ship it" surface. Shows the current
 * branch and a count summary of changes, with a single primary
 * "Create PR" button that opens the {@link CreatePrDialog}.
 *
 * The dialog handles the actual commit + push + PR creation via the
 * `create-pr-from-changes` action.
 */
export function SourceControlPanel({
  workspaceId,
  onOpenDiff,
}: SourceControlPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const dirty =
    (query.data?.staged.length ?? 0) +
    (query.data?.unstaged.length ?? 0) +
    (query.data?.untracked.length ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Source Control
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
        {query.isPending ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Loading…
          </div>
        ) : !query.data?.isRepo ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            This workspace isn't a git repository.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-background p-3">
              <div className="flex items-center gap-2">
                <IconGitBranch
                  size={14}
                  aria-hidden
                  className="text-muted-foreground"
                />
                <span className="truncate font-mono text-xs">
                  {query.data.branch || "(detached)"}
                </span>
                {query.data.ahead ? (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    ↑{query.data.ahead}
                  </Badge>
                ) : null}
                {query.data.behind ? (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    ↓{query.data.behind}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {dirty === 0
                  ? "No changes to commit."
                  : `${dirty} file${dirty === 1 ? "" : "s"} changed`}
              </p>
            </div>

            <Button
              size="sm"
              className="w-full cursor-pointer"
              disabled={dirty === 0}
              onClick={() => setDialogOpen(true)}
            >
              <IconGitPullRequest size={14} aria-hidden />
              Create PR from changes
            </Button>

            <ChangeSummary
              files={[
                ...query.data.staged.map((f) => ({
                  path: f.path,
                  status: f.status,
                })),
                ...query.data.unstaged.map((f) => ({
                  path: f.path,
                  status: f.status,
                })),
                ...query.data.untracked.map((p) => ({
                  path: p,
                  status: "untracked",
                })),
              ]}
              onOpenDiff={onOpenDiff}
            />
          </div>
        )}
      </div>
      <CreatePrDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspaceId={workspaceId}
        currentBranch={query.data?.branch ?? null}
        onCreated={(result) => {
          setDialogOpen(false);
          query.refetch();
          if (result.prUrl) {
            toast.success(
              `Opened PR #${result.prNumber} in ${result.owner}/${result.repo}`,
              {
                description: result.prUrl,
                action: {
                  label: "Open",
                  onClick: () => window.open(result.prUrl, "_blank"),
                },
              },
            );
          }
        }}
      />
    </div>
  );
}

function ChangeSummary({
  files,
  onOpenDiff,
}: {
  files: Array<{ path: string; status: string }>;
  onOpenDiff: (path: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div>
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Will be included
      </div>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={`${f.status}:${f.path}`}>
            <button
              type="button"
              onClick={() => onOpenDiff(f.path)}
              className="flex w-full cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50"
              title={f.path}
            >
              <IconFile
                size={11}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono">
                {f.path}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
