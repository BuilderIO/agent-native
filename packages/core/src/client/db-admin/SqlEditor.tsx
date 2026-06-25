import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  IconPlayerPlayFilled,
  IconHistory,
  IconBookmark,
  IconBookmarkPlus,
  IconDownload,
  IconAlertTriangle,
  IconLoader2,
  IconTrash,
  IconX,
  IconChevronDown,
} from "@tabler/icons-react";
import CodeMirror, {
  type ReactCodeMirrorRef,
  EditorView,
  keymap,
  Prec,
} from "@uiw/react-codemirror";
/**
 * Production-grade SQL editor for the dev-mode database admin.
 *
 * Layout: a CodeMirror editor pane on top, a resizable results panel below.
 * Features schema-aware autocomplete, keyboard run shortcuts, history, named
 * snippets, CSV/JSON export, and a confirm modal for destructive statements.
 *
 * Data access goes through `runQuery` from `./useDbAdmin.js` (the shared
 * contract). On a destructive statement without confirmation, `runQuery` throws
 * an Error whose `needsConfirm` flag is `true`; we catch that and re-run after
 * the user confirms in a locally-built modal.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { DbAdminDialect } from "../../db-admin/types.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { cn } from "../utils.js";
import { toCSV, toJSON, downloadFile } from "./export-utils.js";
import { ResultsGrid } from "./ResultsGrid.js";
import {
  loadHistory,
  pushHistory,
  clearHistory,
  loadSnippets,
  saveSnippet,
  deleteSnippet,
  type SqlSnippet,
} from "./sql-storage.js";
import { runQuery } from "./useDbAdmin.js";

export interface SqlEditorProps {
  dialect: DbAdminDialect;
  tableNames: string[];
  columnsByTable: Record<string, string[]>;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number;
  durationMs: number;
}

// ─── Dark-mode detection ─────────────────────────────────────────────────────

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// ─── Statement-under-cursor helpers ──────────────────────────────────────────

/**
 * Best-effort split of a SQL buffer into statements by top-level `;`, ignoring
 * semicolons inside single/double quotes or line/block comments. Returns each
 * statement with its character offsets so we can pick the one under the cursor.
 */
