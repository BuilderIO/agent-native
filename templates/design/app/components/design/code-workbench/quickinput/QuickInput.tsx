import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import {
  formatKeybinding,
  runCommand,
  type WorkbenchCommand,
  type WorkbenchCommandContext,
} from "../commands";
import { FileIcon } from "../explorer/file-icons";
import {
  baseName,
  dirName,
  providerKindFromKey,
  type WorkspaceFileEntry,
} from "../workspace/types";
import { score, scoreFilePath, type FuzzyMatch } from "./fuzzy";

export interface QuickInputHandle {
  /** Open the overlay, prefilling the input with `prefill` (e.g. "", ">", ":"). */
  open(prefill: string): void;
}

export interface QuickInputProps {
  commands: WorkbenchCommand[];
  context: WorkbenchCommandContext;
}

type Mode = "file" | "command" | "line" | "symbol";

interface FileRow {
  kind: "file";
  key: string;
  providerKey: string;
  path: string;
  match: FuzzyMatch | null;
}

interface CommandRow {
  kind: "command";
  key: string;
  command: WorkbenchCommand;
  titleMatch: FuzzyMatch | null;
}

type Row = FileRow | CommandRow;

const MAX_RENDERED_ROWS = 200;

function modeForInput(value: string): Mode {
  if (value.startsWith(">")) return "command";
  if (value.startsWith(":")) return "line";
  if (value.startsWith("@")) return "symbol";
  return "file";
}

/** Highlight matched character indices in `text` with an accent + bold span. */
function HighlightedLabel({
  text,
  matches,
}: {
  text: string;
  matches: number[] | null;
}) {
  if (!matches || matches.length === 0) return <>{text}</>;
  const matchSet = new Set(matches);
  return (
    <>
      {Array.from(text).map((char, index) => {
        const key = `${index}-${char}`;
        if (matchSet.has(index)) {
          return (
            <span
              key={key}
              className="font-semibold text-[var(--workbench-accent)]"
            >
              {char}
            </span>
          );
        }
        return <span key={key}>{char}</span>;
      })}
    </>
  );
}

