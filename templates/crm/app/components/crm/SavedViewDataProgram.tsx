import { useActionMutation } from "@agent-native/core/client/hooks";
import { DataTable } from "@agent-native/toolkit/dashboard";
import { IconChartDots } from "@tabler/icons-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";

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
        <div className="mt-4 overflow-hidden rounded-md border border-border/70">
          <DataTable
            data={preview.sampleRows.slice(0, 5)}
            columns={preview.columns?.slice(0, 8).map((column) => column.name)}
            maxRows={5}
          />
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
