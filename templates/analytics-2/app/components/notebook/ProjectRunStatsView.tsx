import { cellKindDefinition } from "@/lib/model/cell-types";
import type { Cell } from "@/lib/model/contracts";

import type { NotebookCellOutputState } from "./types";
import { cellIsRunnable } from "./utils";

const STATUS_LABELS = {
  queued: "Queued",
  running: "Running",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled",
} as const;

export function formatRunDuration(durationMs: number): string {
  const milliseconds = Math.round(durationMs);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const tenths = Math.round(durationMs / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)} s`;
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
}

function statusOf(run: NotebookCellOutputState | undefined): string {
  if (run == null) return "Not run";
  if (run.status != null) return STATUS_LABELS[run.status];
  if (run.error) return STATUS_LABELS.error;
  return run.output != null ? STATUS_LABELS.complete : "Not run";
}

export function ProjectRunStatsView({
  cells,
  titles,
  outputs,
}: {
  cells: readonly Cell[];
  titles: ReadonlyMap<string, string>;
  outputs: Readonly<Record<string, NotebookCellOutputState | undefined>>;
}) {
  const runnable = cells.filter((cell) => cellIsRunnable(cell.contents));
  return (
    <section
      aria-label="Run status"
      data-testid="project-run-stats-view"
      className="mx-auto w-full max-w-4xl p-6"
    >
      {runnable.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runnable cells</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Cell</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runnable.map((cell) => {
              const run = outputs[cell.id];
              return (
                <tr key={cell.id} className="border-b border-border">
                  <td className="py-2 pr-3 text-foreground">
                    {titles.get(cell.id) ?? "Untitled cell"}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {cellKindDefinition(cell.contents.kind).name}
                  </td>
                  <td className="py-2 pr-3 text-foreground">{statusOf(run)}</td>
                  <td className="py-2 text-right text-muted-foreground">
                    {run?.durationMs != null
                      ? formatRunDuration(run.durationMs)
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
