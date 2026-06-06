import { useMemo, useState } from "react";
import {
  IconChevronRight,
  IconCode,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { cn } from "../../utils.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import type {
  AnnotatedCodeAnnotation,
  AnnotatedCodeData,
} from "./annotated-code.config.js";
import { DevInput, DevLabel, DevTextarea } from "./dev-doc-ui.js";

/**
 * Stripe-docs / Sourcegraph "explain this code" walkthrough block. The read
 * renderer shows the `code` as a line-numbered monospace surface; lines covered
 * by an annotation get a subtle highlight band and a numbered gutter marker. The
 * annotation notes render below, each with its `lines` range, optional `label`,
 * and markdown `note` (via `ctx.renderMarkdown`). Hovering a note highlights its
 * line range and vice-versa, so the line-anchoring is the differentiator. Lives
 * in core so any app can register the dev-doc block (no shadcn import).
 *
 * All colors are theme-aware: the surface uses the plan `--plan-code*`/`--plan-*`
 * tokens and the highlight/marker accents use Tailwind `light`/`dark:` pairs, so
 * the block reads correctly in BOTH light and dark mode.
 *
 * Editing is panel-driven (config-style, like the diff/HTML blocks): a monospace
 * code Textarea, filename/language Inputs, and add/remove-able annotation rows.
 */

/* ── Line-ref parsing ──────────────────────────────────────────────────────── */

/**
 * Parse a 1-based `lines` ref (`"3"` or `"3-5"`) into an inclusive `[start,end]`
 * pair, clamped to `[1, lineCount]`. Returns `null` for malformed or fully
 * out-of-range refs so callers can ignore them gracefully. A reversed range
 * (`"5-3"`) is normalized; a partially out-of-range range is clamped.
 */
function parseLineRange(
  ref: string,
  lineCount: number,
): { start: number; end: number } | null {
  const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(ref);
  if (!match) return null;
  let start = Number.parseInt(match[1], 10);
  let end = match[2] != null ? Number.parseInt(match[2], 10) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end) [start, end] = [end, start];
  // Fully outside the file → ignore.
  if (end < 1 || start > lineCount) return null;
  return { start: Math.max(1, start), end: Math.min(lineCount, end) };
}

