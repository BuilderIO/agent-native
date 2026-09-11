import {
  IconTable,
  IconEye,
  IconSearch,
  IconDatabaseOff,
  IconX,
} from "@tabler/icons-react";
/**
 * Left sidebar for the database admin: a mode toggle (Table Editor / SQL
 * Editor), a debounced search box, and a scrollable list of tables and views
 * with row counts.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { DbAdminTableSummary } from "../../db-admin/types.js";
import { cn } from "../utils.js";

export interface TableBrowserProps {
  tables: DbAdminTableSummary[];
  selected: string | null;
  onSelect: (table: string) => void;
  mode: "table" | "sql";
  onModeChange: (mode: "table" | "sql") => void;
}

function formatCount(count: number | null): string {
  if (count === null) return "";
  if (count < 1000) return String(count);
  if (count < 1_000_000)
    return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function useDebounced(value: string, delay = 150): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function TableBrowser({
  tables,
  selected,
  onSelect,
  mode,
  onModeChange,
}: TableBrowserProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = q
      ? tables.filter((t) => t.name.toLowerCase().includes(q))
      : tables;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [tables, debouncedSearch]);

  return (
    <div className="flex h-full w-full flex-col bg-card">
      {/* Mode toggle */}
      <div className="border-b p-2">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          <ModeButton
            active={mode === "table"}
            onClick={() => onModeChange("table")}
          >
            Table Editor
          </ModeButton>
          <ModeButton
            active={mode === "sql"}
            onClick={() => onModeChange("sql")}
          >
            SQL Editor
          </ModeButton>
        </div>
      </div>

      {/* Search */}
      <div className="border-b p-2">
        <div className="relative">
          <IconSearch
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            stroke={1.75}
          />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables…"
            spellCheck={false}
            className={cn(
              "h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm",
              "ring-offset-background placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            )}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Table list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <EmptyState hasSearch={!!debouncedSearch.trim()} />
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((t) => {
              const isSelected = t.name === selected;
              const Icon = t.type === "view" ? IconEye : IconTable;
              return (
                <li key={t.name}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.name)}
                    aria-current={isSelected ? "true" : undefined}
                    title={t.name}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      "transition-colors",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isSelected
                          ? "text-accent-foreground"
                          : "text-muted-foreground",
                      )}
                      stroke={1.75}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {t.name}
                    </span>
                    {t.rowCount !== null && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatCount(t.rowCount)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer rounded-sm px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <IconDatabaseOff
        className="mb-2 h-6 w-6 text-muted-foreground/60"
        stroke={1.5}
      />
      <p className="text-sm font-medium text-foreground">
        {hasSearch ? "No matches" : "No tables yet"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {hasSearch
          ? "Try a different search term."
          : "Tables will appear here once created."}
      </p>
    </div>
  );
}
