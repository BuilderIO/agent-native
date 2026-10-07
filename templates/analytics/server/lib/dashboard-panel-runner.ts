import type { CredentialContext } from "@agent-native/core/credentials";

import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { serializePanelSql } from "../../app/pages/adhoc/sql-dashboard/panel-sql";
import type { SqlPanel } from "../../app/pages/adhoc/sql-dashboard/types";
import {
  normalizeDashboardPanelQuery,
  type DashboardPanelSource,
} from "./dashboard-panel-query";
import { resolveAnalyticsPanelSource } from "./dashboard-panel-source-resolver";

export type ReportPanelData =
  | {
      status: "rows";
      rows: Array<Record<string, unknown>>;
      schema: Array<{ name: string; type: string }>;
      truncated?: boolean;
    }
  | { status: "query-failed"; message: string; timedOut?: true }
  | { status: "missing-credential"; message: string }
  | { status: "not-emailable"; message: string };

class PanelTimeoutError extends Error {}

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:bearer|token|api[_-]?key|secret|password|authorization)\b["'\s:=]+\S+/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

function redactSecrets(message: string): string {
  const redacted = SECRET_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, "[redacted]"),
    message,
  );
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

export function describeError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return redactSecrets(raw || "Unknown error");
}

function panelFailureError(result: object): string | null {
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && error ? error : null;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new PanelTimeoutError(message)),
        timeoutMs,
      );
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    void promise.catch(() => undefined);
  });
}

/** The exact query string the dashboard page sends for this panel. */
export function buildPanelQuery(
  panel: Pick<SqlPanel, "source" | "sql" | "config">,
  vars: Record<string, string>,
): string {
  const source = panel.source as DashboardPanelSource;
  return normalizeDashboardPanelQuery(
    source,
    interpolateDashboardPanelSql(serializePanelSql(panel.sql), vars, panel),
  );
}

/**
 * Runs a built panel query through the same source resolver the browser's
 * query-dashboard-panel action uses, so reports and write verification see
 * what the page sees. `timedOut` marks a deadline or abort, which is a
 * retryable state, never a property of the panel.
 */
export async function runResolvedPanel(args: {
  source: DashboardPanelSource;
  query: string;
  ctx: CredentialContext;
  timeoutMs: number;
  signal?: AbortSignal;
  forceRefresh?: boolean;
}): Promise<ReportPanelData> {
  const { source, query, ctx, timeoutMs, signal, forceRefresh } = args;
  const startedAt = Date.now();
  try {
    const result = await withTimeout(
      resolveAnalyticsPanelSource(
        {
          source,
          query,
          timeoutMs,
          ...(forceRefresh ? { forceRefresh: true } : {}),
          ...(signal ? { signal } : {}),
        },
        ctx,
      ),
      timeoutMs,
      `Panel query timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
    const failure = panelFailureError(result);
    if (failure === "missing_api_key") {
      const message = (result as { message?: unknown }).message;
      return {
        status: "missing-credential",
        message: redactSecrets(
          typeof message === "string" && message
            ? message
            : "This panel's data source is not connected",
        ),
      };
    }
    if (failure) {
      const message = (result as { message?: unknown }).message;
      return {
        status: "query-failed",
        message: redactSecrets(
          typeof message === "string" && message ? message : failure,
        ),
      };
    }

    const rows = (result as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) {
      return {
        status: "query-failed",
        message: "Panel source returned no row set",
      };
    }
    const schema = (result as { schema?: unknown }).schema;
    return {
      status: "rows",
      rows: rows as Array<Record<string, unknown>>,
      schema: Array.isArray(schema)
        ? (schema as Array<{ name: string; type: string }>)
        : [],
      ...((result as { truncated?: unknown }).truncated
        ? { truncated: true }
        : {}),
    };
  } catch (error) {
    const timedOut =
      error instanceof PanelTimeoutError ||
      signal?.aborted === true ||
      Date.now() - startedAt >= timeoutMs;
    return {
      status: "query-failed",
      message: describeError(error),
      ...(timedOut ? { timedOut: true as const } : {}),
    };
  }
}