interface ResolvedAnnotation {
  /** Index in the original `annotations` array (stable hover key). */
  index: number;
  /** 1-based marker number shown in the gutter + note list. */
  marker: number;
  annotation: AnnotatedCodeAnnotation;
  range: { start: number; end: number } | null;
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

function AnnotatedCodeRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<AnnotatedCodeData>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());

  const lines = useMemo(() => data.code.split("\n"), [data.code]);
  const lineCount = lines.length;

  const resolved = useMemo<ResolvedAnnotation[]>(
    () =>
      (data.annotations ?? []).map((annotation, index) => ({
        index,
        marker: index + 1,
        annotation,
        range: parseLineRange(annotation.lines, lineCount),
      })),
    [data.annotations, lineCount],
  );

  // line number (1-based) → resolved annotations covering it (marker, active).
  const lineMarkers = useMemo(() => {
    const map = new Map<number, ResolvedAnnotation[]>();
    for (const item of resolved) {
      if (!item.range) continue;
      for (let n = item.range.start; n <= item.range.end; n += 1) {
        const list = map.get(n) ?? [];
        list.push(item);
        map.set(n, list);
      }
    }
    return map;
  }, [resolved]);

  const hasAnnotations = resolved.some((item) => item.range);

  const toggleRevealed = (index: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <div className="overflow-hidden rounded-lg border border-plan-line bg-plan-code">
        {/* Header: filename + optional language chip. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-plan-line bg-plan-block px-3 py-2">
          <IconCode className="size-4 shrink-0 text-plan-muted" />
          <span className="min-w-0 truncate font-mono text-sm font-medium text-plan-code-text">
            {data.filename || "snippet"}
          </span>
          {data.language && (
            <span className="shrink-0 rounded border border-plan-line px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-plan-muted">
              {data.language}
            </span>
          )}
        </div>

        {/* Code surface — line-numbered, with highlight bands + gutter markers. */}
        <div className="overflow-x-auto">
          <div className="min-w-full font-mono text-[13px] leading-6">
            {lines.map((text, idx) => {
              const lineNo = idx + 1;
              const markers = lineMarkers.get(lineNo);
              const isAnnotated = !!markers?.length;
              const isActive =
                activeIndex != null &&
                !!markers?.some((m) => m.index === activeIndex);
              return (
                <div
                  key={lineNo}
                  className={cn(
                    "group flex w-full transition-colors",
                    isActive
                      ? "bg-amber-400/25 dark:bg-amber-300/20"
                      : isAnnotated
                        ? "bg-amber-400/10 dark:bg-amber-300/10"
                        : "",
                  )}
                  onMouseEnter={
                    isAnnotated && markers
                      ? () => setActiveIndex(markers[0].index)
                      : undefined
                  }
                  onMouseLeave={
                    isAnnotated ? () => setActiveIndex(null) : undefined
                  }
                >
                  {/* Gutter: line number. */}
                  <span className="w-10 shrink-0 select-none px-2 text-right text-[11px] leading-6 tabular-nums text-plan-muted/70">
                    {lineNo}
                  </span>
                  {/* Marker rail: numbered dot when annotated, accent bar when active. */}
                  <span
                    className={cn(
                      "flex w-6 shrink-0 select-none items-center justify-center",
                      isActive &&
                        "shadow-[inset_2px_0_0_#f59e0b] dark:shadow-[inset_2px_0_0_#fcd34d]",
                    )}
                  >
                    {isAnnotated && markers && (
                      <button
                        type="button"
                        data-plan-interactive
                        aria-label={`Annotation ${markers[0].marker}`}
                        onClick={() => {
                          setNotesOpen(true);
                          setRevealed((prev) =>
                            new Set(prev).add(markers[0].index),
                          );
                          setActiveIndex(markers[0].index);
                        }}
                        onMouseEnter={() => setActiveIndex(markers[0].index)}
                        className={cn(
                          "flex size-[18px] cursor-pointer items-center justify-center rounded-full text-[10px] font-semibold leading-none transition-colors",
                          isActive
                            ? "bg-amber-500 text-white dark:bg-amber-400 dark:text-amber-950"
                            : "bg-amber-500/20 text-amber-700 hover:bg-amber-500/30 dark:bg-amber-300/20 dark:text-amber-200 dark:hover:bg-amber-300/30",
                        )}
                      >
                        {markers[0].marker}
                      </button>
                    )}
                  </span>
                  <pre className="m-0 flex-1 overflow-visible whitespace-pre px-3 text-plan-code-text">
                    {text || " "}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Annotation notes — line-anchored, collapsible (progressive disclosure). */}
      {hasAnnotations && (
        <div className="mt-3">
          <button
            type="button"
            data-plan-interactive
            onClick={() => setNotesOpen((open) => !open)}
            aria-expanded={notesOpen}
            className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-plan-muted transition-colors hover:text-plan-text"
          >
            <IconChevronRight
              className={cn(
                "size-3.5 transition-transform",
                notesOpen && "rotate-90",
              )}
            />
            {resolved.length} annotation{resolved.length === 1 ? "" : "s"}
          </button>
          {notesOpen && (
            <ol className="mt-2 flex flex-col gap-2">
              {resolved.map((item) => {
                const isActive = activeIndex === item.index;
                const isRevealed = revealed.has(item.index);
                return (
                  <li
                    key={item.index}
                    onMouseEnter={() => setActiveIndex(item.index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    className={cn(
                      "flex gap-3 rounded-md border px-3 py-2 transition-colors",
                      isActive
                        ? "border-amber-400/60 bg-amber-400/10 dark:border-amber-300/40 dark:bg-amber-300/10"
                        : "border-plan-line bg-plan-block/40 hover:border-plan-line",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none transition-colors",
                        isActive
                          ? "bg-amber-500 text-white dark:bg-amber-400 dark:text-amber-950"
                          : "bg-amber-500/20 text-amber-700 dark:bg-amber-300/20 dark:text-amber-200",
                      )}
                    >
                      {item.marker}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-plan-block px-1.5 py-0.5 font-mono text-[11px] text-plan-muted">
                          {item.range
                            ? item.range.start === item.range.end
                              ? `line ${item.range.start}`
                              : `lines ${item.range.start}–${item.range.end}`
                            : `lines ${item.annotation.lines}`}
                        </span>
                        {item.annotation.label && (
                          <span className="text-sm font-semibold text-plan-text">
                            {item.annotation.label}
                          </span>
                        )}
                        {!isRevealed && (
                          <button
                            type="button"
                            data-plan-interactive
                            onClick={() => toggleRevealed(item.index)}
                            className="ml-auto cursor-pointer text-[11px] font-medium text-plan-muted underline-offset-2 hover:text-plan-text hover:underline"
                          >
                            Show note
                          </button>
                        )}
                      </div>
                      {isRevealed && (
                        <div className="plan-annotation-note mt-1 text-sm text-plan-text">
                          {ctx.renderMarkdown ? (
                            ctx.renderMarkdown(item.annotation.note)
                          ) : (
                            <p>{item.annotation.note}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/* ── Edit (panel) ──────────────────────────────────────────────────────────── */

const codeAreaClass = "min-h-[160px] font-mono text-xs leading-5";

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
