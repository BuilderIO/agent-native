import {
  IconChevronRight,
  IconColumns,
  IconDotsVertical,
  IconFileDiff,
  IconList,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { common, createLowlight } from "lowlight";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";

import { cn } from "../../utils.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";
import type {
  BlockEditProps,
  BlockReadProps,
  BlockRenderContext,
} from "../types.js";
import {
  AnnotationGutterMarker,
  AnnotationHiddenStack,
  AnnotationHoverCard,
  AnnotationInlineOverlayStack,
  anchorFromElements,
  buildLineMarkerMap,
  hasRailAnnotations,
  resolveAnnotations,
  useAnnotationMarginNotesAvailable,
  useAnnotationHover,
  type AnnotationMarginSide,
  type AnnotationSide,
  type ResolvedAnnotation,
} from "./annotation-rail.js";
import { DevInput, DevLabel, DevTextarea, DevSelect } from "./dev-doc-ui.js";
import type { DiffAnnotation, DiffData, DiffMode } from "./diff.config.js";
import { useInNarrowContainer } from "./narrow-container.js";

/**
 * GitHub-style before/after diff block. The read renderer computes a line-level
 * diff, then renders it either unified (one column, `+`/`−` gutters) or split
 * (side-by-side). Long unchanged runs collapse into an expandable "N unchanged
 * lines" row (progressive disclosure). The read surface keeps the GitHub diff
 * shape while using the framework Tailwind theme tokens, so it follows each
 * host app's light/dark appearance instead of bringing its own palette.
 *
 * Lives in core so any app can register the dev-doc block. The line differ is
 * inlined (a small LCS-based `diffLines`) rather than pulling the `diff` package
 * into core; the output shape (`{ value, added, removed }` change records) is
 * identical to what the read renderer consumed before.
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
export function diffLines(before: string, after: string): Change[] {
  const a = toLineTokens(before);
  const b = toLineTokens(after);
  const n = a.length;
  const m = b.length;
  const cells = (n + 1) * (m + 1);

  if (cells > MAX_DIFF_LCS_CELLS) {
    return [
      ...(before ? [{ value: before, removed: true }] : []),
      ...(after ? [{ value: after, added: true }] : []),
    ];
  }

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

/* ── Syntax highlighting ───────────────────────────────────────────────────── */

const lowlight = createLowlight(common);

type LowlightNode = {
  type: string;
  value?: string;
  properties?: {
    className?: string[] | string;
  };
  children?: LowlightNode[];
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  cts: "typescript",
  htm: "html",
  js: "javascript",
  jsonc: "json",
  jsx: "jsx",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml",
  zsh: "bash",
};

const TOKEN_CLASS_NAMES: Record<string, string> = {
  "hljs-addition": "text-emerald-700 dark:text-emerald-300",
  "hljs-attr": "text-primary",
  "hljs-attribute": "text-primary",
  "hljs-built_in": "text-amber-700 dark:text-amber-300",
  "hljs-bullet": "text-primary",
  "hljs-comment": "text-muted-foreground italic",
  "hljs-deletion": "text-destructive",
  "hljs-doctag": "text-destructive",
  "hljs-emphasis": "italic",
  "hljs-formula": "text-destructive",
  "hljs-keyword": "text-destructive",
  "hljs-link": "text-primary underline-offset-2",
  "hljs-literal": "text-primary",
  "hljs-meta": "text-primary",
  "hljs-meta-string": "text-emerald-700 dark:text-emerald-300",
  "hljs-name": "text-emerald-700 dark:text-emerald-300",
  "hljs-number": "text-primary",
  "hljs-params": "text-primary",
  "hljs-property": "text-primary",
  "hljs-quote": "text-muted-foreground italic",
  "hljs-regexp": "text-emerald-700 dark:text-emerald-300",
  "hljs-section": "text-violet-700 dark:text-violet-300",
  "hljs-selector-attr": "text-primary",
  "hljs-selector-class": "text-emerald-700 dark:text-emerald-300",
  "hljs-selector-id": "text-emerald-700 dark:text-emerald-300",
  "hljs-selector-pseudo": "text-primary",
  "hljs-selector-tag": "text-emerald-700 dark:text-emerald-300",
  "hljs-string": "text-emerald-700 dark:text-emerald-300",
  "hljs-strong": "font-semibold",
  "hljs-subst": "text-destructive",
  "hljs-symbol": "text-primary",
  "hljs-tag": "text-emerald-700 dark:text-emerald-300",
  "hljs-template-variable": "text-amber-700 dark:text-amber-300",
  "hljs-title": "text-violet-700 dark:text-violet-300",
  "hljs-type": "text-amber-700 dark:text-amber-300",
  "hljs-variable": "text-amber-700 dark:text-amber-300",
  language_: "text-amber-700 dark:text-amber-300",
};

function normalizeLanguage(value?: string | null): string | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  const normalized = LANGUAGE_ALIASES[raw] ?? raw;
  return lowlight.registered(normalized) ? normalized : null;
}

function getLanguageFromFilename(filename?: string): string | null {
  const basename = filename?.split("/").pop()?.toLowerCase();
  if (!basename) return null;
  if (basename === "dockerfile") return normalizeLanguage("bash");
  if (basename === "makefile") return normalizeLanguage("makefile");
  const ext = basename.includes(".") ? basename.split(".").pop() : basename;
  return normalizeLanguage(ext);
}

function resolveDiffLanguage(data: DiffData): string {
  return (
    normalizeLanguage(data.language) ??
    getLanguageFromFilename(data.filename) ??
    "plaintext"
  );
}

function tokenClassName(className?: string[] | string): string | undefined {
  const classes = Array.isArray(className)
    ? className
    : className
      ? className.split(/\s+/)
      : [];
  const mapped = classes
    .map((name) => TOKEN_CLASS_NAMES[name])
    .filter(Boolean)
    .join(" ");
  return mapped || undefined;
}

