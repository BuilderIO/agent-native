import { useMemo, useRef, useState } from "react";
import { IconCode, IconPlus, IconTrash } from "@tabler/icons-react";
import { cn } from "../../utils.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import type {
  AnnotatedCodeAnnotation,
  AnnotatedCodeData,
} from "./annotated-code.config.js";
import {
  highlightCode,
  inferLanguageFromFilename,
  normalizeCodeLanguage,
} from "./code-highlight.js";
import {
  AnnotationHiddenStack,
  AnnotationHoverCard,
  anchorFromElements,
  buildLineMarkerMap,
  hasRailAnnotations,
  resolveAnnotations,
  useAnnotationHover,
  type ResolvedAnnotation,
} from "./annotation-rail.js";
import { CodeFilenameLabel } from "./code-filename-label.js";
import { DevInput, DevLabel, DevTextarea } from "./dev-doc-ui.js";

/**
 * "Explain this code" walkthrough block: a standard syntax-highlighted code
 * surface on the left with line-anchored annotation cards on the right (the
 * Stripe-docs / Sourcegraph layout). Each annotated line range gets a subtle
 * highlight band + an accent rail down the gutter; its card shows the `lines`
 * range, optional `label`, and the always-visible markdown `note` (via
 * `ctx.renderMarkdown`). Hovering a card highlights its lines and vice-versa.
 *
 * Syntax highlighting reuses the shared `highlightCode` lowlight helper (the same
 * colorful palette as the `code-tabs` block) per line, so it matches the app's
 * standard code styling and supports per-line bands without an async loader. The
 * surface uses the plan `--plan-code*`/`--plan-*` tokens and Tailwind `dark:`
 * pairs, so it reads correctly in BOTH light and dark mode. Code lines render as
 * `<span>`s (never one `<pre>` per line) so they don't pick up document
 * code/pre chrome. Lives in core so any app can register the dev-doc block.
 *
 * Editing is panel-driven (config-style, like the diff/HTML blocks): a monospace
 * code Textarea, filename/language Inputs, and add/remove-able annotation rows.
 */

/* ── Collapse helpers ──────────────────────────────────────────────────────── */

/**
 * Minimum total line count before collapse is considered. Short files render
 * fully expanded regardless of annotation coverage.
 */
const COLLAPSE_MIN_TOTAL_LINES = 40;

/**
 * Number of unannotated lines in a run that triggers collapse. Runs at or
 * below this threshold always stay expanded (no expander button).
 */
const COLLAPSE_THRESHOLD = 16;

/**
 * Context lines kept visible at each edge of a collapsed run (8 lines of
 * breathing room so the collapsed region is clearly framed).
 */
const COLLAPSE_CONTEXT_EDGE = 8;

type CollapsedSegment = {
  kind: "collapsed";
  startLine: number;
  endLine: number;
};
type VisibleSegment = { kind: "visible"; startLine: number; endLine: number };
type LineSegment = VisibleSegment | CollapsedSegment;

/**
 * Partition line numbers [1..lineCount] into visible and collapsed segments.
 * Annotated lines (and COLLAPSE_CONTEXT_EDGE lines on either side of them) are
 * always visible. Runs of unannotated lines longer than COLLAPSE_THRESHOLD are
 * collapsed. The file header (first COLLAPSE_CONTEXT_EDGE lines) is always
 * visible so context is preserved.
 */
