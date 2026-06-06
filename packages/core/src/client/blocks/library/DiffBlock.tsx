import { useMemo, useState } from "react";
import {
  IconColumns,
  IconDotsVertical,
  IconFileDiff,
  IconList,
} from "@tabler/icons-react";
import { cn } from "../../utils.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import type { DiffData, DiffMode } from "./diff.config.js";
import { DevInput, DevLabel, DevTextarea, DevSelect } from "./dev-doc-ui.js";

/**
 * GitHub-style before/after diff block. The read renderer computes a line-level
 * diff, then renders it either unified (one column, `+`/`−` gutters) or split
 * (side-by-side). Long unchanged runs collapse into an expandable "N unchanged
 * lines" row (progressive disclosure). All colors are theme-aware: greens/reds
 * use Tailwind `light`/`dark:` pairs and the chrome uses the plan `--plan-*`
 * tokens, so the block reads correctly in BOTH modes.
 *
 * Lives in core so any app can register the dev-doc block. The line differ is
 * inlined (a small LCS-based `diffLines`) rather than pulling the `diff` package
 * into core, so core stays dependency-free; the output shape (`{ value, added,
 * removed }` change records) is identical to what the read renderer consumed
 * before.
 *
 * Editing is panel-driven (config-style, like the HTML block): two monospace
 * textareas (Before / After) plus filename, language, and mode controls.
 */

/* ── Inline line differ (LCS) — replaces jsdiff `diffLines` ─────────────────── */

interface Change {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/**
 * Split text into lines, each KEEPING its trailing newline (so the change
 * `value`s concatenate back to the original and `splitLines` below behaves the
 * same as it did against jsdiff output).
 */
function toLineTokens(text: string): string[] {
  if (text === "") return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * A minimal line-level diff producing jsdiff-compatible `Change[]` records
 * (`{ value }` for context, `{ value, added: true }`, `{ value, removed: true }`).
 * Uses a classic LCS table over line tokens; the inputs here are short code
 * snippets so the O(n·m) table is fine. Removed lines are emitted before added
 * lines within a change region, matching jsdiff's ordering.
 */
function diffLines(before: string, after: string): Change[] {
  const a = toLineTokens(before);
  const b = toLineTokens(after);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const changes: Change[] = [];
  // Push a token onto the last change if same kind, else open a new change.
  const push = (value: string, kind: "context" | "added" | "removed") => {
    const last = changes[changes.length - 1];
    const sameKind =
      last &&
      Boolean(last.added) === (kind === "added") &&
      Boolean(last.removed) === (kind === "removed");
    if (sameKind) {
      last.value += value;
    } else {
      changes.push({
        value,
        added: kind === "added" ? true : undefined,
        removed: kind === "removed" ? true : undefined,
      });
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i], "context");
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i], "removed");
      i += 1;
    } else {
      push(b[j], "added");
      j += 1;
    }
  }
  while (i < n) {
    push(a[i], "removed");
    i += 1;
  }
  while (j < m) {
    push(b[j], "added");
    j += 1;
  }
  return changes;
}

/* ── Diff model ────────────────────────────────────────────────────────────── */

type DiffRowKind = "context" | "added" | "removed";

interface DiffRow {
  kind: DiffRowKind;
  /** Line number in the OLD file (omitted for added rows). */
  oldNo?: number;
  /** Line number in the NEW file (omitted for removed rows). */
  newNo?: number;
  text: string;
}

/** A contiguous run of context lines collapsed when longer than the threshold. */
interface CollapsedRun {
  collapsed: true;
  rows: DiffRow[];
}

type DiffSegment = DiffRow | CollapsedRun;

/** Number of context lines above which an unchanged run is collapsed. */
const COLLAPSE_THRESHOLD = 6;
/** Context lines kept visible at each edge of a collapsed run. */
const CONTEXT_EDGE = 3;

/**
 * Split a change `value` into individual lines. Most hunks carry a trailing
 * newline; drop the empty final element it produces so a 2-line change does not
 * render a phantom 3rd blank line.
 */
