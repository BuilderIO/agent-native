import { useMemo, useRef, useState } from "react";
import { IconScissors } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMs, isExcluded, type EditsJson } from "@/lib/timestamp-mapping";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptEditorProps {
  segments: TranscriptSegment[];
  edits: EditsJson;
  currentMs: number;
  onSeek?: (originalMs: number) => void;
  /**
   * Fires with an (original) ms range when the user trims a selection — the
   * parent should call `trim-recording` with it.
   */
  onTrimRange?: (range: { startMs: number; endMs: number }) => void;
  className?: string;
}

interface Selection {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Transcript viewer with selection-to-trim support.
 *
 * Users select text → press Delete (or the "Trim selection" button) → we
 * resolve the selected text's timestamp range via `segmentsJson` and call
 * `onTrimRange` with it. Segments that fall inside an excluded range render
 * with strikethrough.
 */
export function TranscriptEditor({
  segments,
  edits,
  currentMs,
  onSeek,
  onTrimRange,
  className,
}: TranscriptEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  // For each segment we add a data-start-ms attribute so we can resolve the
  // browser's text Selection back to original timestamps.
  const resolveSelection = (): Selection | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const root = rootRef.current;
    if (!root) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;

    const startEl = findSegmentElement(range.startContainer);
    const endEl = findSegmentElement(range.endContainer);
    if (!startEl || !endEl) return null;
    const startMs = Number(startEl.dataset.startMs ?? 0);
    const endMs = Number(endEl.dataset.endMs ?? 0);
    if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return null;
    return { startMs, endMs, text: sel.toString() };
  };

  const handleMouseUp = () => {
    const sel = resolveSelection();
    setSelection(sel);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      selection &&
      onTrimRange
    ) {
      e.preventDefault();
      onTrimRange({ startMs: selection.startMs, endMs: selection.endMs });
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const rendered = useMemo(() => {
    return segments.map((s, i) => {
      const excluded = isExcluded(s.startMs, edits);
      const active = currentMs >= s.startMs && currentMs < s.endMs;
      return (
        <span
          key={`${s.startMs}-${i}`}
          data-start-ms={s.startMs}
          data-end-ms={s.endMs}
          onClick={() => onSeek?.(s.startMs)}
          className={cn(
            "inline cursor-pointer px-0.5 rounded",
            active && "bg-[#625DF5]/20 text-foreground",
            excluded && "line-through text-muted-foreground/70",
          )}
          title={`${formatMs(s.startMs)} – ${formatMs(s.endMs)}`}
        >
          {s.text.trim()}{" "}
        </span>
      );
    });
  }, [segments, edits, currentMs, onSeek]);

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border text-xs text-muted-foreground">
        <div>
          Transcript{" "}
          {selection ? (
            <span className="text-foreground">
              · selection {formatMs(selection.startMs)} →{" "}
              {formatMs(selection.endMs)}
            </span>
          ) : (
            <span>· select text to trim</span>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selection}
          onClick={() => {
            if (!selection) return;
            onTrimRange?.({
              startMs: selection.startMs,
              endMs: selection.endMs,
            });
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          <IconScissors className="w-3.5 h-3.5 mr-1" />
          Trim selection
        </Button>
      </div>

      <div
        ref={rootRef}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="flex-1 overflow-auto p-3 text-[14px] leading-relaxed outline-none"
      >
        {segments.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            No transcript yet. Run <code>pnpm action transcribe-recording</code>{" "}
            to generate one.
          </div>
        ) : (
          rendered
        )}
      </div>
    </div>
  );
}

function findSegmentElement(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.nodeType !== 1) el = el.parentNode;
  while (el && el instanceof HTMLElement) {
    if (el.dataset && el.dataset.startMs != null) return el;
    el = el.parentNode;
  }
  return null;
}
