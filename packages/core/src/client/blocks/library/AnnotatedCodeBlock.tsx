import { useMemo, useState } from "react";
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
  /** 1-based marker number (authoring order). */
  marker: number;
  annotation: AnnotatedCodeAnnotation;
  range: { start: number; end: number } | null;
}

/** Human label for a resolved annotation's line span ("Line 8" / "Lines 3–6"). */
function rangeLabel(item: ResolvedAnnotation): string {
  if (!item.range) return `Lines ${item.annotation.lines}`;
  return item.range.start === item.range.end
    ? `Line ${item.range.start}`
    : `Lines ${item.range.start}–${item.range.end}`;
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

  // line number (1-based) → resolved annotations covering it.
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

  const sideAnnotations = resolved.filter((item) => item.range);
  const hasAnnotations = sideAnnotations.length > 0;
  const langChip = data.language?.trim();

  const codeSurface = (
    <div className="overflow-hidden rounded-xl border border-plan-line bg-plan-code">
      {(data.filename || langChip) && (
        <div className="flex items-center gap-2 border-b border-plan-line bg-plan-block/50 px-3.5 py-2">
          <IconCode className="size-3.5 shrink-0 text-plan-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-plan-code-text">
            {data.filename || "snippet"}
          </span>
          {langChip && (
            <span className="shrink-0 rounded border border-plan-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-plan-muted">
              {langChip}
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto py-1.5">
        <div className="min-w-full font-mono text-[12.5px] leading-[22px]">
          {lines.map((_text, idx) => {
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
                  "flex w-full",
                  isActive
                    ? "bg-amber-400/20 dark:bg-amber-300/15"
                    : isAnnotated
                      ? "bg-amber-400/[0.07] dark:bg-amber-300/[0.07]"
                      : null,
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
                {/* Accent rail: amber on annotated lines, brighter when active. */}
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
                  {highlightedLines[idx]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      {hasAnnotations ? (
        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(190px,250px)]">
          {codeSurface}
          <div className="flex flex-col gap-2.5">
            {sideAnnotations.map((item) => {
              const isActive = activeIndex === item.index;
              return (
                <div
                  key={item.index}
                  onMouseEnter={() => setActiveIndex(item.index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  className={cn(
                    "rounded-lg border px-3.5 py-2.5 transition-colors",
                    isActive
                      ? "border-amber-400/70 bg-amber-50 dark:border-amber-300/40 dark:bg-amber-300/[0.08]"
                      : "border-plan-line bg-plan-block/40 hover:border-amber-400/50",
                  )}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-plan-muted">
                      {rangeLabel(item)}
                    </span>
                    {item.annotation.label && (
                      <span className="text-[13px] font-semibold text-plan-text">
                        {item.annotation.label}
                      </span>
                    )}
                  </div>
                  <div className="plan-annotation-note mt-1 text-[13px] leading-relaxed text-plan-text/85">
                    {ctx.renderMarkdown ? (
                      ctx.renderMarkdown(item.annotation.note)
                    ) : (
                      <p>{item.annotation.note}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        codeSurface
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