function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Flatten change objects into numbered diff rows. */
function buildRows(changes: Change[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const change of changes) {
    const lines = splitLines(change.value);
    for (const text of lines) {
      if (change.added) {
        newNo += 1;
        rows.push({ kind: "added", newNo, text });
      } else if (change.removed) {
        oldNo += 1;
        rows.push({ kind: "removed", oldNo, text });
      } else {
        oldNo += 1;
        newNo += 1;
        rows.push({ kind: "context", oldNo, newNo, text });
      }
    }
  }
  return rows;
}

/**
 * Group rows into segments, collapsing interior runs of >COLLAPSE_THRESHOLD
 * context rows (keeping CONTEXT_EDGE visible at each side). Leading/trailing runs
 * collapse too, but keep only the inner edge visible.
 */
function segmentRows(rows: DiffRow[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== "context") {
      segments.push(rows[i]);
      i += 1;
      continue;
    }
    // Gather the full contiguous context run.
    let j = i;
    while (j < rows.length && rows[j].kind === "context") j += 1;
    const run = rows.slice(i, j);
    if (run.length <= COLLAPSE_THRESHOLD) {
      for (const row of run) segments.push(row);
    } else {
      const atStart = i === 0;
      const atEnd = j === rows.length;
      const head = atStart ? [] : run.slice(0, CONTEXT_EDGE);
      const tail = atEnd ? [] : run.slice(run.length - CONTEXT_EDGE);
      const hidden = run.slice(head.length, run.length - tail.length);
      for (const row of head) segments.push(row);
      if (hidden.length > 0) segments.push({ collapsed: true, rows: hidden });
      for (const row of tail) segments.push(row);
    }
    i = j;
  }
  return segments;
}

/* ── Theme-aware row styling (light + dark) ────────────────────────────────── */

const ROW_BG: Record<DiffRowKind, string> = {
  added: "bg-emerald-500/10 dark:bg-emerald-400/15",
  removed: "bg-rose-500/10 dark:bg-rose-400/15",
  context: "",
};

const GUTTER_BG: Record<DiffRowKind, string> = {
  added: "bg-emerald-500/15 dark:bg-emerald-400/20",
  removed: "bg-rose-500/15 dark:bg-rose-400/20",
  context: "bg-transparent",
};

const SIGN_COLOR: Record<DiffRowKind, string> = {
  added: "text-emerald-700 dark:text-emerald-300",
  removed: "text-rose-700 dark:text-rose-300",
  context: "text-plan-muted",
};

const SIGN: Record<DiffRowKind, string> = {
  added: "+",
  removed: "−",
  context: " ",
};

const LINE_NO_CLASS =
  "select-none px-2 text-right font-mono text-[11px] leading-5 text-plan-muted/70 tabular-nums";

/* ── Read ──────────────────────────────────────────────────────────────────── */

