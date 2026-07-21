import { useActionMutation } from "@agent-native/core/client/hooks";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { IconChartDots } from "@tabler/icons-react";
import { useEffect, useRef } from "react";

interface ProgramPreview {
  ok: boolean;
  rowCount?: number;
  columns?: Array<{ name: string; type: string }>;
  sampleRows?: Array<Record<string, unknown>>;
  asOfMs?: number;
  cacheHit?: boolean;
  stale?: boolean;
  truncated?: boolean;
  message?: string;
  lastGoodRun?: {
    rowCount: number;
    columns: Array<{ name: string; type: string }>;
    sampleRows: Array<Record<string, unknown>>;
    truncated: boolean;
    asOfMs: number;
  };
}

export function SavedViewDataProgram({ data }: { data: unknown }) {
  const viewId = linkedProgramViewId(data);
  const lastRunViewId = useRef<string | undefined>(undefined);
  const run = useActionMutation<ProgramPreview, { viewId: string }>(
    "run-crm-saved-view-program" as never,
  );

  useEffect(() => {
    if (!viewId || lastRunViewId.current === viewId) return;
    lastRunViewId.current = viewId;
    run.mutate({ viewId });
  }, [run, viewId]);

  if (!viewId) return null;
  const preview = run.data?.ok ? run.data : run.data?.lastGoodRun;
  return (
    <section className="mx-5 mt-5 rounded-lg border border-border/70 bg-card p-4 sm:mx-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconChartDots className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Cross-source context</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {run.isPending
                ? "Running the saved data program…"
                : run.isError
                  ? "The saved data program is unavailable."
                  : run.data?.ok
                    ? `${run.data.rowCount ?? 0} rows from the linked data program.`
                    : run.data?.message ||
                      "Showing the last good program result."}
            </p>
          </div>
        </div>
        {preview ? (
          <div className="flex gap-2">
            {preview.truncated ? (
              <Badge variant="outline">Truncated</Badge>
            ) : null}
            {run.data?.ok && run.data.cacheHit ? (
              <Badge variant="secondary">Cached</Badge>
            ) : null}
          </div>
        ) : null}
      </div>
      {preview?.sampleRows?.length ? (
        <div className="mt-4 overflow-x-auto rounded-md border border-border/70">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                {preview.columns?.slice(0, 8).map((column) => (
                  <th key={column.name} className="px-3 py-2 font-medium">
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {preview.sampleRows.slice(0, 5).map((row, index) => (
                <tr key={index}>
                  {preview.columns?.slice(0, 8).map((column) => (
                    <td
                      key={column.name}
                      className="max-w-64 truncate px-3 py-2"
                    >
                      {displayCell(row[column.name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function linkedProgramViewId(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const appliedView = (data as { appliedView?: unknown }).appliedView;
  if (!appliedView || typeof appliedView !== "object") return undefined;
  const view = appliedView as Record<string, unknown>;
  return typeof view.id === "string" && typeof view.dataProgramId === "string"
    ? view.id
    : undefined;
}

function displayCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return "—";
}
