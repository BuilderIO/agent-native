/**
 * Shared data layer for the dev-mode database admin UI.
 *
 * Both sibling surfaces — TableEditor (`TableEditor.tsx`) and SqlEditor
 * (`SqlEditor.tsx`) — import their data access from this module so the request
 * shapes, error handling, and agent-write auto-refetch behavior stay
 * consistent.
 *
 * Every read hook folds the `["db-admin", "action"]` change counters into its
 * React Query key, so when the agent writes to the database (via an action that
 * emits a change event) the open table or query result refetches immediately —
 * the same "agent writes show up instantly" primitive templates use.
 */
import {
  useQuery,
  keepPreviousData,
  type UseQueryResult,
} from "@tanstack/react-query";

import type {
  DbAdminDialect,
  DbAdminTableSummary,
  DbAdminTableSchema,
  DbAdminRowsRequest,
  DbAdminRowsResult,
  DbAdminMutation,
  DbAdminMutationResult,
  DbAdminQueryResult,
} from "../../db-admin/types.js";
import { agentNativePath } from "../api-path.js";
import { useChangeVersions } from "../use-change-version.js";

// ─── Base path ───────────────────────────────────────────────────────────

export const dbAdminBasePath = agentNativePath("/_agent-native/db-admin");

export interface DbAdminRequestConfig {
  basePath?: string;
  scopeKey?: string;
}

function requestBasePath(config?: DbAdminRequestConfig): string {
  return (config?.basePath ?? dbAdminBasePath).replace(/\/+$/, "");
}

function requestScopeKey(config?: DbAdminRequestConfig): string {
  return config?.scopeKey ?? requestBasePath(config);
}

// ─── Tab id (request source) ───────────────────────────────────────────────

let cachedTabId: string | null = null;

/**
 * Best-effort stable per-tab identifier sent as `x-request-source` so the
 * backend can attribute changes to this tab (and skip echoing them back to the
 * originator). Mirrors the template `TAB_ID` convention without depending on a
 * template-only module.
 */
function getRequestSource(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedTabId) return cachedTabId;
  try {
    const existing = window.sessionStorage.getItem("agentnative.tabId");
    if (existing) {
      cachedTabId = existing;
      return existing;
    }
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tab-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem("agentnative.tabId", generated);
    cachedTabId = generated;
    return generated;
  } catch {
    return undefined;
  }
}

// ─── Low-level fetchers ────────────────────────────────────────────────────

interface ApiEnvelope {
  ok?: boolean;
  error?: string;
  needsConfirm?: boolean;
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const source = getRequestSource();
  if (source) headers["x-request-source"] = source;
  return headers;
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let json: (T & ApiEnvelope) | null = null;
  try {
    json = (await res.json()) as T & ApiEnvelope;
  } catch {
    json = null;
  }

  if (!res.ok || (json && json.ok === false)) {
    const message =
      (json && json.error) || `Request failed (HTTP ${res.status})`;
    const err = new Error(message);
    if (json && json.needsConfirm) {
      (err as Error & { needsConfirm?: boolean }).needsConfirm = true;
    }
    throw err;
  }

  if (!json) {
    throw new Error(`Empty response (HTTP ${res.status})`);
  }
  return json;
}

export async function dbAdminGet<T>(
  subpath: string,
  config?: DbAdminRequestConfig,
): Promise<T> {
  const res = await fetch(`${requestBasePath(config)}${subpath}`, {
    method: "GET",
    credentials: "include",
    headers: baseHeaders(),
  });
  return parseEnvelope<T>(res);
}

export async function dbAdminPost<T>(
  subpath: string,
  body: unknown,
  config?: DbAdminRequestConfig,
): Promise<T> {
  const res = await fetch(`${requestBasePath(config)}${subpath}`, {
    method: "POST",
    credentials: "include",
    headers: baseHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return parseEnvelope<T>(res);
}

// ─── Shared hook result shape ──────────────────────────────────────────────

export interface DbAdminQueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

function toState<T>(query: UseQueryResult<T, Error>): DbAdminQueryState<T> {
  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}

// ─── Overview ──────────────────────────────────────────────────────────────

export interface DbAdminOverview {
  dialect: DbAdminDialect;
  tables: DbAdminTableSummary[];
}

interface OverviewResponse {
  ok: true;
  dialect: DbAdminDialect;
  tables: DbAdminTableSummary[];
}

export function useOverview(
  config?: DbAdminRequestConfig,
): DbAdminQueryState<DbAdminOverview> {
  const version = useChangeVersions([
    "db-admin",
    "analytics-db-admin",
    "action",
  ]);
  const query = useQuery<DbAdminOverview, Error>({
    queryKey: ["db-admin", requestScopeKey(config), "overview", version],
    queryFn: async () => {
      const res = await dbAdminGet<OverviewResponse>("/overview", config);
      return { dialect: res.dialect, tables: res.tables };
    },
    placeholderData: keepPreviousData,
    staleTime: 2000,
  });
  return toState(query);
}

// ─── Table schema ──────────────────────────────────────────────────────────

interface SchemaResponse {
  ok: true;
  table: DbAdminTableSchema;
}

export function useTableSchema(
  table: string | null,
  config?: DbAdminRequestConfig,
): DbAdminQueryState<DbAdminTableSchema> {
  const version = useChangeVersions([
    "db-admin",
    "analytics-db-admin",
    "action",
  ]);
  const query = useQuery<DbAdminTableSchema, Error>({
    queryKey: ["db-admin", requestScopeKey(config), "schema", table, version],
    enabled: !!table,
    queryFn: async () => {
      const res = await dbAdminGet<SchemaResponse>(
        `/table/${encodeURIComponent(table!)}/schema`,
        config,
      );
      return res.table;
    },
    placeholderData: keepPreviousData,
    staleTime: 2000,
  });
  return toState(query);
}

// ─── Table rows ────────────────────────────────────────────────────────────

export function useTableRows(
  table: string | null,
  req: DbAdminRowsRequest,
  config?: DbAdminRequestConfig,
): DbAdminQueryState<DbAdminRowsResult> {
  const version = useChangeVersions([
    "db-admin",
    "analytics-db-admin",
    "action",
  ]);
  const query = useQuery<DbAdminRowsResult, Error>({
    queryKey: [
      "db-admin",
      requestScopeKey(config),
      "rows",
      table,
      req,
      version,
    ],
    enabled: !!table,
    queryFn: () =>
      dbAdminPost<DbAdminRowsResult>(
        `/table/${encodeURIComponent(table!)}/rows`,
        req,
        config,
      ),
    placeholderData: keepPreviousData,
    staleTime: 2000,
  });
  return toState(query);
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export async function mutateTable(
  table: string,
  mutation: DbAdminMutation,
  config?: DbAdminRequestConfig,
): Promise<DbAdminMutationResult> {
  return dbAdminPost<DbAdminMutationResult>(
    `/table/${encodeURIComponent(table)}/mutate`,
    mutation,
    config,
  );
}

export async function runQuery(
  sql: string,
  params?: unknown[],
  confirmDestructive?: boolean,
  config?: DbAdminRequestConfig,
): Promise<DbAdminQueryResult> {
  return dbAdminPost<DbAdminQueryResult>(
    "/query",
    {
      sql,
      params,
      confirmDestructive,
    },
    config,
  );
}
