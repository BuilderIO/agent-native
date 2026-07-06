import { IconChevronDown, IconChevronRight, IconX } from "@tabler/icons-react";
import * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { FileIcon } from "../explorer/file-icons";
import { modelRegistry } from "../model-registry";
import { useWorkbench } from "../store";
import { dirName, workbenchUri } from "../workspace/types";
import {
  planReplaceAllFile,
  replaceMatchesInText,
  searchWorkspace,
  type FileSearchResult,
  type SearchMatch,
  type SearchResults,
} from "./search-engine";

export interface SearchViewProps {
  searchSeed: { value?: string; token: number };
}

const DEBOUNCE_MS = 200;

interface DismissedState {
  files: Set<string>;
  matches: Set<string>;
}

function matchKey(
  providerKey: string,
  path: string,
  match: SearchMatch,
): string {
  return `${providerKey}::${path}::${match.line}:${match.column}`;
}

function fileKey(providerKey: string, path: string): string {
  return `${providerKey}::${path}`;
}

/** Access the single live Monaco editor instance, if mounted. */
function getActiveEditor(): monaco.editor.IStandaloneCodeEditor | null {
  const editors = monaco.editor.getEditors();
  return editors.length > 0
    ? (editors[0] as monaco.editor.IStandaloneCodeEditor)
    : null;
}

