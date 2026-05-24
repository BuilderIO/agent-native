import { Link, useParams } from "react-router";
import { IconActivity, IconArrowLeft } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { RoomHeader } from "@/components/room-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  RunStatusPill,
  type RunDisplayStatus,
} from "@/components/run/run-status-pill";
import { RunSummaryCard } from "@/components/run/run-summary-card";
import { RunTranscript } from "@/components/run/run-transcript";
import { RunTouchedFiles } from "@/components/run/run-touched-files";
import { RunArtifacts } from "@/components/run/run-artifacts";
import { RunActionBar } from "@/components/run/run-action-bar";
import { RunLinkedPrCard } from "@/components/run/run-linked-pr-card";

export function meta() {
  return [{ title: "Workbench — Run" }];
}

interface InspectRunResponse {
  runId: string;
  threadId: string;
  title: string;
  status: "running" | "completed" | "errored" | "aborted";
  displayStatus: RunDisplayStatus;
  startedAt: number;
  completedAt: number | null;
  heartbeatAt: number | null;
  lastProgressAt: number | null;
  source: string;
  events: Array<{ seq: number; event: Record<string, unknown> }>;
  toolCallCount: number;
  errorCount: number;
  touchedFiles: string[];
  currentBlocker: string | null;
  appearsStuck: boolean;
  canResume: boolean;
  canStop: boolean;
}

interface FindPrResponse {
  pr: {
    owner: string;
    repo: string;
    number: number;
    linkedAt: string;
  } | null;
}

/**
 * Single agent-native run inspector. Two-column body — transcript on the
 * left, touched files + artifacts + linked PR on the right. Sticky action
 * bar at the bottom for Stop / Resume.
 *
 * Polls the detail every 3s while the run is in flight so the transcript
 * keeps streaming. Completed/failed runs stop polling.
 */
export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const runId = id ?? "";

  const { data, isLoading, isError, error } =
    useActionQuery<InspectRunResponse | null>(
      "inspect-run",
      runId ? ({ runId } as any) : (undefined as any),
      {
        enabled: Boolean(runId),
        refetchInterval: (q) => {
          const r = q.state.data as InspectRunResponse | null | undefined;
          if (!r) return false;
          return r.displayStatus === "running" || r.displayStatus === "paused"
            ? 3_000
            : false;
        },
      },
    );

  const { data: linkedPr } = useActionQuery<FindPrResponse>(
    "find-pr-from-run",
    runId ? ({ runId } as any) : (undefined as any),
    { enabled: Boolean(runId) },
  );

  if (!runId) {
    return (
      <div className="flex h-full flex-col">
        <RoomHeader title="Run" subtitle="Run detail" />
        <div className="flex-1 overflow-auto px-6 py-6">
          <EmptyState
            icon={IconActivity}
            title="Run id missing"
            description="Pick a run from the list to inspect it."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/runs">
                  <IconArrowLeft size={14} aria-hidden /> Back to runs
                </Link>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <RunDetailSkeleton runId={runId} />;
  }

  if (isError || !data) {
    return (
      <div className="flex h-full flex-col">
        <RoomHeader title="Run" subtitle={`#${runId}`} />
        <div className="flex-1 overflow-auto px-6 py-6">
          <EmptyState
            icon={IconActivity}
            title="Run not found"
            description={
              error?.message ??
              "This run may have been deleted or it belongs to another user."
            }
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/runs">
                  <IconArrowLeft size={14} aria-hidden /> Back to runs
                </Link>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const isLive =
    data.displayStatus === "running" || data.displayStatus === "paused";
  const linkedPrHref = linkedPr?.pr
    ? `/prs/${encodeURIComponent(linkedPr.pr.owner)}/${encodeURIComponent(
        linkedPr.pr.repo,
      )}/${linkedPr.pr.number}`
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link
              to="/runs"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <IconArrowLeft size={12} aria-hidden />
              Runs
            </Link>
            <span>/</span>
            <span>Run #{shortId(data.runId)}</span>
          </div>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {data.title}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RunStatusPill status={data.displayStatus} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <RunSummaryCard
            startedAt={data.startedAt}
            completedAt={data.completedAt}
            source={data.source}
            displayStatus={data.displayStatus}
            toolCallCount={data.toolCallCount}
            touchedFileCount={data.touchedFiles.length}
            currentBlocker={data.currentBlocker}
            appearsStuck={data.appearsStuck}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Transcript
              </h2>
              <RunTranscript events={data.events} isLive={isLive} />
            </section>

            <aside className="space-y-4">
              {linkedPr?.pr ? <RunLinkedPrCard pr={linkedPr.pr} /> : null}
              <RunTouchedFiles
                files={data.touchedFiles}
                linkedPr={linkedPr?.pr ?? undefined}
              />
              <RunArtifacts events={data.events} />
            </aside>
          </div>

          <RunActionBar
            runId={data.runId}
            canResume={data.canResume}
            canStop={data.canStop}
            linkedPrHref={linkedPrHref}
          />
        </div>
      </div>
    </div>
  );
}

function shortId(runId: string): string {
  return runId.length > 12 ? `${runId.slice(0, 6)}…${runId.slice(-4)}` : runId;
}

function RunDetailSkeleton({ runId }: { runId: string }) {
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0 space-y-2">
          <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
          <div className="h-6 w-72 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-7 w-20 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-muted/60" />
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-md border bg-card"
                />
              ))}
            </div>
            <div className="space-y-3">
              <div className="h-32 animate-pulse rounded-md border bg-card" />
              <div className="h-32 animate-pulse rounded-md border bg-card" />
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only">Loading run {runId}</p>
    </div>
  );
}
