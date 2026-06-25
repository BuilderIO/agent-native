import {
  IconPlus,
  IconFilter,
  IconRefresh,
  IconTrash,
  IconAlertTriangle,
  IconCode,
  IconArrowBackUp,
  IconDeviceFloppy,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconLoader2,
  IconCheck,
  IconKeyOff,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  DbAdminDialect,
  DbAdminFilter,
  DbAdminForeignKey,
  DbAdminSort,
  DbAdminMutationResult,
} from "../../db-admin/types.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { cn } from "../utils.js";
import { useChangeset, pkStringFor } from "./changeset.js";
import { DataGrid, type GridRow, type ActiveCell } from "./DataGrid.js";
import { FilterBar } from "./FilterBar.js";
import { RowSidePanel, type RowSidePanelMode } from "./RowSidePanel.js";
import { loadGridState, saveGridState } from "./storage.js";
import { useTableSchema, useTableRows, mutateTable } from "./useDbAdmin.js";

export interface TableEditorProps {
  table: string;
  dialect: DbAdminDialect;
  initialFilters?: DbAdminFilter[];
  onNavigateToRow: (table: string, filters: DbAdminFilter[]) => void;
}

const DEFAULT_PAGE_SIZE = 100;
const PAGE_SIZES = [25, 50, 100, 250, 500];