export function SearchView({ searchSeed }: SearchViewProps) {
  const { state, api, providers } = useWorkbench();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceValue, setReplaceValue] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<DismissedState>({
    files: new Set(),
    matches: new Set(),
  });
  const [confirmReplaceAll, setConfirmReplaceAll] = useState(false);
  const [replaceAllFailures, setReplaceAllFailures] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (searchSeed.token === 0) return;
    if (searchSeed.value) setQuery(searchSeed.value);
    window.requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSeed.token]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setDismissed({ files: new Set(), matches: new Set() });
      setReplaceAllFailures(0);
      searchWorkspace({
        providers,
        query,
        matchCase,
        wholeWord,
        regex,
        signal: controller.signal,
      })
        .then((next) => {
          if (controller.signal.aborted) return;
          setResults(next);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase, wholeWord, regex, providers]);

  const visibleFiles = useMemo<FileSearchResult[]>(() => {
    if (!results) return [];
    return results.files
      .filter(
        (file) => !dismissed.files.has(fileKey(file.providerKey, file.path)),
      )
      .map((file) => ({
        ...file,
        matches: file.matches.filter(
          (match) =>
            !dismissed.matches.has(
              matchKey(file.providerKey, file.path, match),
            ),
        ),
      }))
      .filter((file) => file.matches.length > 0);
  }, [results, dismissed]);

  const totalVisibleMatches = visibleFiles.reduce(
    (sum, file) => sum + file.matches.length,
    0,
  );

  const openMatch = (file: FileSearchResult, match: SearchMatch) => {
    void (async () => {
      await api.openFile(file.providerKey, file.path, { preview: true });
      // The model may not be attached to the editor until the next paint
      // (openFile triggers an async buffer load); defer the reveal one frame.
      window.requestAnimationFrame(() => {
        const editor = getActiveEditor();
        if (!editor?.getModel()) return;
        const range = {
          startLineNumber: match.line,
          startColumn: match.column,
          endLineNumber: match.line,
          endColumn: match.column + match.length,
        };
        editor.setSelection(range);
        editor.revealRangeInCenter(range);
        editor.focus();
      });
    })();
  };

  const dismissFile = (file: FileSearchResult) => {
    setDismissed((current) => ({
      files: new Set(current.files).add(fileKey(file.providerKey, file.path)),
      matches: current.matches,
    }));
  };

  const dismissMatch = (file: FileSearchResult, match: SearchMatch) => {
    setDismissed((current) => ({
      files: current.files,
      matches: new Set(current.matches).add(
        matchKey(file.providerKey, file.path, match),
      ),
    }));
  };

  const toggleFileCollapsed = (key: string) => {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runReplaceAll = async () => {
    setConfirmReplaceAll(false);
    let failures = 0;
    for (const file of visibleFiles) {
      const provider = providers.find(
        (entry) => entry.key === file.providerKey,
      );
      if (!provider) continue;
      const uri = workbenchUri(file.providerKey, file.path);
      const hasOpenBuffer = Boolean(state.buffers[uri]);
      const plan = planReplaceAllFile(hasOpenBuffer);
      try {
        if (plan.route === "open-buffer") {
          // The file has a live editor buffer: apply the replacement to the
          // Monaco model (not the provider directly) so undo history and the
          // dirty flag stay correct, then persist through the normal
          // versioned save pipeline instead of racing a raw provider write
          // against unsaved edits.
          const entry = modelRegistry.get(uri);
          if (!entry) {
            failures += 1;
            continue;
          }
          const { content: replaced, count } = replaceMatchesInText(
            entry.model.getValue(),
            query,
            replaceValue,
            { matchCase, wholeWord, regex },
          );
          if (count > 0) {
            entry.model.pushEditOperations(
              null,
              [{ range: entry.model.getFullModelRange(), text: replaced }],
              () => null,
            );
            await api.save(uri);
          }
        } else {
          const read = await provider.readFile(file.path);
          const { content, count } = replaceMatchesInText(
            read.content,
            query,
            replaceValue,
            { matchCase, wholeWord, regex },
          );
          if (count > 0) {
            await provider.writeFile(file.path, content, read.versionHash);
          }
        }
      } catch {
        // Per-file failures are counted and surfaced below; the search
        // re-runs after to reflect the actual on-disk state rather than
        // assuming success.
        failures += 1;
      }
    }
    setReplaceAllFailures(failures);
    const next = await searchWorkspace({
      providers,
      query,
      matchCase,
      wholeWord,
      regex,
    });
    setResults(next);
  };

  const errorMessage = results?.error;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 pt-1">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search" /* i18n-ignore */
            className="h-7 rounded-[4px] border-[var(--workbench-border)] bg-[var(--workbench-surface-bg)] pr-[68px] text-[12px] text-[var(--workbench-fg)] shadow-none placeholder:text-[var(--workbench-muted-fg)] focus-visible:ring-1 focus-visible:ring-[var(--workbench-accent)]"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <ToggleSquare
              label="Match Case"
              /* i18n-ignore */ active={matchCase}
              onClick={() => setMatchCase((v) => !v)}
            >
              {"Aa"}
            </ToggleSquare>
            <ToggleSquare
              label="Whole Word"
              /* i18n-ignore */ active={wholeWord}
              onClick={() => setWholeWord((v) => !v)}
            >
              {"ab"}
            </ToggleSquare>
            <ToggleSquare
              label="Use Regular Expression"
              /* i18n-ignore */ active={regex}
              onClick={() => setRegex((v) => !v)}
            >
              {".*"}
            </ToggleSquare>
          </div>
        </div>
        <button
          type="button"
          aria-label="Toggle Replace" /* i18n-ignore */
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-[var(--workbench-muted-fg)] hover:bg-[var(--workbench-hover-bg)] hover:text-[var(--workbench-fg)]"
          onClick={() => setReplaceOpen((v) => !v)}
        >
          {replaceOpen ? (
            <IconChevronDown className="size-3.5" />
          ) : (
            <IconChevronRight className="size-3.5 rtl:-scale-x-100" />
          )}
        </button>
      </div>

      {replaceOpen ? (
        <div className="mt-1 flex items-center gap-1">
          <Input
            value={replaceValue}
            onChange={(event) => setReplaceValue(event.target.value)}
            placeholder="Replace" /* i18n-ignore */
            className="h-7 flex-1 rounded-[4px] border-[var(--workbench-border)] bg-[var(--workbench-surface-bg)] text-[12px] text-[var(--workbench-fg)] shadow-none placeholder:text-[var(--workbench-muted-fg)] focus-visible:ring-1 focus-visible:ring-[var(--workbench-accent)]"
          />
          <button
            type="button"
            disabled={!query || totalVisibleMatches === 0}
            className="h-7 shrink-0 cursor-pointer rounded-[4px] border border-[var(--workbench-border)] bg-[var(--workbench-surface-bg)] px-2 text-[11px] text-[var(--workbench-fg)] hover:bg-[var(--workbench-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setConfirmReplaceAll(true)}
          >
            {"Replace All" /* i18n-ignore */}
          </button>
        </div>
      ) : null}

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {errorMessage ? (
          <p className="px-1 py-2 text-[12px] text-[var(--workbench-muted-fg)]">
            {errorMessage}
          </p>
        ) : null}
        {!errorMessage && results?.capped ? (
          <p className="px-1 py-1 text-[11px] text-[var(--workbench-muted-fg)]">
            {"Results capped at 5,000 matches" /* i18n-ignore */}
          </p>
        ) : null}
        {!errorMessage && replaceAllFailures > 0 ? (
          <p className="px-1 py-1 text-[11px] text-[var(--workbench-muted-fg)]">
            {
              `Replace All failed for ${replaceAllFailures} file${
                replaceAllFailures === 1 ? "" : "s"
              }` /* i18n-ignore */
            }
          </p>
        ) : null}
        {!errorMessage && !searching && query && totalVisibleMatches === 0 ? (
          <p className="px-1 py-2 text-[12px] text-[var(--workbench-muted-fg)]">
            {"No results found" /* i18n-ignore */}
          </p>
        ) : null}
        {visibleFiles.map((file) => {
          const key = fileKey(file.providerKey, file.path);
          const collapsed = collapsedFiles.has(key);
          const dir = dirName(file.path);
          const name = file.path.split("/").pop() ?? file.path;
          return (
            <div key={key} className="mb-0.5">
              <div className="group flex h-6 cursor-pointer items-center gap-1 rounded-[5px] px-1 text-[12px] hover:bg-[var(--workbench-hover-bg)]">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1"
                  onClick={() => toggleFileCollapsed(key)}
                >
                  {collapsed ? (
                    <IconChevronRight className="size-3.5 shrink-0 text-[var(--workbench-muted-fg)] rtl:-scale-x-100" />
                  ) : (
                    <IconChevronDown className="size-3.5 shrink-0 text-[var(--workbench-muted-fg)]" />
                  )}
                  <FileIcon path={file.path} />
                  <span className="min-w-0 truncate font-medium text-[var(--workbench-fg)]">
                    {name}
                  </span>
                  {dir ? (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--workbench-muted-fg)]">
                      {dir}
                    </span>
                  ) : null}
                  <span className="shrink-0 rounded-full bg-[var(--workbench-surface-bg)] px-1.5 text-[10px] text-[var(--workbench-muted-fg)]">
                    {file.matches.length}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Dismiss" /* i18n-ignore */
                  className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-[var(--workbench-muted-fg)] opacity-0 hover:text-[var(--workbench-fg)] group-hover:opacity-100"
                  onClick={() => dismissFile(file)}
                >
                  <IconX className="size-3" />
                </button>
              </div>
              {!collapsed
                ? file.matches.map((match) => (
                    <SearchMatchRow
                      key={matchKey(file.providerKey, file.path, match)}
                      match={match}
                      onClick={() => openMatch(file, match)}
                      onDismiss={() => dismissMatch(file, match)}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>

      <AlertDialog open={confirmReplaceAll} onOpenChange={setConfirmReplaceAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {"Replace all matches?" /* i18n-ignore */}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {
                `This will replace ${totalVisibleMatches} match${
                  totalVisibleMatches === 1 ? "" : "es"
                } across ${visibleFiles.length} file${
                  visibleFiles.length === 1 ? "" : "s"
                }.` /* i18n-ignore */
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{"Cancel" /* i18n-ignore */}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runReplaceAll()}>
              {"Replace All" /* i18n-ignore */}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SearchMatchRow({
  match,
  onClick,
  onDismiss,
}: {
  match: SearchMatch;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const before = match.lineText.slice(0, match.column - 1);
  const highlighted = match.lineText.slice(
    match.column - 1,
    match.column - 1 + match.length,
  );
  const after = match.lineText.slice(match.column - 1 + match.length);
  return (
    <div className="group flex h-5 cursor-pointer items-center gap-1 rounded-[4px] py-3 pl-6 pr-1 text-[11.5px] hover:bg-[var(--workbench-hover-bg)]">
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer overflow-hidden whitespace-nowrap text-left text-[var(--workbench-muted-fg)]"
        title={match.lineText.trim()}
        onClick={onClick}
      >
        <span>{before.trimStart()}</span>
        <span className="rounded-[2px] bg-[var(--workbench-search-match-bg,var(--workbench-selection-bg))] text-[var(--workbench-fg)]">
          {highlighted}
        </span>
        <span>{after}</span>
      </button>
      <button
        type="button"
        aria-label="Dismiss" /* i18n-ignore */
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-[var(--workbench-muted-fg)] opacity-0 hover:text-[var(--workbench-fg)] group-hover:opacity-100"
        onClick={onDismiss}
      >
        <IconX className="size-3" />
      </button>
    </div>
  );
}

function ToggleSquare({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-[22px] cursor-pointer items-center justify-center rounded-[3px] text-[10px] font-semibold text-[var(--workbench-muted-fg)] outline-none hover:bg-[var(--workbench-hover-bg)]",
        active &&
          "bg-[var(--workbench-active-bg)] text-[var(--workbench-accent)] ring-1 ring-inset ring-[var(--workbench-accent)]",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