function splitStatements(
  text: string,
): { sql: string; start: number; end: number }[] {
  const out: { sql: string; start: number; end: number }[] = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === ";") {
      out.push({ sql: text.slice(start, i + 1), start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < text.length) {
    out.push({ sql: text.slice(start), start, end: text.length });
  }
  return out;
}

/** Resolve which SQL to run given the current selection and cursor position. */
function resolveRunTarget(
  view: EditorView | undefined,
  buffer: string,
): string {
  if (!view) return buffer;
  const sel = view.state.selection.main;
  if (!sel.empty) {
    return view.state.sliceDoc(sel.from, sel.to);
  }
  const cursor = sel.head;
  const statements = splitStatements(buffer);
  const hit = statements.find((s) => cursor >= s.start && cursor <= s.end);
  return (hit?.sql ?? buffer).trim() || buffer;
}

// ─── Local modal primitive ───────────────────────────────────────────────────

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Toolbar button ──────────────────────────────────────────────────────────

function ToolbarButton({
  children,
  onClick,
  className,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "Cmd" : "Ctrl";

// ─── Main component ──────────────────────────────────────────────────────────

export function SqlEditor({
  dialect,
  tableNames,
  columnsByTable,
}: SqlEditorProps) {
  const isDark = useIsDark();
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const [value, setValue] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [history, setHistory] = useState<string[]>([]);
  const [snippets, setSnippets] = useState<SqlSnippet[]>([]);

  const [confirmSql, setConfirmSql] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [snippetName, setSnippetName] = useState("");

  // Editor height (px) — draggable splitter between editor and results.
  const [editorHeight, setEditorHeight] = useState(240);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );

  // Keep the latest buffer accessible inside CodeMirror keymap closures.
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setHistory(loadHistory());
    setSnippets(loadSnippets());
  }, []);

  // ─── Run logic ────────────────────────────────────────────────────────────

  const execute = useCallback(
    async (sqlText: string, confirmDestructive?: boolean) => {
      const trimmed = sqlText.trim();
      if (!trimmed) return;
      setRunning(true);
      setError(null);
      try {
        const res = await runQuery(trimmed, undefined, confirmDestructive);
        setResult({
          columns: res.columns,
          rows: res.rows,
          rowsAffected: res.rowsAffected,
          durationMs: res.durationMs,
        });
        if (res.columns.length > 0) {
          setStatus(`${res.rows.length} rows · ${res.durationMs}ms`);
        } else {
          setStatus(
            `Query OK · ${res.rowsAffected} rows affected · ${res.durationMs}ms`,
          );
        }
        setHistory(pushHistory(trimmed));
      } catch (err) {
        const e = err as Error & { needsConfirm?: boolean };
        if (e.needsConfirm) {
          setConfirmSql(trimmed);
        } else {
          setError(e.message || "Query failed");
          setStatus(null);
        }
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  const runActiveStatement = useCallback(() => {
    const view = editorRef.current?.view;
    const target = resolveRunTarget(view, valueRef.current);
    void execute(target);
  }, [execute]);

  const runWholeBuffer = useCallback(() => {
    void execute(valueRef.current);
  }, [execute]);

  const confirmAndRun = useCallback(() => {
    const sqlText = confirmSql;
    setConfirmSql(null);
    if (sqlText) void execute(sqlText, true);
  }, [confirmSql, execute]);

  // ─── CodeMirror extensions ──────────────────────────────────────────────

  const extensions = useMemo(() => {
    const langExt = sql({
      dialect: dialect === "postgres" ? PostgreSQL : undefined,
      schema: columnsByTable,
      tables: tableNames.map((t) => ({ label: t })),
      upperCaseKeywords: true,
    });

    const runKeymap = Prec.highest(
      keymap.of([
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: () => {
            runActiveStatement();
            return true;
          },
        },
        {
          key: "Mod-Shift-Enter",
          preventDefault: true,
          run: () => {
            runWholeBuffer();
            return true;
          },
        },
      ]),
    );

    return [runKeymap, langExt, EditorView.lineWrapping];
    // tableNames / columnsByTable identity is stable enough for our purposes;
    // re-derive when the dialect or schema reference changes.
  }, [dialect, columnsByTable, tableNames, runActiveStatement, runWholeBuffer]);

  // ─── Splitter drag ───────────────────────────────────────────────────────

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const delta = e.clientY - dragState.current.startY;
      const next = Math.min(
        Math.max(dragState.current.startHeight + delta, 120),
        640,
      );
      setEditorHeight(next);
    };
    const onUp = () => {
      dragState.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragState.current = { startY: e.clientY, startHeight: editorHeight };
    document.body.style.userSelect = "none";
  };

  // ─── Loading editor content from history / snippets ───────────────────────

  const loadIntoEditor = useCallback((sqlText: string) => {
    setValue(sqlText);
    // Focus and place cursor at end after the controlled value updates.
    requestAnimationFrame(() => {
      const view = editorRef.current?.view;
      if (view) {
        view.focus();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }
    });
  }, []);

  // ─── Export ────────────────────────────────────────────────────────────────

  const exportAs = (format: "csv" | "json") => {
    if (!result || result.columns.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (format === "csv") {
      downloadFile(
        `query-result-${stamp}.csv`,
        "text/csv;charset=utf-8",
        toCSV(result.columns, result.rows),
      );
    } else {
      downloadFile(
        `query-result-${stamp}.json`,
        "application/json",
        toJSON(result.rows),
      );
    }
  };

  // ─── Snippet save ────────────────────────────────────────────────────────

  const openSaveModal = () => {
    if (!value.trim()) return;
    setSnippetName("");
    setSaveModalOpen(true);
  };

  const commitSnippet = () => {
    const name = snippetName.trim();
    if (!name || !value.trim()) return;
    setSnippets(saveSnippet({ name, sql: value }));
    setSaveModalOpen(false);
  };

  const removeSnippet = (id: string) => {
    setSnippets(deleteSnippet(id));
  };

  // ─── Example queries (empty state) ─────────────────────────────────────────

  const firstTable = tableNames[0];
  const examples = useMemo(() => {
    const list: { label: string; sql: string }[] = [];
    if (firstTable) {
      list.push({
        label: `Select rows from ${firstTable}`,
        sql: `SELECT * FROM ${firstTable} LIMIT 100;`,
      });
    }
    list.push({
      label: "List tables",
      sql:
        dialect === "postgres"
          ? "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
          : "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    });
    if (firstTable) {
      list.push({
        label: `Count rows in ${firstTable}`,
        sql: `SELECT COUNT(*) AS total FROM ${firstTable};`,
      });
    }
    return list;
  }, [firstTable, dialect]);

  const hasResults = result !== null;
  const canExport = hasResults && result!.columns.length > 0;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2">
        <button
          type="button"
          onClick={runActiveStatement}
          disabled={running || !value.trim()}
          title={`Run selection / statement (${MOD}+Enter)`}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <IconLoader2 size={14} className="animate-spin" />
          ) : (
            <IconPlayerPlayFilled size={14} />
          )}
          Run
        </button>

        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {MOD}+Enter runs selection / statement · {MOD}+Shift+Enter runs all
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* History */}
          <Popover>
            <PopoverTrigger asChild>
              <ToolbarButton title="Query history">
                <IconHistory size={14} />
                History
              </ToolbarButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold text-foreground">
                  Recent queries
                </span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      clearHistory();
                      setHistory([]);
                    }}
                    className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-auto py-1">
                {history.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No queries yet
                  </div>
                ) : (
                  history.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => loadIntoEditor(h)}
                      className="block w-full cursor-pointer truncate px-3 py-1.5 text-left font-mono text-[11px] text-foreground hover:bg-accent"
                      title={h}
                    >
                      {h.replace(/\s+/g, " ").trim()}
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Snippets */}
          <Popover>
            <PopoverTrigger asChild>
              <ToolbarButton title="Saved snippets">
                <IconBookmark size={14} />
                Snippets
              </ToolbarButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold text-foreground">
                  Saved snippets
                </span>
                <button
                  type="button"
                  onClick={openSaveModal}
                  disabled={!value.trim()}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconBookmarkPlus size={13} />
                  Save current
                </button>
              </div>
              <div className="max-h-80 overflow-auto py-1">
                {snippets.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No saved snippets
                  </div>
                ) : (
                  snippets.map((s) => (
                    <div
                      key={s.id}
                      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
                    >
                      <button
                        type="button"
                        onClick={() => loadIntoEditor(s.sql)}
                        className="min-w-0 flex-1 cursor-pointer text-left"
                        title={s.sql}
                      >
                        <div className="truncate text-xs font-medium text-foreground">
                          {s.name}
                        </div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground">
                          {s.sql.replace(/\s+/g, " ").trim()}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSnippet(s.id)}
                        className="cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                        title="Delete snippet"
                      >
                        <IconTrash size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolbarButton title="Export results" disabled={!canExport}>
                <IconDownload size={14} />
                Export
                <IconChevronDown size={12} className="opacity-60" />
              </ToolbarButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportAs("csv")}>
                Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("json")}>
                Download JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Editor pane */}
      <div
        className="shrink-0 overflow-hidden border-b border-border"
        style={{ height: editorHeight }}
      >
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={setValue}
          height={`${editorHeight}px`}
          theme={isDark ? oneDark : undefined}
          extensions={extensions}
          placeholder="Write SQL here…"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            autocompletion: true,
            bracketMatching: true,
            closeBrackets: true,
          }}
          style={{ fontSize: 13, height: "100%" }}
        />
      </div>

      {/* Splitter */}
      <div
        onMouseDown={startDrag}
        className="h-1.5 shrink-0 cursor-row-resize bg-border/40 transition-colors hover:bg-primary/40"
        role="separator"
        aria-orientation="horizontal"
      />

      {/* Status / error bar */}
      {(status || error) && (
        <div className="shrink-0 px-3 py-1.5">
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <IconAlertTriangle size={14} className="mt-px shrink-0" />
              <span className="break-words font-mono">{error}</span>
            </div>
          ) : (
            <div className="font-mono text-[11px] text-muted-foreground">
              {status}
            </div>
          )}
        </div>
      )}

      {/* Results panel */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {hasResults ? (
          <ResultsGrid columns={result!.columns} rows={result!.rows} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="text-sm text-muted-foreground">
              Run a query to see results, or start with an example:
            </div>
            <div className="flex flex-col gap-2">
              {examples.map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => loadIntoEditor(ex.sql)}
                  className="cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-left transition-colors hover:bg-accent"
                >
                  <div className="text-xs font-medium text-foreground">
                    {ex.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {ex.sql}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Destructive-confirm modal */}
      {confirmSql && (
        <Modal
          title="Confirm destructive query"
          onClose={() => setConfirmSql(null)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-foreground">
              <IconAlertTriangle
                size={18}
                className="mt-px shrink-0 text-yellow-500"
              />
              <p>
                This looks like a destructive query (DROP / TRUNCATE / DELETE
                without WHERE). Run it?
              </p>
            </div>
            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-[11px] text-foreground">
              {confirmSql}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSql(null)}
                className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAndRun}
                className="inline-flex h-8 cursor-pointer items-center rounded-md bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-600"
              >
                Run anyway
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Save-snippet modal */}
      {saveModalOpen && (
        <Modal title="Save snippet" onClose={() => setSaveModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Snippet name
              </label>
              <input
                autoFocus
                value={snippetName}
                onChange={(e) => setSnippetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitSnippet();
                }}
                placeholder="e.g. Active users this week"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-[11px] text-foreground">
              {value.trim()}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitSnippet}
                disabled={!snippetName.trim()}
                className="inline-flex h-8 cursor-pointer items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