function buildLineSegments(
  lineCount: number,
  lineMarkers: Map<number, Array<{ index: number }>>,
): LineSegment[] {
  if (lineCount <= COLLAPSE_MIN_TOTAL_LINES) {
    return [{ kind: "visible", startLine: 1, endLine: lineCount }];
  }

  // Build a boolean array: true if the line must stay visible.
  const mustShow = new Array<boolean>(lineCount + 1).fill(false);
  // File header always visible.
  for (let i = 1; i <= Math.min(COLLAPSE_CONTEXT_EDGE, lineCount); i += 1) {
    mustShow[i] = true;
  }
  // Annotated lines and their context edges.
  for (const lineNo of lineMarkers.keys()) {
    for (
      let i = Math.max(1, lineNo - COLLAPSE_CONTEXT_EDGE);
      i <= Math.min(lineCount, lineNo + COLLAPSE_CONTEXT_EDGE);
      i += 1
    ) {
      mustShow[i] = true;
    }
  }

  // Compute initial segments.
  const raw: LineSegment[] = [];
  let segStart = 1;
  let visible = mustShow[1] ?? false;
  for (let i = 2; i <= lineCount; i += 1) {
    const nextVisible = mustShow[i] ?? false;
    if (nextVisible !== visible) {
      raw.push(
        visible
          ? { kind: "visible", startLine: segStart, endLine: i - 1 }
          : { kind: "collapsed", startLine: segStart, endLine: i - 1 },
      );
      segStart = i;
      visible = nextVisible;
    }
  }
  raw.push(
    visible
      ? { kind: "visible", startLine: segStart, endLine: lineCount }
      : { kind: "collapsed", startLine: segStart, endLine: lineCount },
  );

  // Don't collapse short hidden runs — expand them in-place.
  return raw.map((seg) => {
    if (
      seg.kind === "collapsed" &&
      seg.endLine - seg.startLine + 1 <= COLLAPSE_THRESHOLD
    ) {
      return {
        kind: "visible",
        startLine: seg.startLine,
        endLine: seg.endLine,
      };
    }
    return seg;
  });
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

function AnnotatedCodeRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<AnnotatedCodeData>) {
  // On-hover popover (anchored to the right of the code) replaces the old
  // persistent rail: nothing is visible when idle. `codeRef` measures the code
  // block's right edge; `hover` carries the active index + captured geometry.
  const hover = useAnnotationHover();
  const { activeIndex } = hover;
  const codeRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef(new Map<number, HTMLDivElement>());

  const setLineRef = (lineNo: number, node: HTMLDivElement | null) => {
    if (node) lineRefs.current.set(lineNo, node);
    else lineRefs.current.delete(lineNo);
  };

  const lines = useMemo(
    () => data.code.replace(/\n$/, "").split("\n"),
    [data.code],
  );
  const lineCount = lines.length;

  const language = useMemo(
    () =>
      normalizeCodeLanguage(data.language) ??
      inferLanguageFromFilename(data.filename),
    [data.language, data.filename],
  );

  // Highlight each line once; empty lines keep their height with a NBSP.
  const highlightedLines = useMemo(
    () =>
      lines.map((text) => (text.length ? highlightCode(text, language) : " ")),
    [lines, language],
  );

  const resolved = useMemo(
    () => resolveAnnotations(data.annotations, () => lineCount),
    [data.annotations, lineCount],
  );

  // line number (1-based) → resolved annotations covering it.
  const lineMarkers = useMemo(() => buildLineMarkerMap(resolved), [resolved]);

  const hasAnnotations = hasRailAnnotations(resolved);
  const langChip = data.language?.trim();
  const hasFilename = Boolean(data.filename?.trim());
  const showLangChip = Boolean(langChip && !hasFilename);

  // The resolved annotation whose card is currently shown on hover.
  const activeItem =
    useMemo<ResolvedAnnotation<AnnotatedCodeAnnotation> | null>(
      () =>
        activeIndex == null
          ? null
          : (resolved.find((item) => item.index === activeIndex) ?? null),
      [activeIndex, resolved],
    );

  // Line-collapse state: a set of collapsed segment start lines that have been
  // expanded by the reader. Starts empty (all segments in their default state).
  const [expandedCollapsed, setExpandedCollapsed] = useState<Set<number>>(
    () => new Set(),
  );

  const segments = useMemo(
    () => buildLineSegments(lineCount, lineMarkers),
    [lineCount, lineMarkers],
  );

  const renderLine = (lineNo: number) => {
    const markers = lineMarkers.get(lineNo);
    const isAnnotated = !!markers?.length;
    const isActive =
      activeIndex != null && !!markers?.some((m) => m.index === activeIndex);

    const buildAnchorForRow = (el: HTMLElement) => {
      if (!markers) return null;
      const primaryMarker = markers[0];
      const anchorLine = primaryMarker.range?.start ?? lineNo;
      const anchorRow = lineRefs.current.get(anchorLine) ?? el;
      return anchorFromElements(codeRef.current, anchorRow);
    };

    return (
      <div
        key={lineNo}
        ref={(node) => setLineRef(lineNo, node)}
        data-code-line={lineNo}
        data-annot-row={isAnnotated ? markers?.[0].index : undefined}
        tabIndex={isAnnotated ? 0 : undefined}
        role={isAnnotated ? "button" : undefined}
        aria-expanded={isAnnotated ? isActive : undefined}
        aria-label={isAnnotated ? `Line ${lineNo} annotation` : undefined}
        className={cn(
          "flex w-full",
          isAnnotated && "cursor-pointer",
          isActive
            ? "bg-amber-400/20 dark:bg-amber-300/15"
            : isAnnotated
              ? "bg-amber-400/[0.07] dark:bg-amber-300/[0.07]"
              : null,
        )}
        onMouseEnter={
          isAnnotated && markers
            ? (event) => {
                const anchor = buildAnchorForRow(event.currentTarget);
                if (anchor) hover.open(markers[0].index, anchor);
              }
            : undefined
        }
        onMouseLeave={isAnnotated ? () => hover.scheduleClose() : undefined}
        onClick={
          isAnnotated && markers
            ? (event) => {
                const anchor = buildAnchorForRow(event.currentTarget);
                if (anchor) hover.open(markers[0].index, anchor);
              }
            : undefined
        }
        onKeyDown={
          isAnnotated && markers
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                const anchor = buildAnchorForRow(event.currentTarget);
                if (anchor) hover.open(markers[0].index, anchor);
              }
            : undefined
        }
        onFocus={
          isAnnotated && markers
            ? (event) => {
                const anchor = buildAnchorForRow(event.currentTarget);
                if (anchor) hover.open(markers[0].index, anchor);
              }
            : undefined
        }
        onBlur={isAnnotated ? () => hover.scheduleClose() : undefined}
      >
        <span
          aria-hidden
          className={cn(
            "w-[3px] shrink-0 self-stretch",
            isAnnotated
              ? isActive
                ? "bg-amber-500 dark:bg-amber-400"
                : "bg-amber-400/45 dark:bg-amber-300/35"
              : null,
          )}
        />
        <span className="w-11 shrink-0 select-none px-3 text-right text-[11px] tabular-nums text-plan-muted/60">
          {lineNo}
        </span>
        <span className="flex-1 whitespace-pre pr-4 text-plan-code-text">
          {highlightedLines[lineNo - 1]}
        </span>
      </div>
    );
  };

  const codeSurface = (
    <div
      ref={codeRef}
      className="overflow-hidden rounded-xl border border-plan-line bg-plan-code"
    >
      {(hasFilename || showLangChip) && (
        <div className="flex items-center gap-2 border-b border-plan-line bg-plan-block/50 px-3.5 py-2">
          <IconCode className="size-3.5 shrink-0 text-plan-muted" />
          <CodeFilenameLabel
            filename={data.filename}
            className="text-[13px] font-medium"
            directoryClassName="text-plan-muted"
            basenameClassName="text-plan-code-text"
          />
          {showLangChip && (
            <span className="shrink-0 rounded border border-plan-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-plan-muted">
              {langChip}
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto py-1.5" data-code-surface>
        <div className="min-w-full font-mono [font-size:var(--plan-doc-code-size)] leading-[22px]">
          {segments.map((seg) => {
            if (seg.kind === "visible") {
              const lineNos = Array.from(
                { length: seg.endLine - seg.startLine + 1 },
                (_, i) => seg.startLine + i,
              );
              return lineNos.map(renderLine);
            }
            // Collapsed segment — show an expander row.
            const isExpanded = expandedCollapsed.has(seg.startLine);
            const hiddenCount = seg.endLine - seg.startLine + 1;
            if (isExpanded) {
              const lineNos = Array.from(
                { length: hiddenCount },
                (_, i) => seg.startLine + i,
              );
              return lineNos.map(renderLine);
            }
            return (
              <button
                key={`collapse-${seg.startLine}`}
                type="button"
                data-plan-interactive
                onClick={() =>
                  setExpandedCollapsed((prev) => {
                    const next = new Set(prev);
                    next.add(seg.startLine);
                    return next;
                  })
                }
                className="flex w-full cursor-pointer items-center gap-2 border-y border-plan-line/50 bg-plan-block/20 px-3 py-0.5 text-left hover:bg-plan-block/40"
              >
                <span aria-hidden className="w-[3px] shrink-0 self-stretch" />
                <span className="w-8 shrink-0 select-none text-right text-[11px] tabular-nums text-plan-muted/40">
                  ···
                </span>
                <span className="flex-1 text-[11px] text-plan-muted/70">
                  {hiddenCount} lines — click to expand
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <section className="plan-block relative" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      {/* The code keeps its full width — no persistent annotation column. Notes
          live in a visually-hidden stack (a11y + tests) and surface ONE at a
          time as an on-hover popover anchored to the right of the code. */}
      {codeSurface}
      {hasAnnotations && <AnnotationHiddenStack items={resolved} ctx={ctx} />}
      {hasAnnotations && activeItem && hover.anchor && (
        <AnnotationHoverCard
          item={activeItem}
          anchor={hover.anchor}
          ctx={ctx}
          onMouseEnter={hover.cancelClose}
          onMouseLeave={hover.scheduleClose}
          onClose={hover.closeForScroll}
        />
      )}
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/* ── Edit (panel) ──────────────────────────────────────────────────────────── */

const codeAreaClass =
  "min-h-[160px] font-mono [font-size:var(--plan-code-size)] leading-5";

function AnnotatedCodeEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<AnnotatedCodeData>) {
  const annotations = data.annotations ?? [];
  const patch = (next: Partial<AnnotatedCodeData>) =>
    onChange({ ...data, ...next });

  const updateAnnotation = (
    index: number,
    next: Partial<AnnotatedCodeAnnotation>,
  ) =>
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
      annotations: [...annotations, { lines: "1", label: "", note: "" }],
    });
  };

  return (
    <div className="flex flex-col gap-3" data-plan-interactive>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <DevLabel htmlFor="annotated-code-filename" className="text-xs">
            Filename
          </DevLabel>
          <DevInput
            id="annotated-code-filename"
            value={data.filename ?? ""}
            placeholder="src/server/auth.ts"
            disabled={!editable}
            onChange={(event) =>
              patch({ filename: event.target.value || undefined })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <DevLabel htmlFor="annotated-code-language" className="text-xs">
            Language
          </DevLabel>
          <DevInput
            id="annotated-code-language"
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
        <DevLabel htmlFor="annotated-code-code" className="text-xs">
          Code
        </DevLabel>
        <DevTextarea
          id="annotated-code-code"
          spellCheck={false}
          className={codeAreaClass}
          value={data.code}
          disabled={!editable}
          onChange={(event) => patch({ code: event.target.value })}
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
            No annotations yet. Add one to anchor a note to a line range.
          </p>
        )}
        {annotations.map((annotation, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-plan-line bg-plan-block/30 p-2"
          >
            <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
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

export { AnnotatedCodeRead, AnnotatedCodeEdit };