function hastToReact(children: LowlightNode[], keyPrefix: string): ReactNode[] {
  return children.map((node, index) => {
    if (node.type === "text") return node.value ?? "";
    if (node.type === "element") {
      const key = `${keyPrefix}${index}`;
      const renderedChildren = node.children?.length
        ? hastToReact(node.children, `${key}-`)
        : null;
      const className = tokenClassName(node.properties?.className);
      if (className) {
        return (
          <span key={key} className={className}>
            {renderedChildren}
          </span>
        );
      }
      return <span key={key}>{renderedChildren}</span>;
    }
    return null;
  });
}

function SyntaxHighlightedLine({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const highlighted = useMemo(() => {
    if (!code.trim() || language === "plaintext" || language === "text") {
      return null;
    }
    try {
      const tree = lowlight.highlight(language, code) as LowlightNode;
      return hastToReact(tree.children ?? [], `${language}-`);
    } catch {
      return null;
    }
  }, [code, language]);

  return <>{highlighted ?? code}</>;
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

/** Which column a split-view row belongs to (the unified view passes nothing). */
type RowSide = "old" | "new";

/**
 * Resolve the markers landing on a row. `side` scopes the lookup to one column
 * in the split view (so a left cell only lights from `before` annotations and a
 * right cell from `after`); the unified view omits it to merge both sides.
 */
type MarkersForRow = (
  row: DiffRow,
  side?: RowSide,
) => ResolvedAnnotation<DiffAnnotation>[];

/** The default side an annotation targets when `side` is omitted. */
function annotationSide(annotation: DiffAnnotation): "before" | "after" {
  return annotation.side === "before" ? "before" : "after";
}

/**
 * Count 1-based source lines in a side's text, matching how `buildRows` numbers
 * `oldNo`/`newNo`: a trailing newline does not add a phantom final line.
 */
function countLines(text: string): number {
  if (text === "") return 0;
  return splitLines(text).length;
}

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
 *
 * `isAnchored` marks context rows that carry an annotation (or sit adjacent to
 * one): an anchored row is NEVER hidden inside a collapsed run, so a note that
 * targets an unchanged line stays reachable. An anchor splits its run into the
 * separately-collapsible spans on either side of it, with CONTEXT_EDGE rows kept
 * visible around the anchor.
 */
function segmentRows(
  rows: DiffRow[],
  isAnchored?: (row: DiffRow) => boolean,
): DiffSegment[] {
  const segments: DiffSegment[] = [];

  // Collapse one contiguous context run [from, to) that contains NO anchors.
  const collapseRun = (run: DiffRow[], atStart: boolean, atEnd: boolean) => {
    if (run.length <= COLLAPSE_THRESHOLD) {
      for (const row of run) segments.push(row);
      return;
    }
    const head = atStart ? [] : run.slice(0, CONTEXT_EDGE);
    const tail = atEnd ? [] : run.slice(run.length - CONTEXT_EDGE);
    const hidden = run.slice(head.length, run.length - tail.length);
    for (const row of head) segments.push(row);
    if (hidden.length > 0) segments.push({ collapsed: true, rows: hidden });
    for (const row of tail) segments.push(row);
  };

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
    const fullRun = rows.slice(i, j);
    const runAtStart = i === 0;
    const runAtEnd = j === rows.length;

    if (!isAnchored || !fullRun.some(isAnchored)) {
      collapseRun(fullRun, runAtStart, runAtEnd);
    } else {
      // Walk the run, emitting anchored rows verbatim and collapsing the
      // unanchored spans between them. An anchored row is always visible; the
      // spans on each side of it collapse independently.
      let spanStart = 0;
      for (let k = 0; k <= fullRun.length; k += 1) {
        const atAnchor = k < fullRun.length && isAnchored(fullRun[k]);
        if (atAnchor || k === fullRun.length) {
          const span = fullRun.slice(spanStart, k);
          if (span.length > 0) {
            collapseRun(
              span,
              runAtStart && spanStart === 0,
              runAtEnd && k === fullRun.length,
            );
          }
          if (k < fullRun.length) segments.push(fullRun[k]);
          spanStart = k + 1;
        }
      }
    }
    i = j;
  }
  return segments;
}

/* ── Theme-aware row styling (light + dark) ────────────────────────────────── */

const ROW_BG: Record<DiffRowKind, string> = {
  added: "bg-emerald-500/10 dark:bg-emerald-500/15",
  removed: "bg-destructive/10",
  context: "bg-background",
};

const GUTTER_BG: Record<DiffRowKind, string> = {
  added: "bg-emerald-500/15 dark:bg-emerald-500/20",
  removed: "bg-destructive/15",
  context: "bg-muted/60",
};

const SIGN_COLOR: Record<DiffRowKind, string> = {
  added: "text-emerald-700 dark:text-emerald-300",
  removed: "text-destructive",
  context: "text-muted-foreground",
};

const SIGN: Record<DiffRowKind, string> = {
  added: "+",
  removed: "−",
  context: " ",
};

const LINE_NO_CLASS =
  "select-none px-2 py-0 text-right font-mono [font-size:var(--plan-doc-code-size)] leading-5 text-muted-foreground tabular-nums";

const DIFF_LINE_CLASS =
  "block min-w-max flex-1 whitespace-pre px-2 py-0 font-mono [font-size:var(--plan-doc-code-size)] leading-5 text-foreground";

const DEFAULT_VISIBLE_DIFF_LINES = 15;
const MAX_DIFF_LCS_CELLS = 1_000_000;
const DIFF_MODE_STORAGE_KEY = "agent-native:diff-view-mode";
const DIFF_MODE_STORAGE_EVENT = "agent-native:diff-view-mode-change";

/**
 * Below this rendered container width (px) a diff drops side-by-side `split`
 * mode and falls back to `unified`: split's two line-number gutters double the
 * width the code needs, exactly where space is tightest (e.g. a diff nested in a
 * vertical-tabs content column). Measured from the block's own box, not the
 * viewport, so the fallback fires by available width at any nesting depth.
 */
const SPLIT_MIN_WIDTH = 560;

/**
 * Observe the rendered inline width of an element. Returns a ref to attach plus
 * the measured content-box width (null until the first ResizeObserver tick).
 * Lets the diff pick an effective mode from the width it was actually handed — a
 * measurement CSS container queries can't drive, since switching split↔unified
 * is a structural (DOM) change, not a style toggle.
 */
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function isDiffMode(value: unknown): value is DiffMode {
  return value === "unified" || value === "split";
}

function readStoredDiffMode(): DiffMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage?.getItem(DIFF_MODE_STORAGE_KEY);
    return isDiffMode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredDiffMode(mode: DiffMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(DIFF_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable in sandboxed/private contexts.
  }
}

function dispatchDiffModeChange(mode: DiffMode): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<DiffMode>(DIFF_MODE_STORAGE_EVENT, { detail: mode }),
    );
  } catch {
    // Best-effort sync; local component state and storage already changed.
  }
}