export const QuickInput = forwardRef<QuickInputHandle, QuickInputProps>(
  function QuickInput({ commands, context }, ref) {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [allFiles, setAllFiles] = useState<
      Array<{ providerKey: string; entry: WorkspaceFileEntry }>
    >([]);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const filesLoadedRef = useRef(false);

    const close = useCallback(() => {
      setOpen(false);
      setValue("");
      setActiveIndex(0);
      filesLoadedRef.current = false;
      setAllFiles([]);
    }, []);

    const loadFiles = useCallback(async () => {
      if (filesLoadedRef.current) return;
      filesLoadedRef.current = true;
      const providers = context.api.listProviders();
      const results = await Promise.all(
        providers.map(async (provider) => {
          try {
            const entries = await provider.listFiles();
            return entries.map((entry) => ({
              providerKey: provider.key,
              entry,
            }));
          } catch {
            return [];
          }
        }),
      );
      setAllFiles(results.flat());
    }, [context.api]);

    useImperativeHandle(
      ref,
      () => ({
        open: (prefill: string) => {
          setOpen(true);
          setValue(prefill);
          setActiveIndex(0);
          void loadFiles();
          // Defer focus/selection until the input has mounted with the value.
          requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            if (prefill === ">") {
              // VS Code: opening the palette selects nothing extra — caret
              // lands after the prefix so typing appends/replaces naturally.
              input.setSelectionRange(prefill.length, prefill.length);
            } else {
              input.setSelectionRange(input.value.length, input.value.length);
            }
          });
        },
      }),
      [loadFiles],
    );

    const mode = modeForInput(value);

    // "@" mode closes the overlay immediately and delegates to Monaco's own
    // symbol picker.
    useEffect(() => {
      if (!open || mode !== "symbol") return;
      close();
      const editor = context.ui.getEditor();
      editor?.focus();
      void editor?.getAction("editor.action.quickOutline")?.run();
    }, [open, mode, close, context.ui]);

    const query = mode === "file" ? value : value.slice(1);

    const rows = useMemo<Row[]>(() => {
      if (mode === "command") {
        const available = commands.filter(
          (command) =>
            command.showInPalette !== false &&
            (!command.when || command.when(context)),
        );
        const scored = available
          .map((command): { row: CommandRow; rank: number } | null => {
            if (!query)
              return {
                row: {
                  kind: "command",
                  key: command.id,
                  command,
                  titleMatch: null,
                },
                rank: 0,
              };
            const titleMatch = score(query, command.title);
            if (!titleMatch) return null;
            return {
              row: { kind: "command", key: command.id, command, titleMatch },
              rank: titleMatch.score,
            };
          })
          .filter(
            (entry): entry is { row: CommandRow; rank: number } =>
              entry !== null,
          );
        scored.sort(
          (a, b) =>
            b.rank - a.rank ||
            a.row.command.title.localeCompare(b.row.command.title),
        );
        return scored.map((entry) => entry.row);
      }

      if (mode === "file") {
        const state = context.api.getState();
        if (!query) {
          // MRU-ordered open tabs first, then the rest of the files.
          const mruEntries: Row[] = [];
          const seen = new Set<string>();
          for (const uri of state.mru) {
            const tab = state.tabs.find((t) => t.uri === uri);
            if (!tab) continue;
            seen.add(uri);
            mruEntries.push({
              kind: "file",
              key: uri,
              providerKey: tab.providerKey,
              path: tab.path,
              match: null,
            });
          }
          const rest: Row[] = allFiles
            .filter(
              ({ providerKey, entry }) =>
                !seen.has(`${providerKey}::${entry.path}`),
            )
            .map(({ providerKey, entry }) => ({
              kind: "file" as const,
              key: `${providerKey}::${entry.path}`,
              providerKey,
              path: entry.path,
              match: null,
            }));
          return [...mruEntries, ...rest];
        }
        const scored = allFiles
          .map(
            ({ providerKey, entry }): { row: FileRow; rank: number } | null => {
              const match = scoreFilePath(query, entry.path);
              if (!match) return null;
              return {
                row: {
                  kind: "file" as const,
                  key: `${providerKey}::${entry.path}`,
                  providerKey,
                  path: entry.path,
                  match,
                },
                rank: match.score,
              };
            },
          )
          .filter(
            (entry): entry is { row: FileRow; rank: number } => entry !== null,
          );
        scored.sort(
          (a, b) => b.rank - a.rank || a.row.path.localeCompare(b.row.path),
        );
        return scored.map((entry) => entry.row);
      }

      return [];
    }, [mode, query, commands, context, allFiles]);

    const visibleRows = rows.slice(0, MAX_RENDERED_ROWS);

    useEffect(() => {
      setActiveIndex(0);
    }, [value]);

    useEffect(() => {
      if (!open) return;
      const row = listRef.current?.querySelector<HTMLElement>(
        `[data-row-index="${activeIndex}"]`,
      );
      row?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, open]);

    const parsedLine = useMemo(() => {
      if (mode !== "line") return null;
      const match = /^(\d+)(?::(\d+))?$/.exec(query.trim());
      if (!match) return null;
      const line = Number.parseInt(match[1]!, 10);
      const column = match[2] ? Number.parseInt(match[2], 10) : 1;
      if (!Number.isFinite(line) || line < 1) return null;
      return {
        line,
        column: Number.isFinite(column) && column > 0 ? column : 1,
      };
    }, [mode, query]);

    // Live preview: reveal the target line while typing in ":" mode.
    useEffect(() => {
      if (!open || mode !== "line" || !parsedLine) return;
      const editor = context.ui.getEditor();
      editor?.revealLineInCenter(parsedLine.line);
    }, [open, mode, parsedLine, context.ui]);

    const acceptFile = useCallback(
      (row: FileRow, pinned: boolean) => {
        close();
        void context.api.openFile(row.providerKey, row.path, {
          preview: !pinned,
        });
      },
      [close, context.api],
    );

    const acceptCommand = useCallback(
      (row: CommandRow) => {
        close();
        void runCommand(row.command, context);
      },
      [close, context],
    );

    const acceptLine = useCallback(() => {
      if (!parsedLine) return;
      close();
      const editor = context.ui.getEditor();
      if (!editor) return;
      editor.setPosition({
        lineNumber: parsedLine.line,
        column: parsedLine.column,
      });
      editor.revealPositionInCenter({
        lineNumber: parsedLine.line,
        column: parsedLine.column,
      });
      editor.focus();
    }, [close, context.ui, parsedLine]);

    const acceptActive = useCallback(
      (pinned: boolean) => {
        if (mode === "line") {
          acceptLine();
          return;
        }
        const row = visibleRows[activeIndex];
        if (!row) return;
        if (row.kind === "file") acceptFile(row, pinned);
        else acceptCommand(row);
      },
      [mode, visibleRows, activeIndex, acceptLine, acceptFile, acceptCommand],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((current) =>
            Math.min(current + 1, Math.max(visibleRows.length - 1, 0)),
          );
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((current) => Math.max(current - 1, 0));
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          acceptActive(event.metaKey || event.ctrlKey);
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
        }
      },
      [close, acceptActive, visibleRows.length],
    );

    // Auto-close on outside click / blur.
    useEffect(() => {
      if (!open) return;
      const handlePointerDown = (event: PointerEvent) => {
        if (
          rootRef.current &&
          !rootRef.current.contains(event.target as Node)
        ) {
          close();
        }
      };
      document.addEventListener("pointerdown", handlePointerDown, true);
      return () =>
        document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [open, close]);

    if (!open || mode === "symbol") return null;

    return (
      <div
        ref={rootRef}
        data-testid="workbench-quickinput"
        className={cn(
          "absolute left-1/2 top-3 z-50 flex max-h-[70%] w-[min(600px,90%)] -translate-x-1/2 flex-col overflow-hidden",
          "rounded-lg border border-[var(--workbench-border)] bg-[var(--workbench-quickinput-bg,var(--workbench-surface-bg))] shadow-xl",
        )}
      >
        <div className="flex shrink-0 items-center border-b border-[var(--workbench-border)] px-3">
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Let mousedown-based row acceptance run before blur closes us.
              requestAnimationFrame(() => close());
            }}
            placeholder={placeholderForMode(mode)}
            spellCheck={false}
            autoComplete="off"
            className="h-11 w-full min-w-0 bg-transparent text-[13px] text-[var(--workbench-fg)] outline-none placeholder:text-[var(--workbench-muted-fg)]"
          />
        </div>
        {mode === "line" ? (
          <div className="px-3 py-2 text-[12px] text-[var(--workbench-muted-fg)]">
            {
              parsedLine
                ? `Go to line ${parsedLine.line}, column ${parsedLine.column}` /* i18n-ignore */
                : "Type a line number, optionally :column" /* i18n-ignore */
            }
          </div>
        ) : (
          <div ref={listRef} className="min-h-0 overflow-y-auto py-1">
            {visibleRows.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-[var(--workbench-muted-fg)]">
                {"No results" /* i18n-ignore */}
              </div>
            ) : (
              visibleRows.map((row, index) => (
                <QuickInputRow
                  key={row.key}
                  row={row}
                  index={index}
                  active={index === activeIndex}
                  onHover={() => setActiveIndex(index)}
                  onAccept={(pinned) => {
                    if (row.kind === "file") acceptFile(row, pinned);
                    else acceptCommand(row);
                  }}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  },
);

function placeholderForMode(mode: Mode): string {
  switch (mode) {
    case "command":
      return "Type a command…" /* i18n-ignore */;
    case "line":
      return "Go to line:column…" /* i18n-ignore */;
    default:
      return "Go to file…" /* i18n-ignore */;
  }
}

function QuickInputRow({
  row,
  index,
  active,
  onHover,
  onAccept,
}: {
  row: Row;
  index: number;
  active: boolean;
  onHover: () => void;
  onAccept: (pinned: boolean) => void;
}) {
  return (
    <div
      data-row-index={index}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      // Prevent the input's blur from firing before the click is handled.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onAccept(event.metaKey || event.ctrlKey)}
      className={cn(
        "mx-1 flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-[12px]",
        active
          ? "bg-[var(--workbench-list-active-bg,var(--workbench-active-bg))] text-[var(--workbench-fg)]"
          : "text-[var(--workbench-fg)] hover:bg-[var(--workbench-hover-bg)]",
      )}
    >
      {row.kind === "file" ? (
        <FileQuickInputRow row={row} />
      ) : (
        <CommandQuickInputRow row={row} />
      )}
    </div>
  );
}

function FileQuickInputRow({ row }: { row: FileRow }) {
  const name = baseName(row.path);
  const dir = dirName(row.path);
  const isLocalhost = providerKindFromKey(row.providerKey) === "localhost";
  const matches = row.match?.matches ?? null;
  // Matched indices are relative to the full path; split into basename vs.
  // directory highlight sets by offset.
  const basenameStart = row.path.length - name.length;
  const nameMatches =
    matches?.filter((i) => i >= basenameStart).map((i) => i - basenameStart) ??
    null;

  return (
    <>
      <FileIcon path={row.path} />
      <span className="min-w-0 flex-1 truncate">
        <HighlightedLabel text={name} matches={nameMatches} />
      </span>
      {dir ? (
        <span className="min-w-0 shrink truncate text-[11px] text-[var(--workbench-muted-fg)]">
          {isLocalhost ? `${dir} · local` /* i18n-ignore */ : dir}
        </span>
      ) : null}
    </>
  );
}

function CommandQuickInputRow({ row }: { row: CommandRow }) {
  const matches = row.titleMatch?.matches ?? null;
  return (
    <>
      {row.command.category ? (
        <span className="shrink-0 text-[11px] text-[var(--workbench-muted-fg)]">
          {row.command.category}:
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        <HighlightedLabel text={row.command.title} matches={matches} />
      </span>
      {row.command.keybindings?.[0] ? (
        <kbd className="shrink-0 rounded-[4px] border border-[var(--workbench-border)] bg-[var(--workbench-editor-bg)] px-1.5 py-0.5 font-sans text-[10px] text-[var(--workbench-muted-fg)]">
          {formatKeybinding(row.command.keybindings[0])}
        </kbd>
      ) : null}
    </>
  );
}
