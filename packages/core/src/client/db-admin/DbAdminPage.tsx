import { IconDatabase, IconLoader2 } from "@tabler/icons-react";
/**
 * Database admin page — the shell that hosts the table browser, the table
 * editor, and the SQL editor.
 *
 * By default this is gated to Code mode for the core dev route. Trusted hosts
 * can opt out and point it at their own admin-gated API path.
 */
import { useEffect, useMemo, useState } from "react";

import type { DbAdminFilter } from "../../db-admin/types.js";
import { useCodeMode } from "../use-dev-mode.js";
import { cn } from "../utils.js";
import { SqlEditor } from "./SqlEditor.js";
import { TableBrowser } from "./TableBrowser.js";
import { TableEditor } from "./TableEditor.js";
import { useDbAdminAgentSync, useNavigateConsumer } from "./useAgentSync.js";
import { useOverview, type DbAdminRequestConfig } from "./useDbAdmin.js";

const DIALECT_LABEL: Record<string, string> = {
  postgres: "Postgres",
  sqlite: "SQLite",
  d1: "Cloudflare D1",
};

export interface DbAdminPageProps {
  apiBasePath?: string;
  cacheScope?: string;
  title?: string;
  subtitle?: string;
  codeModeGate?: boolean;
  syncNavigation?: boolean;
}

export function DbAdminPage({
  apiBasePath,
  cacheScope,
  title = "Database",
  subtitle,
  codeModeGate = true,
  syncNavigation = true,
}: DbAdminPageProps = {}) {
  const { canToggle, isLoading: devLoading } = useCodeMode();
  const requestConfig = useMemo<DbAdminRequestConfig | undefined>(() => {
    if (!apiBasePath && !cacheScope) return undefined;
    return { basePath: apiBasePath, scopeKey: cacheScope };
  }, [apiBasePath, cacheScope]);
  const { data: overview, isLoading: overviewLoading } =
    useOverview(requestConfig);

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [mode, setMode] = useState<"table" | "sql">("table");
  const [fkFilters, setFkFilters] = useState<DbAdminFilter[] | undefined>(
    undefined,
  );

  const tables = overview?.tables ?? [];
  const dialect = overview?.dialect ?? "sqlite";

  // Default selection to the first table once the overview loads.
  useEffect(() => {
    if (selectedTable === null && tables.length > 0) {
      setSelectedTable(tables[0].name);
    }
  }, [selectedTable, tables]);

  // Keep the agent's <current-screen> in sync, and let it drive navigation.
  useDbAdminAgentSync({ table: selectedTable, mode, enabled: syncNavigation });
  useNavigateConsumer((table) => {
    setSelectedTable(table);
    setMode("table");
    setFkFilters(undefined);
  }, syncNavigation);

  const tableNames = useMemo(() => tables.map((t) => t.name), [tables]);
  // SqlEditor degrades gracefully without per-table columns; pass an empty map.
  // (Table-name autocomplete still works; column autocomplete fills in lazily.)
  const columnsByTable = useMemo<Record<string, string[]>>(() => ({}), []);

  // ─── Code mode gate ──────────────────────────────────────────────────────
  if (codeModeGate && !devLoading && !canToggle) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-6">
        <div className="flex max-w-md flex-col items-center rounded-lg border bg-card p-8 text-center shadow-sm">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <IconDatabase
              className="h-6 w-6 text-muted-foreground"
              stroke={1.75}
            />
          </div>
          <h2 className="text-base font-semibold text-foreground">
            Code mode only
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Database admin is available in Code mode only.
          </p>
        </div>
      </div>
    );
  }

  const showInitialLoading =
    ((codeModeGate && devLoading) || overviewLoading) && !overview;

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <IconDatabase className="h-5 w-5 text-muted-foreground" stroke={1.75} />
        <span className="text-sm font-semibold">{title}</span>
        <span className="inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {DIALECT_LABEL[dialect] ?? dialect}
        </span>
        <span className="text-xs text-muted-foreground">
          {tables.length} {tables.length === 1 ? "table" : "tables"}
        </span>
        {subtitle ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </header>

      {/* Body: fixed sidebar + flexible main */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 border-r">
          {showInitialLoading ? (
            <SidebarSkeleton />
          ) : (
            <TableBrowser
              tables={tables}
              selected={selectedTable}
              onSelect={(t) => {
                setSelectedTable(t);
                setFkFilters(undefined);
              }}
              mode={mode}
              onModeChange={setMode}
            />
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {showInitialLoading ? (
            <MainLoading />
          ) : mode === "sql" ? (
            <SqlEditor
              dialect={dialect}
              tableNames={tableNames}
              columnsByTable={columnsByTable}
              requestConfig={requestConfig}
            />
          ) : selectedTable ? (
            <TableEditor
              key={selectedTable}
              table={selectedTable}
              dialect={dialect}
              requestConfig={requestConfig}
              initialFilters={fkFilters}
              onNavigateToRow={(t, filters) => {
                setSelectedTable(t);
                setMode("table");
                setFkFilters(filters);
              }}
            />
          ) : (
            <NoTableSelected />
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex h-full flex-col bg-card p-2">
      <div className="mb-2 h-9 animate-pulse rounded-md bg-muted" />
      <div className="mb-3 h-9 animate-pulse rounded-md bg-muted" />
      <div className="space-y-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-8 animate-pulse rounded-md bg-muted"
            style={{ opacity: 1 - i * 0.08 }}
          />
        ))}
      </div>
    </div>
  );
}

function MainLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <IconLoader2
        className={cn("h-5 w-5 animate-spin text-muted-foreground")}
      />
    </div>
  );
}

function NoTableSelected() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <div className="flex flex-col items-center">
        <IconDatabase
          className="mb-3 h-8 w-8 text-muted-foreground/50"
          stroke={1.5}
        />
        <p className="text-sm font-medium text-foreground">No table selected</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a table from the sidebar to browse and edit its rows.
        </p>
      </div>
    </div>
  );
}