function usePreferredDiffMode(authoredMode: DiffMode | undefined) {
  const [mode, setMode] = useState<DiffMode>(authoredMode ?? "split");

  useEffect(() => {
    if (authoredMode) return;
    const storedMode = readStoredDiffMode();
    if (storedMode) setMode(storedMode);
  }, [authoredMode]);

  useEffect(() => {
    if (authoredMode) return;
    if (typeof window === "undefined") return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== DIFF_MODE_STORAGE_KEY) return;
      if (isDiffMode(event.newValue)) setMode(event.newValue);
    };
    const onModeChange = (event: Event) => {
      const mode = (event as CustomEvent<unknown>).detail;
      if (isDiffMode(mode)) setMode(mode);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(DIFF_MODE_STORAGE_EVENT, onModeChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DIFF_MODE_STORAGE_EVENT, onModeChange);
    };
  }, [authoredMode]);

  const setPreferredMode = useCallback((nextMode: DiffMode) => {
    setMode(nextMode);
    writeStoredDiffMode(nextMode);
    dispatchDiffModeChange(nextMode);
  }, []);

  return [mode, setPreferredMode] as const;
}

function splitDiffFilename(filename?: string): {
  basename: string;
  directory: string | null;
} {
  const value = filename?.trim() || "diff";
  const segments = value.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] ?? value;
  const directory =
    segments.length > 1 ? segments.slice(0, -1).join("/") : null;
  return { basename, directory };
}

