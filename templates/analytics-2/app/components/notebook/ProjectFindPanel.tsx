import { IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type FindableCell = {
  id: string;
  label: string;
  kind: string;
  /** The cell's own text: SQL/code source, markdown or text contents. */
  text: string;
};

export type FindMatch = {
  cellId: string;
  label: string;
  kind: string;
  /** The line around the first match, trimmed for the result row. */
  snippet: string;
};

function firstMatchSnippet(text: string, needle: string): string {
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return "";
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const nextBreak = text.indexOf("\n", index);
  const line = text.slice(lineStart, nextBreak < 0 ? undefined : nextBreak);
  return line.trim().slice(0, 160);
}

/** Case-insensitive match over a cell's label and its own text. */
export function findCellMatches(
  cells: readonly FindableCell[],
  query: string,
): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: FindMatch[] = [];
  for (const cell of cells) {
    const inLabel = cell.label.toLowerCase().includes(needle);
    const inText = cell.text.toLowerCase().includes(needle);
    if (!inLabel && !inText) continue;
    matches.push({
      cellId: cell.id,
      label: cell.label,
      kind: cell.kind,
      snippet: inText ? firstMatchSnippet(cell.text, needle) : "",
    });
  }
  return matches;
}

/**
 * Find: searches every cell's own text, not just its title, and jumps to the
 * chosen cell. The label and empty-state copy are the source's ("Find...",
 * "No results found").
 */
export function ProjectFindPanel({
  cells,
  onClose,
  onJump,
}: {
  cells: readonly FindableCell[];
  onClose: () => void;
  onJump: (cellId: string) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => findCellMatches(cells, query), [cells, query]);

  return (
    <aside className="nb-side-panel" aria-label="Find">
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">Find</h2>
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label="Close Find"
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="nb-find-search">
        <IconSearch size={13} aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${id}-find`}
          className="nb-find-input"
          type="search"
          value={query}
          placeholder="Find..."
          aria-label="Find..."
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </div>
      {query.trim() === "" ? null : matches.length === 0 ? (
        <p className="nb-side-panel-note">No results found</p>
      ) : (
        <ul className="nb-outline-list">
          {matches.map((match) => (
            <li key={match.cellId}>
              <button
                type="button"
                className="nb-find-result"
                onClick={() => onJump(match.cellId)}
              >
                <span className="nb-outline-name">{match.label}</span>
                <span className="nb-outline-kind">{match.kind}</span>
                {match.snippet !== "" ? (
                  <span className="nb-find-snippet">{match.snippet}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