export function TableEditor({
  table,
  dialect: _dialect,
  initialFilters,
  onNavigateToRow,
}: TableEditorProps) {
  // ─── Persisted view state ──────────────────────────────────────────────
  const persisted = useMemo(() => loadGridState(table), [table]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    persisted.pageSize ?? DEFAULT_PAGE_SIZE,
  );
  const [sort, setSort] = useState<DbAdminSort[]>(persisted.sort ?? []);
  const [filters, setFilters] = useState<DbAdminFilter[]>(
    initialFilters ?? persisted.filters ?? [],
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    persisted.columnWidths ?? {},
  );
  const [selectedPks, setSelectedPks] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveCell | null>(null);

  // Reset transient state when switching tables.
  useEffect(() => {
    const p = loadGridState(table);
    setPage(1);
    setPageSize(p.pageSize ?? DEFAULT_PAGE_SIZE);
    setSort(p.sort ?? []);
    setFilters(initialFilters ?? p.filters ?? []);
    setColumnWidths(p.columnWidths ?? {});
    setSelectedPks(new Set());
    setActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  // Persist view state.
  useEffect(() => {
    saveGridState(table, { columnWidths, sort, filters, pageSize });
  }, [table, columnWidths, sort, filters, pageSize]);

  // ─── Data ────────────────────────────────────────────────────────────────
  const schemaState = useTableSchema(table);
  const rowsReq = useMemo(
    () => ({ page, pageSize, sort, filters }),
    [page, pageSize, sort, filters],
  );
  const rowsState = useTableRows(table, rowsReq);

  const schema = schemaState.data;
  const changeset = useChangeset(schema);

  // ─── Toolbar UI state ──────────────────────────────────────────────────
  const [panel, setPanel] = useState<{
    mode: RowSidePanelMode;
    pk?: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewSql, setPreviewSql] = useState<string[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  // ─── Original rows map (pk → fetched row) ──────────────────────────────
  const originalRows = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of rowsState.data?.rows ?? []) {
      map.set(pkStringFor(schema, row), row);
    }
    return map;
  }, [rowsState.data, schema]);

  // ─── Build grid rows with staged edits applied ──────────────────────────
  const gridRows = useMemo<GridRow[]>(() => {
    const out: GridRow[] = [];
    // New rows first (top of grid, like Supabase).
    for (const nr of changeset.newRows) {
      out.push({
        pk: `new:${nr._localId}`,
        localId: nr._localId,
        isNew: true,
        values: { ...nr.values },
      });
    }
    for (const row of rowsState.data?.rows ?? []) {
      const pk = pkStringFor(schema, row);
      const staged = changeset.edits.get(pk);
      out.push({
        pk,
        values: staged ? { ...row, ...staged } : row,
        isDeleted: changeset.deletedKeys.has(pk),
      });
    }
    return out;
  }, [
    rowsState.data,
    schema,
    changeset.newRows,
    changeset.edits,
    changeset.deletedKeys,
  ]);

  // ─── Cell commit routing (existing rows vs new rows) ────────────────────
  const onCellCommit = useCallback(
    (row: GridRow, col: string, value: unknown) => {
      if (row.isNew && row.localId) {
        changeset.setNewRowCell(row.localId, col, value);
      } else {
        changeset.setCell(row.pk, col, value);
      }
    },
    [changeset],
  );

  const isCellDirty = useCallback(
    (row: GridRow, col: string) => {
      if (row.isNew) return true;
      return changeset.isCellDirty(row.pk, col);
    },
    [changeset],
  );

  const onToggleDelete = useCallback(
    (row: GridRow) => {
      if (row.isNew && row.localId) {
        changeset.removeNewRow(row.localId);
        return;
      }
      changeset.deleteRows([row.pk]);
    },
    [changeset],
  );

  // ─── FK navigation ───────────────────────────────────────────────────────
  const onFkNavigate = useCallback(
    (fk: DbAdminForeignKey, value: unknown) => {
      onNavigateToRow(fk.refTable, [{ column: fk.refColumn, op: "eq", value }]);
    },
    [onNavigateToRow],
  );

  // ─── Commit / preview ──────────────────────────────────────────────────
  const runCommit = useCallback(
    async (dryRun: boolean) => {
      const mutation = changeset.buildMutation(originalRows, dryRun);
      if (!mutation.inserts && !mutation.updates && !mutation.deletes) {
        return null;
      }
      return mutateTable(table, mutation);
    },
    [changeset, originalRows, table],
  );

  const handlePreview = useCallback(async () => {
    setCommitError(null);
    try {
      const res = await runCommit(true);
      setPreviewSql(res ? res.sql : []);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    }
  }, [runCommit]);

  const handleCommit = useCallback(async () => {
    const hasDeletes = changeset.deletedKeys.size > 0;
    if (hasDeletes && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setCommitting(true);
    setCommitError(null);
    try {
      const res: DbAdminMutationResult | null = await runCommit(false);
      changeset.discardAll();
      setSelectedPks(new Set());
      setConfirmDelete(false);
      rowsState.refetch();
      schemaState.refetch();
      if (res) {
        const parts: string[] = [];
        if (res.inserted) parts.push(`${res.inserted} inserted`);
        if (res.updated) parts.push(`${res.updated} updated`);
        if (res.deleted) parts.push(`${res.deleted} deleted`);
        showToast(parts.length ? parts.join(", ") : "No changes");
      }
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [changeset, confirmDelete, runCommit, rowsState, schemaState, showToast]);

  // ─── Cmd/Ctrl+S to commit ──────────────────────────────────────────────
  const commitRef = useRef(handleCommit);
  commitRef.current = handleCommit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        typeof e.key === "string" &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        if (changeset.isDirty) void commitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeset.isDirty]);

  // ─── Bulk delete from selection ────────────────────────────────────────
  const onBulkDelete = useCallback(() => {
    const pks = [...selectedPks].filter((pk) => !pk.startsWith("new:"));
    changeset.deleteRows(pks);
    setSelectedPks(new Set());
  }, [selectedPks, changeset]);

  // ─── Render ──────────────────────────────────────────────────────────────
  const total = rowsState.data?.total ?? schema?.rowCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (schemaState.error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-destructive">
        <IconAlertTriangle className="mr-2 h-4 w-4" />
        {schemaState.error.message}
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading {table}…
      </div>
    );
  }

  const noPk = schema.primaryKey.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">
              {table}
            </span>
            <span className="text-xs text-muted-foreground">
              {total.toLocaleString()} rows
            </span>
            {schema.type === "view" && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                view
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <ToolbarButton
              icon={<IconRefresh className="h-3.5 w-3.5" />}
              label="Refresh"
              onClick={() => {
                rowsState.refetch();
                schemaState.refetch();
              }}
            />
            {!noPk && schema.type === "table" && (
              <ToolbarButton
                icon={<IconPlus className="h-3.5 w-3.5" />}
                label="Insert"
                onClick={() => setPanel({ mode: "insert" })}
                primary
              />
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <IconFilter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <FilterBar
            columns={schema.columns}
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setPage(1);
            }}
          />
        </div>

        {/* No-PK warning */}
        {noPk && schema.type === "table" && (
          <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
            <IconKeyOff className="h-3.5 w-3.5" />
            This table has no primary key — editing and row deletion are
            disabled.
          </div>
        )}

        {/* Selection / changeset bar */}
        {(selectedPks.size > 0 || changeset.isDirty) && (
          <div className="flex flex-wrap items-center gap-2">
            {selectedPks.size > 0 && (
              <>
                <span className="text-xs text-muted-foreground">
                  {selectedPks.size} selected
                </span>
                {!noPk && (
                  <button
                    type="button"
                    onClick={onBulkDelete}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                    Delete selected
                  </button>
                )}
                <span className="h-4 w-px bg-border" />
              </>
            )}

            {changeset.isDirty && (
              <>
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  {changeset.pendingCount} pending change
                  {changeset.pendingCount === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={changeset.discardAll}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <IconArrowBackUp className="h-3.5 w-3.5" />
                  Discard
                </button>
                <PreviewSqlButton
                  onPreview={handlePreview}
                  sql={previewSql}
                  onClear={() => setPreviewSql(null)}
                  error={commitError}
                />
                <button
                  type="button"
                  onClick={() => void handleCommit()}
                  disabled={committing}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {committing ? (
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <IconDeviceFloppy className="h-3.5 w-3.5" />
                  )}
                  Commit
                </button>
              </>
            )}
          </div>
        )}

        {commitError && !previewSql && (
          <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            <IconAlertTriangle className="h-3.5 w-3.5" />
            {commitError}
          </div>
        )}
      </div>

      {/* Grid */}
      <DataGrid
        schema={schema}
        rows={gridRows}
        isLoading={rowsState.isLoading}
        pageSize={pageSize}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        selectedPks={selectedPks}
        onSelectionChange={setSelectedPks}
        columnWidths={columnWidths}
        onColumnWidthsChange={setColumnWidths}
        active={active}
        onActiveChange={setActive}
        editable={!noPk && schema.type === "table"}
        onCellCommit={onCellCommit}
        isCellDirty={isCellDirty}
        onToggleDelete={onToggleDelete}
        onNavigateToRow={onFkNavigate}
      />

      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-6 rounded border border-border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-2">
            Page {page} of {totalPages}
          </span>
          <PagerButton
            disabled={page <= 1}
            onClick={() => setPage(1)}
            icon={<IconChevronsLeft className="h-3.5 w-3.5" />}
          />
          <PagerButton
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            icon={<IconChevronLeft className="h-3.5 w-3.5" />}
          />
          <PagerButton
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            icon={<IconChevronRight className="h-3.5 w-3.5" />}
          />
          <PagerButton
            disabled={page >= totalPages}
            onClick={() => setPage(totalPages)}
            icon={<IconChevronsRight className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {/* Row side panel */}
      {panel && (
        <RowSidePanel
          schema={schema}
          mode={panel.mode}
          row={panel.pk ? originalRows.get(panel.pk) : undefined}
          staged={panel.pk ? changeset.edits.get(panel.pk) : undefined}
          onClose={() => setPanel(null)}
          onSave={(values) => {
            if (panel.mode === "insert") {
              changeset.addRow(values);
            } else if (panel.pk) {
              changeset.setCells(panel.pk, values);
            }
          }}
        />
      )}

      {/* Destructive commit confirmation */}
      {confirmDelete && (
        <ConfirmModal
          title="Commit deletions?"
          body={`${changeset.deletedKeys.size} row${
            changeset.deletedKeys.size === 1 ? "" : "s"
          } will be permanently deleted along with any other pending changes. This cannot be undone.`}
          confirmLabel="Delete and commit"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void handleCommit()}
        />
      )}

      {/* Toast */}
      {toast &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed bottom-4 right-4 z-[500] flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground shadow-lg">
            <IconCheck className="h-4 w-4 text-emerald-500" />
            {toast}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── Small UI atoms ────────────────────────────────────────────────────────

function ToolbarButton({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function PagerButton({
  disabled,
  onClick,
  icon,
}: {
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-border p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

function PreviewSqlButton({
  onPreview,
  sql,
  onClear,
  error,
}: {
  onPreview: () => void;
  sql: string[] | null;
  onClear: () => void;
  error: string | null;
}) {
  return (
    <Popover
      open={sql !== null}
      onOpenChange={(o) => {
        if (!o) onClear();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <IconCode className="h-3.5 w-3.5" />
          Preview SQL
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[34rem] p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-medium text-foreground">
          Preview SQL
        </div>
        <div className="max-h-80 overflow-auto p-3">
          {error ? (
            <div className="text-xs text-destructive">{error}</div>
          ) : sql && sql.length > 0 ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground">
              {sql.join(";\n")}
            </pre>
          ) : (
            <div className="text-xs text-muted-foreground">
              No statements to run.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[450] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl">
        <div className="mb-1 flex items-center gap-2">
          {destructive && (
            <IconAlertTriangle className="h-4 w-4 text-destructive" />
          )}
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium text-primary-foreground",
              destructive
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-primary hover:bg-primary/90",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
