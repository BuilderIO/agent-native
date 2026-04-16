import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { SqlChart } from "@/components/dashboard/SqlChart";
import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

export function meta() {
  return [{ title: "Chart" }];
}

const VALID_CHART_TYPES = new Set([
  "line",
  "area",
  "bar",
  "metric",
  "table",
  "pie",
]);
// `app-db` intentionally excluded from embed URLs — the base64 panel param
// lets the caller control the SQL, and running arbitrary SELECTs against
// the app DB would let an assistant-crafted chart URL read the `settings`
// table (which stores provider credentials). Saved dashboards still run
// app-db panels via /api/sql-query; only the URL-driven embed path is
// restricted to external data sources.
const VALID_SOURCES = new Set(["bigquery", "ga4"]);

function decodePanel(raw: string): SqlPanel | { error: string } {
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { error: "Invalid panel payload" };
    }
    const p = parsed as Record<string, unknown>;
    if (typeof p.sql !== "string" || !p.sql.trim()) {
      return { error: "Panel is missing sql" };
    }
    if (typeof p.source !== "string" || !VALID_SOURCES.has(p.source)) {
      return {
        error:
          "Panel source must be bigquery or ga4. app-db panels cannot be rendered in embed URLs.",
      };
    }
    if (
      typeof p.chartType !== "string" ||
      !VALID_CHART_TYPES.has(p.chartType)
    ) {
      return { error: "Panel chartType is not recognized" };
    }
    return {
      id: typeof p.id === "string" ? p.id : "embed",
      title: typeof p.title === "string" ? p.title : "",
      sql: p.sql,
      source: p.source as SqlPanel["source"],
      chartType: p.chartType as SqlPanel["chartType"],
      width: (p.width === 1 || p.width === 2
        ? p.width
        : 2) as SqlPanel["width"],
      config: (p.config && typeof p.config === "object"
        ? p.config
        : undefined) as SqlPanel["config"],
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to decode panel" };
  }
}

function ChartError({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="text-xs text-muted-foreground text-center max-w-md">
        <div className="font-medium text-foreground">Chart unavailable</div>
        <div className="mt-1">{message}</div>
      </div>
    </div>
  );
}

export default function ChartRoute() {
  const [params] = useSearchParams();
  const raw = params.get("panel");

  const result = useMemo(() => {
    if (!raw) return { error: "Missing panel parameter" };
    return decodePanel(raw);
  }, [raw]);

  if ("error" in result) {
    return <ChartError message={result.error} />;
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-transparent p-2">
      {result.title && (
        <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">
          {result.title}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <SqlChart panel={result} />
      </div>
    </div>
  );
}