function DiffRead({ data, blockId, title, summary }: BlockReadProps<DiffData>) {
  const [mode, setMode] = useState<DiffMode>(data.mode ?? "unified");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const rows = useMemo(
    () => buildRows(diffLines(data.before, data.after)),
    [data.before, data.after],
  );

  const added = rows.filter((r) => r.kind === "added").length;
  const removed = rows.filter((r) => r.kind === "removed").length;
  const unchanged = data.before === data.after;

  const toggleRun = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <div className="overflow-hidden rounded-lg border border-plan-line bg-plan-code">
        {/* Header: filename, language chip, +/− counts, mode toggle. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-plan-line bg-plan-block px-3 py-2">
          <IconFileDiff className="size-4 shrink-0 text-plan-muted" />
          <span className="min-w-0 truncate font-mono text-sm font-medium text-plan-text">
            {data.filename || "diff"}
          </span>
          {data.language && (
            <span className="shrink-0 rounded border border-plan-line px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-plan-muted">
              {data.language}
            </span>
          )}
          <span className="ml-1 flex shrink-0 items-center gap-2 font-mono text-xs">
            <span className="text-emerald-700 dark:text-emerald-300">
              +{added}
            </span>
            <span className="text-rose-700 dark:text-rose-300">−{removed}</span>
          </span>
          <div className="ml-auto flex shrink-0 items-center overflow-hidden rounded-md border border-plan-line">
            <ModeButton
              active={mode === "unified"}
              onClick={() => setMode("unified")}
              icon={<IconList className="size-3.5" />}
              label="Unified"
            />
            <ModeButton
              active={mode === "split"}
              onClick={() => setMode("split")}
              icon={<IconColumns className="size-3.5" />}
              label="Split"
            />
          </div>
        </div>

        {/* Body. */}
        {unchanged ? (
          <div className="px-4 py-6 text-center font-mono text-sm text-plan-muted">
            No changes
          </div>
        ) : mode === "split" ? (
          <SplitView rows={rows} />
        ) : (
          <UnifiedView
            rows={rows}
            expanded={expanded}
            onToggleRun={toggleRun}
          />
        )}
      </div>
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      data-plan-interactive
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex cursor-pointer items-center gap-1 px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-plan-code text-plan-text"
          : "text-plan-muted hover:bg-plan-code/60 hover:text-plan-text",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Unified view ──────────────────────────────────────────────────────────── */

function UnifiedView({
  rows,
  expanded,
  onToggleRun,
}: {
  rows: DiffRow[];
  expanded: Set<number>;
  onToggleRun: (index: number) => void;
}) {
  const segments = useMemo(() => segmentRows(rows), [rows]);
  let runIndex = 0;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-full font-mono text-[13px] leading-5">
        {segments.map((segment, idx) => {
          if ("collapsed" in segment) {
            const key = runIndex++;
            const open = expanded.has(key);
            return (
              <div key={`run-${key}`}>
                <CollapsedRow
                  count={segment.rows.length}
                  open={open}
                  onClick={() => onToggleRun(key)}
                />
                {open &&
                  segment.rows.map((row, ri) => (
                    <UnifiedRow key={`run-${key}-${ri}`} row={row} />
                  ))}
              </div>
            );
          }
          return <UnifiedRow key={idx} row={segment} />;
        })}
      </div>
    </div>
  );
}

function UnifiedRow({ row }: { row: DiffRow }) {
  return (
    <div className={cn("flex w-full", ROW_BG[row.kind])}>
      <span className={cn(LINE_NO_CLASS, "w-10")}>{row.oldNo ?? ""}</span>
      <span className={cn(LINE_NO_CLASS, "w-10")}>{row.newNo ?? ""}</span>
      <span
        className={cn(
          "w-6 shrink-0 select-none text-center font-semibold",
          GUTTER_BG[row.kind],
          SIGN_COLOR[row.kind],
        )}
      >
        {SIGN[row.kind]}
      </span>
      <pre className="m-0 flex-1 overflow-visible whitespace-pre px-2 text-plan-text">
        {row.text || " "}
      </pre>
    </div>
  );
}

function CollapsedRow({
  count,
  open,
  onClick,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-plan-interactive
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 border-y border-plan-line/60 bg-plan-block/50 px-3 py-1 text-left text-xs text-plan-muted transition-colors hover:bg-plan-block"
    >
      <IconDotsVertical className="size-3.5 shrink-0" />
      <span>
        {open ? "Hide" : "Show"} {count} unchanged line
        {count === 1 ? "" : "s"}
      </span>
    </button>
  );
}

/* ── Split (side-by-side) view ─────────────────────────────────────────────── */

interface SplitRow {
  left?: DiffRow;
  right?: DiffRow;
}

/**
 * Pair removed lines (left) with added lines (right) so a modification shows the
 * old and new side by side; context lines mirror on both columns. Leftover adds
 * or removes fall through as half-empty rows (GitHub split behavior).
 */
