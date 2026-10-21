import { useActionQuery } from "@agent-native/core/client/hooks";
import { useLocale } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconHistory } from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { RunStatusChip } from "./RunStatusChip";
import { anyRunInFlight, runStarter } from "./workflow-list-model";
import { useWorkflowStrings } from "./workflow-strings";
import { formatRelativeTime } from "./workflow-time";
import type { ListRunsResult, RunView } from "./workflow-types";

const NO_RUN = "__none__";
const RECENT_RUNS = 25;
const WATCH_INTERVAL_MS = 2_000;

interface RunPickerProps {
  factoryId: string;
  workflowId: string;
  /** The version the canvas shows; a run of another version is flagged. */
  currentVersion: number;
  runId: string | null;
  onSelect: (runId: string | null) => void;
}

function RunLabel({
  run,
  now,
  currentVersion,
}: {
  run: RunView;
  now: number;
  currentVersion: number;
}) {
  const ws = useWorkflowStrings();
  const { locale } = useLocale();

  const when = formatRelativeTime(run.finishedAt ?? run.startedAt, now, locale);
  const starter = runStarter(run.startedBy);
  return (
    <span className="flex items-center gap-2">
      <RunStatusChip status={run.status} triggerKind={run.triggerKind} />
      {when ? <span className="text-muted-foreground">{when}</span> : null}
      {starter ? (
        <span className="max-w-32 truncate text-xs text-muted-foreground">
          {starter}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {ws.runPicker.version(run.graphVersion)}
      </span>
      {run.graphVersion !== currentVersion ? (
        <span
          role="img"
          aria-label={ws.runPicker.olderVersion(
            run.graphVersion,
            currentVersion,
          )}
          title={ws.runPicker.olderVersion(run.graphVersion, currentVersion)}
        >
          <IconAlertTriangle
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
        </span>
      ) : null}
    </span>
  );
}

/** The picker's one-line label for the run on the canvas; the tooltip carries the rest. */
function SelectedRun({
  run,
  now,
  currentVersion,
}: {
  run: RunView;
  now: number;
  currentVersion: number;
}) {
  const ws = useWorkflowStrings();
  const { locale } = useLocale();

  const when = formatRelativeTime(run.finishedAt ?? run.startedAt, now, locale);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <RunStatusChip status={run.status} triggerKind={run.triggerKind} />
      <span className="min-w-0 truncate text-muted-foreground">
        {[when, ws.runPicker.version(run.graphVersion)]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {run.graphVersion !== currentVersion ? (
        <IconAlertTriangle
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      ) : null}
    </span>
  );
}

/** Everything the one-line label leaves out, as plain lines. */
function SelectedRunDetail({
  run,
  now,
  currentVersion,
}: {
  run: RunView;
  now: number;
  currentVersion: number;
}) {
  const ws = useWorkflowStrings();
  const { locale } = useLocale();

  const when = formatRelativeTime(run.finishedAt ?? run.startedAt, now, locale);
  const kind =
    run.triggerKind === "schedule" ? null : ws.runKind[run.triggerKind];
  const summary = [
    kind,
    ws.runStatus[run.status],
    when,
    runStarter(run.startedBy),
    ws.runPicker.version(run.graphVersion),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <span className="block">{summary}</span>
      {run.graphVersion !== currentVersion ? (
        <span className="block">
          {ws.runPicker.olderVersion(run.graphVersion, currentVersion)}
        </span>
      ) : null}
    </>
  );
}

/** Lights the canvas with a past run's steps, or clears it back to the plain graph. */
export function RunPicker({
  factoryId,
  workflowId,
  currentVersion,
  runId,
  onSelect,
}: RunPickerProps) {
  const ws = useWorkflowStrings();

  const runsQuery = useActionQuery<ListRunsResult>(
    "list-factory-workflow-runs",
    { factoryId, workflowId, limit: RECENT_RUNS },
    {
      refetchInterval: (query) =>
        anyRunInFlight(query.state.data as ListRunsResult | undefined)
          ? WATCH_INTERVAL_MS
          : false,
    },
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const runs = runsQuery.data?.runs ?? [];
  const selected = runs.find((run) => run.id === runId);
  // A run opened from a link may be older than the page of recent ones.
  const unlisted = runId !== null && !selected;
  // Left undefined, the trigger shows its placeholder.
  let label: ReactNode;
  if (selected) {
    label = (
      <SelectedRun run={selected} now={now} currentVersion={currentVersion} />
    );
  } else if (unlisted) {
    label = <span className="block truncate">{runId}</span>;
  }

  return (
    <Select
      value={runId ?? ""}
      onValueChange={(value) => onSelect(value === NO_RUN ? null : value)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            size="sm"
            aria-label={ws.runPicker.pickerName}
            className="w-auto min-w-28 max-w-64 gap-2 whitespace-nowrap"
          >
            <IconHistory className="size-4 shrink-0" aria-hidden />
            <SelectValue placeholder={ws.runPicker.pickerName}>
              {label}
            </SelectValue>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {selected ? (
            <SelectedRunDetail
              run={selected}
              now={now}
              currentVersion={currentVersion}
            />
          ) : (
            ws.runPicker.pickerName
          )}
        </TooltipContent>
      </Tooltip>
      <SelectContent align="end">
        {runId ? (
          <SelectItem value={NO_RUN}>{ws.runPicker.hide}</SelectItem>
        ) : null}
        {unlisted ? <SelectItem value={runId}>{runId}</SelectItem> : null}
        {runs.map((run) => (
          <SelectItem key={run.id} value={run.id}>
            <RunLabel run={run} now={now} currentVersion={currentVersion} />
          </SelectItem>
        ))}
        {runsQuery.isError && runs.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-destructive">
            {ws.runPicker.listFailed}
          </div>
        ) : null}
        {runs.length === 0 && runsQuery.isSuccess ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {ws.runPicker.noRuns}
          </div>
        ) : null}
      </SelectContent>
    </Select>
  );
}
