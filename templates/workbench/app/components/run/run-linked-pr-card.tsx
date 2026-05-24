import { Link } from "react-router";
import { IconArrowRight, IconGitPullRequest } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "./time";

interface RunLinkedPrCardProps {
  pr: {
    owner: string;
    repo: string;
    number: number;
    linkedAt: string;
  };
}

/**
 * "Linked PR" card surfaced in the right rail when `find-pr-from-run`
 * returns a hit. Clicking jumps to the PR Room.
 *
 * PRD calls this out as the cross-room "magic moment" — the run produced
 * a PR, the PR is open in another room, and Workbench makes that
 * relationship a one-click trip.
 */
export function RunLinkedPrCard({ pr }: RunLinkedPrCardProps) {
  const path = `/prs/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/${pr.number}`;
  const linkedAtMs = Date.parse(pr.linkedAt);
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
          <span className="font-semibold">Linked PR</span>
          {Number.isFinite(linkedAtMs) ? (
            <span>{formatRelativeTime(linkedAtMs, { suffix: "ago" })}</span>
          ) : null}
        </div>
        <Link
          to={path}
          className="flex items-start gap-3 rounded-md p-2 -m-2 hover:bg-emerald-500/10"
        >
          <IconGitPullRequest
            size={18}
            className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {pr.owner}/{pr.repo} #{pr.number}
            </div>
            <div className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              Open in PR Room
              <IconArrowRight size={12} aria-hidden />
            </div>
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}