function DiffLineText({ language, text }: { language: string; text: string }) {
  const code = text || " ";
  return (
    <span className={DIFF_LINE_CLASS}>
      <SyntaxHighlightedLine code={code} language={language} />
    </span>
  );
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

function DiffRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<DiffData>) {
  // Default layout when none is authored is SPLIT so reviewers can compare
  // before/after code side-by-side. An explicitly authored `mode` or stored
  // viewer preference still wins, and truly narrow hosts can fall back below.
  const inNarrowContainer = useInNarrowContainer();
  const [mode, setMode] = usePreferredDiffMode(data.mode);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [showAllRows, setShowAllRows] = useState(false);
  const [containerRef, containerWidth] = useContainerWidth<HTMLElement>();
  // On-hover popover (anchored to the right of the code) replaces the old
  // persistent rail: nothing is shown when idle. `codeRef` measures the code
  // box's right edge; `hover` carries the active index + captured geometry.
  const hover = useAnnotationHover();
  const { activeIndex } = hover;
  const codeRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => buildRows(diffLines(data.before, data.after)),
    [data.before, data.after],
  );
  const language = useMemo(
    () => resolveDiffLanguage(data),
    [data.filename, data.language],
  );
  const fileParts = useMemo(
    () => splitDiffFilename(data.filename),
    [data.filename],
  );
  const splitLineCount = useMemo(() => pairSplitRows(rows).length, [rows]);

  // Resolve annotations against the side they target. A `before` annotation's
  // `lines` ref is clamped to the OLD file's line count and matched on `oldNo`;
  // an `after` (default) ref to the NEW file and matched on `newNo`. Markers are
  // authoring-order across BOTH sides so a note ↔ row ↔ rail card share one id.
  const beforeLineCount = useMemo(() => countLines(data.before), [data.before]);
  const afterLineCount = useMemo(() => countLines(data.after), [data.after]);
  const showAnnotationOverlays = Boolean(ctx.showCodeAnnotationOverlays);
  const annotationLayout = ctx.codeAnnotationLayout;
  const annotationHoverSide = annotationLayout?.hoverSide ?? "right";
  const annotationHoverFallbackSide =
    annotationLayout?.hoverFallbackSide ?? "right";
  const annotationMarginSide = annotationLayout?.marginSide ?? "auto";
  const defaultVisibleAnnotations =
    annotationLayout?.defaultVisibleAnnotations ??
    (annotationLayout?.showByDefaultWhenRoom ? "all" : undefined);
  const resolved = useMemo(
    () =>
      resolveAnnotations(data.annotations, (annotation) =>
        annotationSide(annotation) === "before"
          ? beforeLineCount
          : afterLineCount,
      ),
    [data.annotations, beforeLineCount, afterLineCount],
  );
  const hasAnnotations = hasRailAnnotations(resolved);
  const showMarginAnnotations = useAnnotationMarginNotesAvailable({
    containerRef: codeRef,
    enabled: Boolean(
      hasAnnotations && !showAnnotationOverlays && defaultVisibleAnnotations,
    ),
    side: annotationMarginSide,
    preferredSide: annotationHoverSide,
  });
  const showPersistentAnnotations =
    showAnnotationOverlays || showMarginAnnotations;
  const persistentAnnotationIndexes = useMemo(() => {
    if (!showMarginAnnotations || !defaultVisibleAnnotations) {
      return new Set<number>();
    }
    const visible = resolved.filter((item) => item.range);
    if (defaultVisibleAnnotations === "first") {
      const first = visible[0];
      return first ? new Set([first.index]) : new Set<number>();
    }
    return new Set(visible.map((item) => item.index));
  }, [defaultVisibleAnnotations, resolved, showMarginAnnotations]);
  const captureOverlayAnnotationIndex = useMemo(
    () => resolved.find((item) => item.range)?.index ?? null,
    [resolved],
  );
  // Effective render mode. Annotations live in a SEPARATE right-hand rail (not
  // over the code), so they no longer force a mode. When no mode was authored, a
  // truly narrow container still falls back to unified so split's doubled
  // gutters never crush the code; an explicitly authored `mode` wins even in a
  // narrow host. `canSplit` only hides the toggle for auto-mode narrow fallbacks.
  const measuredNarrow =
    containerWidth != null && containerWidth < SPLIT_MIN_WIDTH;
  const narrow = data.mode == null && (measuredNarrow || inNarrowContainer);
  const canSplit = !narrow;
  const effectiveMode: DiffMode = canSplit ? mode : "unified";

  // Annotations (diff): NO persistent column. Hovering a marked code line (or
  // its numbered pip) opens THAT note's card as an on-hover popover anchored to
  // the RIGHT of the code box, never over the code. The in-code pip stays as the
  // anchor indicator + active-line highlight. `onRowEnter` captures the code
  // box's right edge + the hovered row's vertical position to place the card;
  // `onRowLeave` schedules a short-delay close so the pointer can cross the gap
  // into the card (which cancels the close while hovered).
  const onRowEnter = useCallback(
    (index: number, rowEl: HTMLElement) => {
      const startRow =
        codeRef.current?.querySelector<HTMLElement>(
          `[data-annot-row="${index}"]`,
        ) ?? rowEl;
      const anchor = anchorFromElements(codeRef.current, startRow);
      if (anchor) hover.open(index, anchor);
    },
    [hover],
  );
  const onRowLeave = useCallback(() => hover.scheduleClose(), [hover]);
  const onRowClick = useCallback(
    (index: number, rowEl: HTMLElement) => {
      const startRow =
        codeRef.current?.querySelector<HTMLElement>(
          `[data-annot-row="${index}"]`,
        ) ?? rowEl;
      const anchor = anchorFromElements(codeRef.current, startRow);
      if (anchor) hover.open(index, anchor);
    },
    [hover],
  );
  // Side-scoped line → markers maps so a row only lights from its own side.
  const beforeMarkers = useMemo(
    () =>
      buildLineMarkerMap(
        resolved.filter((r) => annotationSide(r.annotation) === "before"),
      ),
    [resolved],
  );
  const afterMarkers = useMemo(
    () =>
      buildLineMarkerMap(
        resolved.filter((r) => annotationSide(r.annotation) !== "before"),
      ),
    [resolved],
  );
  const markersForRow = useMemo<MarkersForRow>(() => {
    return (row, side) => {
      const out: ResolvedAnnotation<DiffAnnotation>[] = [];
      if (
        (side === undefined || side === "old") &&
        row.oldNo != null &&
        row.kind !== "added"
      ) {
        out.push(...(beforeMarkers.get(row.oldNo) ?? []));
      }
      if (
        (side === undefined || side === "new") &&
        row.newNo != null &&
        row.kind !== "removed"
      ) {
        out.push(...(afterMarkers.get(row.newNo) ?? []));
      }
      return out;
    };
  }, [beforeMarkers, afterMarkers]);
  // A context row that carries a marker is an anchor: never collapse it away.
  const anchoredRow = useMemo(() => {
    if (!hasAnnotations) return undefined;
    return (row: DiffRow) => markersForRow(row).length > 0;
  }, [hasAnnotations, markersForRow]);

  // The resolved annotation whose card is currently shown on hover.
  const activeItem = useMemo<ResolvedAnnotation<DiffAnnotation> | null>(
    () =>
      activeIndex == null
        ? null
        : (resolved.find((item) => item.index === activeIndex) ?? null),
    [activeIndex, resolved],
  );
  const activeItemIsPersistentlyVisible = Boolean(
    activeItem &&
    !showAnnotationOverlays &&
    persistentAnnotationIndexes.has(activeItem.index),
  );

  const added = rows.filter((r) => r.kind === "added").length;
  const removed = rows.filter((r) => r.kind === "removed").length;
  const unchanged = data.before === data.after;
  const totalVisibleLineCount =
    effectiveMode === "split" ? splitLineCount : rows.length;
  const shouldLimitRows = totalVisibleLineCount > DEFAULT_VISIBLE_DIFF_LINES;
  // Never truncate away an annotated row: extend the window past the last one.
  const effectiveRowLimit = useMemo(() => {
    if (showAllRows || !shouldLimitRows) return undefined;
    let limit = DEFAULT_VISIBLE_DIFF_LINES;
    if (hasAnnotations) {
      for (let idx = rows.length - 1; idx >= limit; idx -= 1) {
        if (markersForRow(rows[idx]).length > 0) {
          limit = idx + 1;
          break;
        }
      }
    }
    return limit;
  }, [showAllRows, shouldLimitRows, hasAnnotations, rows, markersForRow]);
  const rowLimit = effectiveRowLimit;
  const displayedRows =
    effectiveMode === "unified" && rowLimit ? rows.slice(0, rowLimit) : rows;

  const toggleRun = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  // The bordered code box. It always spans its full width — annotations surface
  // as an on-hover popover anchored to this box's right edge, never as a column.
  // `codeRef` measures that right edge for the popover's placement.
  const diffBox = (
    <div
      ref={codeRef}
      className="overflow-hidden rounded-md border border-border bg-background"
    >
      {/* Header: filename, path, +/− counts, mode toggle. */}
      <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
        <IconFileDiff className="size-4 shrink-0 text-muted-foreground" />
        <span
          className="flex min-w-0 flex-1 items-baseline gap-1.5 font-mono"
          title={data.filename || undefined}
        >
          <span className="min-w-0 max-w-[16rem] truncate text-[13px] font-semibold leading-5 text-foreground">
            {fileParts.basename}
          </span>
          {fileParts.directory && (
            <span className="min-w-0 flex-1 truncate text-[11px] leading-5 text-muted-foreground/70">
              {fileParts.directory}
            </span>
          )}
        </span>
        <span className="ml-1 flex shrink-0 items-center gap-2 font-mono text-xs">
          <span className="text-emerald-700 dark:text-emerald-300">
            +{added}
          </span>
          <span className="text-destructive">−{removed}</span>
        </span>
        {/* Mode toggle only when split is actually available: a narrow
              container forces unified (split's doubled gutters would crush the
              code), so the toggle would otherwise be a no-op. Annotations are an
              on-hover popover now, so they work in both unified and split. */}
        {canSplit && (
          <div className="pointer-events-none ml-auto flex shrink-0 items-center overflow-hidden rounded-md border border-border bg-background opacity-0 transition-opacity group-hover/diff-block:pointer-events-auto group-hover/diff-block:opacity-100 group-focus-within/diff-block:pointer-events-auto group-focus-within/diff-block:opacity-100">
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
        )}
      </div>

      {/* Body. */}
      {unchanged ? (
        <div className="px-4 py-6 text-center font-mono text-sm text-muted-foreground">
          No changes
        </div>
      ) : effectiveMode === "split" ? (
        <SplitView
          rows={rows}
          language={language}
          rowLimit={rowLimit}
          markersForRow={markersForRow}
          activeIndex={activeIndex}
          onRowEnter={onRowEnter}
          onRowLeave={onRowLeave}
          onRowClick={onRowClick}
          showAnnotationOverlays={showPersistentAnnotations}
          annotationOverlayMode={showAnnotationOverlays ? "capture" : "margin"}
          annotationOverlaySide={
            showAnnotationOverlays ? "right" : annotationMarginSide
          }
          annotationOverlayPreferredSide={annotationHoverSide}
          annotationOverlayContainerRef={codeRef}
          captureOverlayAnnotationIndex={captureOverlayAnnotationIndex}
          persistentAnnotationIndexes={persistentAnnotationIndexes}
          ctx={ctx}
        />
      ) : (
        <UnifiedView
          rows={displayedRows}
          language={language}
          expanded={expanded}
          onToggleRun={toggleRun}
          markersForRow={markersForRow}
          anchoredRow={anchoredRow}
          activeIndex={activeIndex}
          onRowEnter={onRowEnter}
          onRowLeave={onRowLeave}
          onRowClick={onRowClick}
          showAnnotationOverlays={showPersistentAnnotations}
          annotationOverlayMode={showAnnotationOverlays ? "capture" : "margin"}
          annotationOverlaySide={
            showAnnotationOverlays ? "right" : annotationMarginSide
          }
          annotationOverlayPreferredSide={annotationHoverSide}
          annotationOverlayContainerRef={codeRef}
          captureOverlayAnnotationIndex={captureOverlayAnnotationIndex}
          persistentAnnotationIndexes={persistentAnnotationIndexes}
          ctx={ctx}
        />
      )}
      {!unchanged && shouldLimitRows && (
        <button
          type="button"
          data-plan-interactive
          aria-expanded={showAllRows}
          onClick={() => setShowAllRows((current) => !current)}
          className="flex h-7 w-full items-center justify-center gap-1.5 border-t border-border bg-background px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <IconChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              showAllRows ? "-rotate-90" : "rotate-90",
            )}
          />
          {showAllRows
            ? "Show fewer"
            : `Show all ${totalVisibleLineCount} lines`}
        </button>
      )}
    </div>
  );

  return (
    <section
      {...ltrCodeBlockProps}
      ref={containerRef}
      className="relative plan-block group/diff-block"
      data-block-id={blockId}
    >
      {title && <div className="plan-block-label">{title}</div>}
      {summary && (
        <p className="mb-3 text-sm leading-relaxed text-plan-muted">
          {summary}
        </p>
      )}
      {/* The diff keeps its full width — no persistent annotation column. The
          in-code numbered pips remain the hover anchors; notes live in a
          visually-hidden stack (a11y + tests) and surface ONE at a time as an
          on-hover popover anchored to the right of the code box. */}
      {diffBox}
      {hasAnnotations && (
        <AnnotationHiddenStack items={resolved} ctx={ctx} showMarker />
      )}
      {hasAnnotations &&
        !showAnnotationOverlays &&
        !activeItemIsPersistentlyVisible &&
        activeItem &&
        hover.anchor && (
          <AnnotationHoverCard
            item={activeItem}
            anchor={hover.anchor}
            ctx={ctx}
            showMarker
            preferredSide={annotationHoverSide}
            hoverFallbackSide={annotationHoverFallbackSide}
            onMouseEnter={hover.cancelClose}
            onMouseLeave={hover.scheduleClose}
            onClose={hover.closeForScroll}
            onInteractOutside={hover.close}
          />
        )}
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
  icon: ReactNode;
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
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Annotation wiring shared by both views ────────────────────────────────── */

/** Marker + hover props threaded into the unified/split rows. */
interface RowAnnotationProps {
  markersForRow: MarkersForRow;
  anchoredRow?: (row: DiffRow) => boolean;
  activeIndex: number | null;
  showAnnotationOverlays: boolean;
  ctx: BlockRenderContext;
  /** Hovering an annotated row opens its popover, anchored to this row's box. */
  onRowEnter: (index: number, rowEl: HTMLElement) => void;
  /** Leaving an annotated row schedules the popover's close. */
  onRowLeave: () => void;
  /** Clicking/tapping an annotated row toggles its popover (for touch). */
  onRowClick: (index: number, rowEl: HTMLElement) => void;
  annotationOverlayMode: "capture" | "margin";
  annotationOverlaySide: AnnotationMarginSide;
  annotationOverlayPreferredSide: AnnotationSide;
  annotationOverlayContainerRef: RefObject<HTMLElement | null>;
  captureOverlayAnnotationIndex: number | null;
  persistentAnnotationIndexes: ReadonlySet<number>;
}

/**
 * The numbered marker pip(s) for a row plus the active-state it derives. Returns
 * `null` when the row carries no annotation so unannotated diffs render an empty
 * marker column (or no column at all when the whole diff is unannotated).
 */
function rowMarkerInfo(
  markers: ResolvedAnnotation<DiffAnnotation>[],
  activeIndex: number | null,
): { isActive: boolean; primaryIndex: number } | null {
  if (markers.length === 0) return null;
  const isActive = markers.some((m) => m.index === activeIndex);
  return { isActive, primaryIndex: markers[0].index };
}

/** Shared amber wash for an annotated row, brighter when active. */
function annotatedRowBg(
  info: { isActive: boolean } | null,
  persistentlyVisible = false,
): string | null {
  if (!info) return null;
  if (info.isActive) {
    return "bg-amber-400/[0.12] dark:bg-amber-300/[0.10]";
  }
  return persistentlyVisible
    ? "bg-amber-300/[0.14] dark:bg-amber-300/[0.10]"
    : "bg-amber-400/[0.045] dark:bg-amber-300/[0.045]";
}

/**
 * Whether `row` is the FIRST line of `marker`'s resolved range. The numbered pip
 * renders only on this line, so a multi-line annotation shows a single marker at
 * the top of its span instead of repeating the same number down every line it
 * covers. The amber band still washes the whole range (via `annotatedRowBg`), so
 * the span stays visually grouped without the column of duplicate numbers.
 */
function isMarkerRangeStart(
  row: DiffRow,
  marker: ResolvedAnnotation<DiffAnnotation>,
): boolean {
  if (!marker.range) return false;
  const lineNo =
    annotationSide(marker.annotation) === "before" ? row.oldNo : row.newNo;
  return lineNo === marker.range.start;
}

/* ── Unified view ──────────────────────────────────────────────────────────── */

function UnifiedView({
  rows,
  language,
  expanded,
  onToggleRun,
  markersForRow,
  anchoredRow,
  activeIndex,
  onRowEnter,
  onRowLeave,
  onRowClick,
  showAnnotationOverlays,
  annotationOverlayMode,
  annotationOverlaySide,
  annotationOverlayPreferredSide,
  annotationOverlayContainerRef,
  captureOverlayAnnotationIndex,
  persistentAnnotationIndexes,
  ctx,
}: {
  rows: DiffRow[];
  language: string;
  expanded: Set<number>;
  onToggleRun: (index: number) => void;
} & RowAnnotationProps) {
  const segments = useMemo(
    () => segmentRows(rows, anchoredRow),
    [rows, anchoredRow],
  );
  // Any annotation present ⇒ reserve the marker column so rows stay aligned.
  const showMarkerColumn = useMemo(
    () => rows.some((row) => markersForRow(row).length > 0),
    [rows, markersForRow],
  );
  const rowProps = {
    language,
    markersForRow,
    activeIndex,
    onRowEnter,
    onRowLeave,
    onRowClick,
    showMarkerColumn,
    showAnnotationOverlays,
    annotationOverlayMode,
    annotationOverlaySide,
    annotationOverlayPreferredSide,
    annotationOverlayContainerRef,
    captureOverlayAnnotationIndex,
    persistentAnnotationIndexes,
    ctx,
  };
  let runIndex = 0;
  return (
    <div className="overflow-x-auto" data-code-surface>
      <div className="w-max min-w-full font-mono [font-size:var(--plan-doc-code-size)] leading-5">
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
                    <UnifiedRow
                      key={`run-${key}-${ri}`}
                      row={row}
                      {...rowProps}
                    />
                  ))}
              </div>
            );
          }
          return <UnifiedRow key={idx} row={segment} {...rowProps} />;
        })}
      </div>
    </div>
  );
}