function pairSplitRows(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "context") {
      out.push({ left: row, right: row });
      i += 1;
      continue;
    }
    // Collect a contiguous block of removed-then-added rows.
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (i < rows.length && rows[i].kind === "removed")
      removed.push(rows[i++]);
    while (i < rows.length && rows[i].kind === "added") added.push(rows[i++]);
    const max = Math.max(removed.length, added.length);
    for (let k = 0; k < max; k += 1) {
      out.push({ left: removed[k], right: added[k] });
    }
  }
  return out;
}

function SplitView({ rows }: { rows: DiffRow[] }) {
  const pairs = useMemo(() => pairSplitRows(rows), [rows]);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-full grid-cols-2 font-mono text-[13px] leading-5">
        {pairs.map((pair, idx) => (
          <SplitRowView key={idx} pair={pair} />
        ))}
      </div>
    </div>
  );
}

function SplitRowView({ pair }: { pair: SplitRow }) {
  return (
    <>
      <SplitCell row={pair.left} side="old" />
      <SplitCell row={pair.right} side="new" />
    </>
  );
}

function SplitCell({ row, side }: { row?: DiffRow; side: "old" | "new" }) {
  if (!row) {
    return (
      <div
        className={cn(
          "min-h-5 bg-plan-block/40",
          side === "old" && "border-r border-plan-line",
        )}
      />
    );
  }
  const sign = side === "old" ? "−" : "+";
  const showSign = row.kind !== "context";
  return (
    <div
      className={cn(
        "flex",
        ROW_BG[row.kind],
        side === "old" && "border-r border-plan-line",
      )}
    >
      <span className={cn(LINE_NO_CLASS, "w-10")}>
        {side === "old" ? (row.oldNo ?? "") : (row.newNo ?? "")}
      </span>
      <span
        className={cn(
          "w-5 shrink-0 select-none text-center font-semibold",
          GUTTER_BG[row.kind],
          SIGN_COLOR[row.kind],
        )}
      >
        {showSign ? sign : " "}
      </span>
      <pre className="m-0 flex-1 overflow-visible whitespace-pre px-2 text-plan-text">
        {row.text || " "}
      </pre>
    </div>
  );
}

/* ── Edit (panel) ──────────────────────────────────────────────────────────── */

const codeAreaClass = "min-h-[140px] font-mono text-xs leading-5";

function DiffEdit({ data, onChange, editable }: BlockEditProps<DiffData>) {
  const patch = (next: Partial<DiffData>) => onChange({ ...data, ...next });
  const mode: DiffMode = data.mode ?? "unified";

  return (
    <div className="flex flex-col gap-3" data-plan-interactive>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <DevLabel htmlFor="diff-filename" className="text-xs">
            Filename
          </DevLabel>
          <DevInput
            id="diff-filename"
            value={data.filename ?? ""}
            placeholder="src/add.ts"
            disabled={!editable}
            onChange={(event) =>
              patch({ filename: event.target.value || undefined })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <DevLabel htmlFor="diff-language" className="text-xs">
            Language
          </DevLabel>
          <DevInput
            id="diff-language"
            value={data.language ?? ""}
            placeholder="ts"
            disabled={!editable}
            onChange={(event) =>
              patch({ language: event.target.value || undefined })
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <DevLabel className="text-xs">Layout</DevLabel>
        <DevSelect
          value={mode}
          disabled={!editable}
          onValueChange={(value) => patch({ mode: value as DiffMode })}
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Split (side-by-side)" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <DevLabel htmlFor="diff-before" className="text-xs">
          Before
        </DevLabel>
        <DevTextarea
          id="diff-before"
          spellCheck={false}
          className={codeAreaClass}
          value={data.before}
          disabled={!editable}
          onChange={(event) => patch({ before: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <DevLabel htmlFor="diff-after" className="text-xs">
          After
        </DevLabel>
        <DevTextarea
          id="diff-after"
          spellCheck={false}
          className={codeAreaClass}
          value={data.after}
          disabled={!editable}
          onChange={(event) => patch({ after: event.target.value })}
        />
      </div>
    </div>
  );
}

export { DiffRead, DiffEdit };
