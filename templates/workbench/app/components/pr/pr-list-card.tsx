import { Link } from "react-router";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconExternalLink,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconLoader2,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Single PR card on the `/prs` list. Same hierarchy as the Attention Queue
 * cards but PR-specific affordances: status icon, age, CI status pill, and a
 * Review CTA that deep-links to `/prs/:owner/:repo/:n`.
 *
 * Multi-select is owned by the parent — this component accepts `selected` /
 * `onToggleSelect` to render the checkbox without owning the selection state.
 */
export interface PRListItem {
  itemKey: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  ageDays: number;
  updatedAt: string;
  ciStatus: "pending" | "success" | "failure" | "neutral" | "unknown";
}

interface PRListCardProps {
  pr: PRListItem;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function PRListCard({ pr, selected, onToggleSelect }: PRListCardProps) {
  const detailPath = `/prs/${pr.owner}/${pr.repo}/${pr.number}`;
  return (
    <Card
      className={cn(
        "group transition-all hover:-translate-y-px hover:shadow-md",
        selected && "ring-2 ring-primary",
      )}
    >
      <CardContent className="flex items-start gap-4 p-4">
        {onToggleSelect ? (
          <label
            className="mt-1 inline-flex shrink-0 cursor-pointer items-center"
            aria-label={selected ? "Deselect PR" : "Select PR"}
          >
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={onToggleSelect}
              className="size-4 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>
        ) : null}
        <PRStateIcon state={pr.state} isDraft={pr.isDraft} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Link
                to={detailPath}
                className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary group-hover:text-primary"
              >
                {pr.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-mono">
                  {pr.owner}/{pr.repo} #{pr.number}
                </span>
                {pr.author ? (
                  <>
                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                    {pr.author}
                  </>
                ) : null}
                <span className="mx-1.5 text-muted-foreground/40">·</span>
                {pr.ageDays > 0
                  ? `updated ${pr.ageDays}d ago`
                  : "updated today"}
              </p>
            </div>
            <CIStatusBadge status={pr.ciStatus} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" asChild className="cursor-pointer">
              <Link to={detailPath}>Review</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="cursor-pointer"
            >
              <a href={pr.url} target="_blank" rel="noreferrer">
                <IconExternalLink size={14} aria-hidden />
                GitHub
              </a>
            </Button>
            {pr.isDraft ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                Draft
              </Badge>
            ) : null}
            {pr.state === "merged" ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                Merged
              </Badge>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PRStateIcon({
  state,
  isDraft,
}: {
  state: PRListItem["state"];
  isDraft: boolean;
}) {
  if (isDraft) {
    return (
      <IconGitPullRequestDraft
        size={20}
        className="mt-1 shrink-0 text-muted-foreground"
        aria-label="Draft pull request"
      />
    );
  }
  if (state === "merged") {
    return (
      <IconGitPullRequest
        size={20}
        className="mt-1 shrink-0 text-purple-500"
        aria-label="Merged pull request"
      />
    );
  }
  if (state === "closed") {
    return (
      <IconGitPullRequestClosed
        size={20}
        className="mt-1 shrink-0 text-red-500"
        aria-label="Closed pull request"
      />
    );
  }
  return (
    <IconGitPullRequest
      size={20}
      className="mt-1 shrink-0 text-emerald-500"
      aria-label="Open pull request"
    />
  );
}

function CIStatusBadge({ status }: { status: PRListItem["ciStatus"] }) {
  switch (status) {
    case "success":
      return (
        <Badge
          variant="secondary"
          className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        >
          <IconCheck size={12} aria-hidden />
          CI green
        </Badge>
      );
    case "failure":
      return (
        <Badge variant="destructive" className="gap-1">
          <IconAlertTriangle size={12} aria-hidden />
          CI failed
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="outline" className="gap-1">
          <IconLoader2 size={12} className="animate-spin" aria-hidden />
          CI running
        </Badge>
      );
    case "neutral":
      return (
        <Badge variant="outline" className="gap-1">
          <IconCircleDashed size={12} aria-hidden />
          CI neutral
        </Badge>
      );
    default:
      return null;
  }
}