function UnifiedRow({
  language,
  row,
  markersForRow,
  activeIndex,
  onRowEnter,
  onRowLeave,
  onRowClick,
  showMarkerColumn,
  showAnnotationOverlays,
  annotationOverlayMode,
  annotationOverlaySide,
  annotationOverlayPreferredSide,
  annotationOverlayContainerRef,
  captureOverlayAnnotationIndex,
  persistentAnnotationIndexes,
  ctx,
}: {
  language: string;
  row: DiffRow;
  markersForRow: MarkersForRow;
  activeIndex: number | null;
  onRowEnter: (index: number, rowEl: HTMLElement) => void;
  onRowLeave: () => void;
  onRowClick: (index: number, rowEl: HTMLElement) => void;
  showMarkerColumn: boolean;
  showAnnotationOverlays: boolean;
  annotationOverlayMode: "capture" | "margin";
  annotationOverlaySide: AnnotationMarginSide;
  annotationOverlayPreferredSide: AnnotationSide;
  annotationOverlayContainerRef: RefObject<HTMLElement | null>;
  captureOverlayAnnotationIndex: number | null;
  persistentAnnotationIndexes: ReadonlySet<number>;
  ctx: BlockRenderContext;
}) {
  const markers = markersForRow(row);
  const info = rowMarkerInfo(markers, activeIndex);
  const startMarker = markers.find((marker) => isMarkerRangeStart(row, marker));
  const primaryIndex = startMarker?.index ?? info?.primaryIndex;
  const overlayItems =
    showAnnotationOverlays &&
    startMarker &&
    (annotationOverlayMode === "capture"
      ? startMarker.index === captureOverlayAnnotationIndex
      : persistentAnnotationIndexes.has(startMarker.index))
      ? [startMarker]
      : [];
  const rowHasPersistentAnnotation = markers.some((marker) =>
    persistentAnnotationIndexes.has(marker.index),
  );
  return (
    <div
      data-annot-row={startMarker ? startMarker.index : undefined}
      tabIndex={info ? 0 : undefined}
      role={info ? "button" : undefined}
      aria-expanded={info ? info.isActive : undefined}
      className={cn(
        "relative flex min-h-5 min-w-full",
        info && "cursor-pointer",
        ROW_BG[row.kind],
        annotatedRowBg(info, rowHasPersistentAnnotation),
      )}
      onMouseEnter={
        info && primaryIndex != null
          ? (event) => onRowEnter(primaryIndex, event.currentTarget)
          : undefined
      }
      onMouseLeave={info ? () => onRowLeave() : undefined}
      onClick={
        info && primaryIndex != null
          ? (event) => onRowClick(primaryIndex, event.currentTarget)
          : undefined
      }
      onKeyDown={
        info && primaryIndex != null
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onRowClick(primaryIndex, event.currentTarget);
            }
          : undefined
      }
      onFocus={
        info && primaryIndex != null
          ? (event) => onRowEnter(primaryIndex, event.currentTarget)
          : undefined
      }
      onBlur={info ? () => onRowLeave() : undefined}
    >
      <span className={cn(LINE_NO_CLASS, "w-[52px]")}>{row.oldNo ?? ""}</span>
      <span className={cn(LINE_NO_CLASS, "w-[52px]")}>{row.newNo ?? ""}</span>
      <span
        className={cn(
          "w-6 shrink-0 select-none py-0 text-center font-semibold leading-5",
          GUTTER_BG[row.kind],
          SIGN_COLOR[row.kind],
        )}
      >
        {SIGN[row.kind]}
      </span>
      {showMarkerColumn && (
        <MarkerCell
          startMarker={startMarker}
          active={
            startMarker != null &&
            (startMarker.index === activeIndex ||
              persistentAnnotationIndexes.has(startMarker.index))
          }
        />
      )}
      <DiffLineText text={row.text} language={language} />
      {overlayItems.length > 0 && (
        <AnnotationInlineOverlayStack
          items={overlayItems}
          ctx={ctx}
          showMarker
          containerRef={annotationOverlayContainerRef}
          mode={annotationOverlayMode}
          side={annotationOverlaySide}
          preferredSide={annotationOverlayPreferredSide}
        />
      )}
    </div>
  );
}

