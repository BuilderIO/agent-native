import { Link } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import { IconActivity, IconArrowRight, IconLinkOff } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * Right-rail Related tab on `/prs/:owner/:repo/:n`. v1 only shows the
 * cross-room "Linked Run" card (run that authored this PR via
 * `workbench_run_pr_links`). Linked issues + related PRs land in v1.1.
 *
 * The Linked Run card is the cross-room magic the PRD calls out: a PR
 * authored by a Workbench-monitored agent run shows a single-click path back
 * to that run's transcript.
 */
interface PRRelatedProps {
  owner: string;
  repo: string;
  number: number;
}

interface LinkedRunResult {
  runId: string | null;
  linkedAt?: string;
}

export function PRRelated({ owner, repo, number }: PRRelatedProps) {
  const query = useActionQuery<LinkedRunResult>(
    "find-run-that-authored-pr" as any,
    { owner, repo, number } as any,
  );

  return (
    <div className="space-y-3 px-3 py-3">
      <LinkedRunCard query={query} />
      <PlaceholderCard
        title="Linked issues"
        description="Cross-references to GitHub Issues that mention this PR. Lands in v1.1."
      />
      <PlaceholderCard
        title="Related PRs"
        description="PRs touching the same files, opened by the same author, or linked by branch. Lands in v1.1."
      />
    </div>
  );
}

function LinkedRunCard({
  query,
}: {
  query: ReturnType<typeof useActionQuery<LinkedRunResult>>;
}) {
  if (query.isPending) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          Checking for linked run…
        </CardContent>
      </Card>
    );
  }
  if (query.error) {
    return (
      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          Couldn't load linked run.
        </CardContent>
      </Card>
    );
  }
  const runId = query.data?.runId;
  if (!runId) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 p-3 text-xs text-muted-foreground">
          <IconLinkOff size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            No Workbench-monitored run authored this PR. When an agent run
            you're tracking produces a PR, a link appears here automatically.
          </span>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-2 pb-2">
        <IconActivity
          size={16}
          className="mt-0.5 text-emerald-500"
          aria-hidden
        />
        <div className="space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Linked Run
          </p>
          <p className="text-sm font-medium">
            Authored by Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              #{runId.slice(0, 12)}
            </code>
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Button asChild size="sm" variant="outline" className="cursor-pointer">
          <Link to={`/runs/${runId}`}>
            Open run
            <IconArrowRight size={14} aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PlaceholderCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  );
}

/** Re-export for symmetry — currently the Related tab is self-contained. */
export type { PRRelatedProps };