/**
 * The fixed-width marker column rendered between the sign gutter and the code.
 * `startMarker` is set only on the FIRST line of an annotation's range, so the
 * numbered pip appears once at the top of a span; every other row (the rest of a
 * span, and every unannotated row in a diff that has annotations) renders an
 * empty spacer so the code text stays aligned.
 */
function MarkerCell({
  startMarker,
  active,
}: {
  startMarker?: ResolvedAnnotation<DiffAnnotation>;
  active: boolean;
}) {
  return (
    <span className="flex w-6 shrink-0 select-none items-center justify-center py-0">
      {startMarker != null && (
        <AnnotationGutterMarker marker={startMarker.marker} active={active} />
      )}
    </span>
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
      className="flex w-full cursor-pointer items-center gap-2 border-y border-border bg-muted/70 px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

function SplitView({
  language,
  rowLimit,
  rows,
  markersForRow,
  activeIndex,
  onRowEnter,
  onRowLeave,
  onRowClick,
  showAnnotationOverlays,
  annotationOverlayMode,
  annotationOverlaySide,
  annotationOverlayPreferredSide,
  annotationOverlayContainerRef,
  captureOverlayAnnotationIndex,
  persistentAnnotationIndexes,
  ctx,
}: {
  language: string;
  rowLimit?: number;
  rows: DiffRow[];
} & Omit<RowAnnotationProps, "anchoredRow">) {
  const pairs = useMemo(() => pairSplitRows(rows), [rows]);
  const displayedPairs = rowLimit ? pairs.slice(0, rowLimit) : pairs;
  // Reserve the marker column on a side only if any visible row there has one.
  const showOldMarkers = useMemo(
    () =>
      displayedPairs.some(
        (pair) => pair.left && markersForRow(pair.left, "old").length > 0,
      ),
    [displayedPairs, markersForRow],
  );
  const showNewMarkers = useMemo(
    () =>
      displayedPairs.some(
        (pair) => pair.right && markersForRow(pair.right, "new").length > 0,
      ),
    [displayedPairs, markersForRow],
  );
  const cellProps = {
    language,
    markersForRow,
    activeIndex,
    onRowEnter,
    onRowLeave,
    onRowClick,
    showAnnotationOverlays,
    annotationOverlayMode,
    annotationOverlaySide,
    annotationOverlayPreferredSide,
    annotationOverlayContainerRef,
    captureOverlayAnnotationIndex,
    persistentAnnotationIndexes,
    ctx,
  };
  return (
    <div
      className="flex w-full bg-background font-mono [font-size:var(--plan-doc-code-size)] leading-5"
      data-code-surface
    >
      <div className="min-w-0 flex-1 overflow-x-auto border-r border-border">
        <div className="inline-block min-w-full">
          {displayedPairs.map((pair, idx) => (
            <SplitCell
              key={`old-${idx}`}
              row={pair.left}
              side="old"
              showMarkerColumn={showOldMarkers}
              {...cellProps}
            />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="inline-block min-w-full">
          {displayedPairs.map((pair, idx) => (
            <SplitCell
              key={`new-${idx}`}
              row={pair.right}
              side="new"
              showMarkerColumn={showNewMarkers}
              {...cellProps}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SplitCell({
  language,
  row,
  side,
  markersForRow,
  activeIndex,
  onRowEnter,
  onRowLeave,
  onRowClick,
  showMarkerColumn,
  showAnnotationOverlays,
  annotationOverlayMode,
  annotationOverlaySide,
  annotationOverlayPreferredSide,
  annotationOverlayContainerRef,
  captureOverlayAnnotationIndex,
  persistentAnnotationIndexes,
  ctx,
}: {
  language: string;
  row?: DiffRow;
  side: RowSide;
  markersForRow: MarkersForRow;
  activeIndex: number | null;
  onRowEnter: (index: number, rowEl: HTMLElement) => void;
  onRowLeave: () => void;
  onRowClick: (index: number, rowEl: HTMLElement) => void;
  showMarkerColumn: boolean;
  showAnnotationOverlays: boolean;
  annotationOverlayMode: "capture" | "margin";
  annotationOverlaySide: AnnotationMarginSide;
  annotationOverlayPreferredSide: AnnotationSide;
  annotationOverlayContainerRef: RefObject<HTMLElement | null>;
  captureOverlayAnnotationIndex: number | null;
  persistentAnnotationIndexes: ReadonlySet<number>;
  ctx: BlockRenderContext;
}) {
  if (!row) {
    return (
      <div className="flex min-h-5 min-w-full bg-muted/40 opacity-70">
        <span className={cn(LINE_NO_CLASS, "w-[52px]")} />
        <span className="w-6 shrink-0 bg-muted/60" />
        {showMarkerColumn && <span className="w-6 shrink-0" />}
        <span className={DIFF_LINE_CLASS}> </span>
      </div>
    );
  }
  const sign = side === "old" ? "−" : "+";
  const showSign = row.kind !== "context";
  const markers = markersForRow(row, side);
  const info = rowMarkerInfo(markers, activeIndex);
  const startMarker = markers.find((marker) => isMarkerRangeStart(row, marker));
  const primaryIndex = startMarker?.index ?? info?.primaryIndex;
  const overlayItems =
    showAnnotationOverlays &&
    startMarker &&
    (annotationOverlayMode === "capture"
      ? startMarker.index === captureOverlayAnnotationIndex
      : persistentAnnotationIndexes.has(startMarker.index))
      ? [startMarker]
      : [];
  const rowHasPersistentAnnotation = markers.some((marker) =>
    persistentAnnotationIndexes.has(marker.index),
  );
  return (
    <div
      data-annot-row={startMarker ? startMarker.index : undefined}
      tabIndex={info ? 0 : undefined}
      role={info ? "button" : undefined}
      aria-expanded={info ? info.isActive : undefined}
      className={cn(
        "relative flex min-h-5 min-w-full",
        info && "cursor-pointer",
        ROW_BG[row.kind],
        annotatedRowBg(info, rowHasPersistentAnnotation),
      )}
      onMouseEnter={
        info && primaryIndex != null
          ? (event) => onRowEnter(primaryIndex, event.currentTarget)
          : undefined
      }
      onMouseLeave={info ? () => onRowLeave() : undefined}
      onClick={
        info && primaryIndex != null
          ? (event) => onRowClick(primaryIndex, event.currentTarget)
          : undefined
      }
      onKeyDown={
        info && primaryIndex != null
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onRowClick(primaryIndex, event.currentTarget);
            }
          : undefined
      }
      onFocus={
        info && primaryIndex != null
          ? (event) => onRowEnter(primaryIndex, event.currentTarget)
          : undefined
      }
      onBlur={info ? () => onRowLeave() : undefined}
    >
      <span className={cn(LINE_NO_CLASS, "w-[52px]")}>
        {side === "old" ? (row.oldNo ?? "") : (row.newNo ?? "")}
      </span>
      <span
        className={cn(
          "w-6 shrink-0 select-none py-0 text-center font-semibold leading-5",
          GUTTER_BG[row.kind],
          SIGN_COLOR[row.kind],
        )}
      >
        {showSign ? sign : " "}
      </span>
      {showMarkerColumn && (
        <MarkerCell
          startMarker={startMarker}
          active={
            startMarker != null &&
            (startMarker.index === activeIndex ||
              persistentAnnotationIndexes.has(startMarker.index))
          }
        />
      )}
      <DiffLineText text={row.text} language={language} />
      {overlayItems.length > 0 && (
        <AnnotationInlineOverlayStack
          items={overlayItems}
          ctx={ctx}
          showMarker
          containerRef={annotationOverlayContainerRef}
          mode={annotationOverlayMode}
          side={annotationOverlaySide}
          preferredSide={annotationOverlayPreferredSide}
        />
      )}
    </div>
  );
}

/* ── Edit (panel) ──────────────────────────────────────────────────────────── */

const codeAreaClass =
  "min-h-[140px] font-mono [font-size:var(--plan-code-size)] leading-5";

function DiffEdit({ data, onChange, editable }: BlockEditProps<DiffData>) {
  const patch = (next: Partial<DiffData>) => onChange({ ...data, ...next });
  const mode: DiffMode = data.mode ?? "split";
  const annotations = data.annotations ?? [];

  const updateAnnotation = (index: number, next: Partial<DiffAnnotation>) =>
    patch({
      annotations: annotations.map((annotation, i) =>
        i === index ? { ...annotation, ...next } : annotation,
      ),
    });

  const removeAnnotation = (index: number) =>
    patch({ annotations: annotations.filter((_, i) => i !== index) });

  const addAnnotation = () => {
    if (annotations.length >= 80) return; // schema max
    patch({
      annotations: [
        ...annotations,
        { side: "after", lines: "1", label: "", note: "" },
      ],
    });
  };

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

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <DevLabel className="text-xs">Annotations</DevLabel>
          {editable && annotations.length < 80 && (
            <button
              type="button"
              data-plan-interactive
              onClick={addAnnotation}
              className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-plan-muted transition-colors hover:bg-plan-block/60 hover:text-plan-text"
            >
              <IconPlus className="size-3.5" />
              Add annotation
            </button>
          )}
        </div>
        {annotations.length === 0 && (
          <p className="text-xs text-plan-muted">
            No annotations yet. Add one to anchor a note to a line range on the
            before or after side.
          </p>
        )}
        {annotations.map((annotation, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-plan-line bg-plan-block/30 p-2"
          >
            <div className="grid gap-2 sm:grid-cols-[110px_110px_minmax(0,1fr)_auto]">
              <DevSelect
                aria-label={`Annotation ${index + 1} side`}
                value={annotation.side ?? "after"}
                disabled={!editable}
                onValueChange={(value) =>
                  updateAnnotation(index, {
                    side: value as DiffAnnotation["side"],
                  })
                }
                options={[
                  { value: "after", label: "After" },
                  { value: "before", label: "Before" },
                ]}
              />
              <DevInput
                aria-label={`Annotation ${index + 1} lines`}
                value={annotation.lines}
                placeholder="3-5"
                disabled={!editable}
                onChange={(event) =>
                  updateAnnotation(index, { lines: event.target.value })
                }
              />
              <DevInput
                aria-label={`Annotation ${index + 1} label`}
                value={annotation.label ?? ""}
                placeholder="Label (optional)"
                disabled={!editable}
                onChange={(event) =>
                  updateAnnotation(index, {
                    label: event.target.value || undefined,
                  })
                }
              />
              {editable && (
                <button
                  type="button"
                  data-plan-interactive
                  aria-label={`Remove annotation ${index + 1}`}
                  onClick={() => removeAnnotation(index)}
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-plan-muted transition-colors hover:bg-muted hover:text-foreground"
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </div>
            <DevTextarea
              aria-label={`Annotation ${index + 1} note`}
              className="min-h-[60px] text-sm"
              value={annotation.note}
              placeholder="Explain what these lines do…"
              disabled={!editable}
              onChange={(event) =>
                updateAnnotation(index, { note: event.target.value })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export { DiffRead, DiffEdit };
