import { useT } from "@agent-native/core/client";
import {
  IconArrowBackUp,
  IconBookmark,
  IconBracketsContain,
  IconCopy,
  IconCut,
  IconStrikethrough,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  annotationColorClass,
  annotationKindLabel,
} from "@/lib/annotation-kinds";
import {
  formatMs,
  getExcludedRanges,
  isExcluded,
  isHidden,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

import { CoordinateMenu } from "./coordinate-menu";
import { useSceneThumbnails } from "./use-scene-thumbnails";

export interface TranscriptAnnotation {
  id: string;
  startMs: number;
  endMs: number | null;
  kind: string;
  label: string | null;
  body: string | null;
  resolved: boolean;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptEditorProps {
  segments: TranscriptSegment[];
  edits: EditsJson;
  currentMs: number;
  /** Timestamp markers rendered inline in the text at their spoken position. */
  annotations?: TranscriptAnnotation[];
  onSeek?: (originalMs: number) => void;
  /**
   * Fires with an (original) ms range when the user trims a selection — the
   * parent should call `trim-recording` with it. `hidden: true` (Cut) removes
   * the text from view entirely instead of the default strikethrough
   * (Ignore/Backspace).
   */
  onTrimRange?: (
    range: { startMs: number; endMs: number },
    opts?: { hidden?: boolean },
  ) => void;
  /**
   * Mirrors the text selection onto the timeline (Descript scenes): fires
   * with the resolved ms range on select, null when cleared.
   */
  onSelectionChange?: (
    range: { startMs: number; endMs: number } | null,
  ) => void;
  /** Creates a section annotation from the selected range. */
  onCreateSection?: (range: { startMs: number; endMs: number }) => void;
  /** Restores (un-ignores) an excluded range — Descript's Restore. */
  onRestoreRange?: (range: { startMs: number; endMs: number }) => void;
  /** Adds a point marker at a position (selection start). */
  onAddMarkerAt?: (ms: number) => void;
  /** Splits the recording at a position — typed "/" splits at the playhead. */
  onSplitAt?: (ms: number) => void;
  /**
   * Split points (original ms). Each starts a new scene block in the text,
   * led by a mini video-frame thumbnail (Descript scenes) captured from
   * `videoUrl`. Time 0 gets one too — every segment begins with its frame.
   */
  splitPoints?: number[];
  videoUrl?: string | null;
  /** Clicking a scene thumbnail seeks AND selects that segment's range. */
  onSelectSegmentAt?: (ms: number) => void;
  className?: string;
}

interface Selection {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * A silence gap this long between segments starts a new paragraph — the
 * transcript must read like a real document, never one text blob.
 */
const PARAGRAPH_PAUSE_MS = 700;
/**
 * Fluent speakers can talk for minutes without a 700ms gap, which would
 * still produce wall-of-text paragraphs — so once a paragraph runs longer
 * than this, it also breaks at the next sentence end.
 */
const PARAGRAPH_MAX_MS = 30_000;

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
  annotations = [],
  onSeek,
  onTrimRange,
  onSelectionChange,
  onCreateSection,
  onRestoreRange,
  onAddMarkerAt,
  onSplitAt,
  splitPoints = [],
  videoUrl = null,
  onSelectSegmentAt,
  className,
}: TranscriptEditorProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const clearSelection = () => {
    setSelection(null);
    setToolbarPos(null);
    setMenuPos(null);
    onSelectionChange?.(null);
    window.getSelection()?.removeAllRanges();
  };

  const selectionTouchesExcluded = useMemo(() => {
    if (!selection) return false;
    return getExcludedRanges(edits).some(
      (r) => r.startMs < selection.endMs && r.endMs > selection.startMs,
    );
  }, [selection, edits]);

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
    // A new plain selection always dismisses any menu left open from a
    // previous right-click — otherwise it would pop back open at the old
    // (now stale) coordinates as soon as `selection` becomes non-null again.
    setMenuPos(null);
    const sel = resolveSelection();
    setSelection(sel);
    onSelectionChange?.(
      sel ? { startMs: sel.startMs, endMs: sel.endMs } : null,
    );
    if (sel) {
      const domSel = window.getSelection();
      const rect =
        domSel && domSel.rangeCount > 0
          ? domSel.getRangeAt(0).getBoundingClientRect()
          : null;
      if (rect && rect.width > 0) {
        // Viewport-fixed so the toolbar escapes the panel's overflow
        // clipping; clamped so it never runs off screen.
        setToolbarPos({
          x: Math.min(
            Math.max(rect.left + rect.width / 2, 90),
            window.innerWidth - 90,
          ),
          y: Math.max(rect.top, 44),
        });
      }
    } else {
      setToolbarPos(null);
    }
  };

  // Where did the user last point, in recording time? Selection anchors are
  // unreliable here (Chrome collapses the caret to the paragraph start
  // inside this contentEditable), so the source of truth is the CLICK
  // COORDINATES: caretRangeFromPoint gives the exact text node + character
  // offset under the pointer, interpolated across the segment's time span.
  const lastCaretMsRef = useRef<number | null>(null);

  const msFromTextPoint = (clientX: number, clientY: number): number | null => {
    type CaretDoc = Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    const doc = document as CaretDoc;
    let node: Node | null = null;
    let offset = 0;
    if (doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(clientX, clientY);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    } else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      }
    }
    if (!node) return null;
    const el = findSegmentElement(node);
    if (!el || !rootRef.current?.contains(el)) return null;
    const startMs = Number(el.dataset.startMs ?? Number.NaN);
    const endMs = Number(el.dataset.endMs ?? Number.NaN);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    const text = el.textContent ?? "";
    const frac =
      node.nodeType === Node.TEXT_NODE && text.length > 0
        ? Math.min(1, Math.max(0, offset / text.length))
        : 0;
    return Math.round(startMs + frac * (endMs - startMs));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Descript's slash-to-split, transcript-first: click a word, then type
    // "/" to split there. The caret position decides (interpolated within
    // the segment); the playhead is only the fallback when no caret exists.
    if (e.key === "/" && onSplitAt) {
      e.preventDefault();
      onSplitAt(lastCaretMsRef.current ?? Math.round(currentMs));
      return;
    }
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

  // Right-click anywhere with a live selection opens a context menu — same
  // Copy/Cut/Delete surface whether the selection spans a whole segment or
  // just a partial range within one (there was previously no menu at all for
  // a partial-range selection, only the floating toolbar).
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selection) return;
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const copySelection = () => {
    if (!selection) return;
    navigator.clipboard?.writeText(selection.text).catch(() => {});
  };

  /** Delete/Backspace and the menu's "Delete": strikethrough, reversible. */
  const deleteSelection = () => {
    if (!selection || !onTrimRange) return;
    onTrimRange({ startMs: selection.startMs, endMs: selection.endMs });
    clearSelection();
  };

  /**
   * The menu's "Cut": copies the text (real clipboard semantics) AND removes
   * it from the transcript view entirely rather than leaving a strikethrough
   * — a more committed action than Delete, though still a reversible
   * non-destructive trim under the hood (Restore brings it back either way).
   */
  const cutSelection = () => {
    if (!selection || !onTrimRange) return;
    copySelection();
    onTrimRange(
      { startMs: selection.startMs, endMs: selection.endMs },
      { hidden: true },
    );
    clearSelection();
  };

  // One preview frame per scene start: time 0 plus every split point. The
  // thumbnails ARE the split markers in the text (Descript scenes) — "the
  // fact that it's mini screenshots and not just split markers makes it
  // more beautiful".
  const sceneTimes = useMemo(() => {
    if (segments.length === 0) return [];
    const sorted = [...splitPoints].sort((a, b) => a - b);
    return [0, ...sorted.filter((ms) => ms > 0)];
  }, [segments.length, splitPoints]);
  const sceneThumbs = useSceneThumbnails({
    videoUrl,
    times: sceneTimes,
    enabled: Boolean(videoUrl) && segments.length > 0,
  });

  const rendered = useMemo(() => {
    // Point markers slot inline before the first segment they precede — the
    // spoken words around a marker ARE its context, so it lives in the text.
    const markers = annotations
      .filter((a) => a.endMs === null)
      .sort((a, b) => a.startMs - b.startMs);
    let markerIndex = 0;
    let paragraph: React.ReactNode[] = [];
    const paragraphs: React.ReactNode[] = [];
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      paragraphs.push(
        <p key={`para-${paragraphs.length}`} className="mb-3">
          {paragraph}
        </p>,
      );
      paragraph = [];
    };
    const pushMarkersBefore = (ms: number) => {
      while (
        markerIndex < markers.length &&
        markers[markerIndex].startMs < ms
      ) {
        const m = markers[markerIndex++];
        paragraph.push(
          <Tooltip key={`marker-${m.id}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                contentEditable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(m.startMs);
                }}
                className={cn(
                  "mx-0.5 inline-block h-2.5 w-2.5 -translate-y-px cursor-pointer rounded-full border border-black/30 align-middle transition-transform hover:scale-125",
                  annotationColorClass(m.kind),
                  m.resolved && "opacity-40",
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              {`${annotationKindLabel(m.kind, t)}${(m.label ?? m.body) ? `: ${(m.label ?? m.body ?? "").slice(0, 60)}` : ""} · ${formatMs(m.startMs)}`}
            </TooltipContent>
          </Tooltip>,
        );
      }
    };
    // A split starts a new scene, marked by a mini preview frame that flows
    // INLINE with the words at the scene's exact position — mid-sentence if
    // that's where the split lands, exactly like Descript. Scene marks never
    // break the paragraph; paragraphs remain purely pause/length-based.
    // Splits land on the first segment at or after their time (whisper
    // segments are our text granularity).
    let sceneIndex = 0;
    const pushScenesBefore = (segStartMs: number, segEndMs: number) => {
      while (
        sceneIndex < sceneTimes.length &&
        sceneTimes[sceneIndex] <= Math.max(segStartMs, segEndMs - 1)
      ) {
        const ms = sceneTimes[sceneIndex++];
        const thumb = sceneThumbs[ms];
        paragraph.push(
          <Tooltip key={`scene-${ms}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                contentEditable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(ms);
                  onSelectSegmentAt?.(ms);
                }}
                className="mx-1.5 inline-block h-7 w-8 shrink-0 -translate-y-px cursor-pointer overflow-hidden rounded border border-border/70 bg-muted align-middle transition-[border-color] hover:border-primary"
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {`${t("transcriptEditor.segmentStart")} · ${formatMs(ms)}`}
            </TooltipContent>
          </Tooltip>,
        );
      }
    };
    let prevEndMs: number | null = null;
    let prevText = "";
    let paragraphStartMs: number | null = null;
    segments.forEach((s, i) => {
      const pause = prevEndMs !== null ? s.startMs - prevEndMs : 0;
      const paragraphMs =
        paragraphStartMs !== null ? s.startMs - paragraphStartMs : 0;
      const atSentenceEnd = /[.!?…。！？]$/.test(prevText);
      if (
        prevEndMs !== null &&
        (pause > PARAGRAPH_PAUSE_MS ||
          (paragraphMs > PARAGRAPH_MAX_MS && atSentenceEnd))
      ) {
        flushParagraph();
        paragraphStartMs = null;
      }
      if (paragraphStartMs === null) paragraphStartMs = s.startMs;
      prevEndMs = s.endMs;
      prevText = s.text.trim();
      pushScenesBefore(s.startMs, s.endMs);
      pushMarkersBefore(s.endMs);
      // A Cut (hidden) segment is removed from the transcript view entirely
      // — no strikethrough, no gap left behind. It's still selectable/
      // restorable from the waveform/timeline's excluded-range overlay,
      // which renders regardless of `hidden`.
      if (isHidden(s.startMs, edits)) return;
      const excluded = isExcluded(s.startMs, edits);
      const active = currentMs >= s.startMs && currentMs < s.endMs;
      paragraph.push(
        <Tooltip key={`${s.startMs}-${i}`}>
          <TooltipTrigger asChild>
            <span
              data-start-ms={s.startMs}
              data-end-ms={s.endMs}
              onClick={(e) => {
                const ms = msFromTextPoint(e.clientX, e.clientY);
                lastCaretMsRef.current = ms;
                onSeek?.(ms ?? s.startMs);
              }}
              className={cn(
                "inline cursor-pointer px-0.5 rounded",
                active && "bg-primary/20 text-foreground",
                excluded && "line-through text-muted-foreground/70",
              )}
            >
              {s.text.trim()}{" "}
            </span>
          </TooltipTrigger>
          <TooltipContent>{`${formatMs(s.startMs)} – ${formatMs(s.endMs)}`}</TooltipContent>
        </Tooltip>,
      );
    });
    pushMarkersBefore(Number.POSITIVE_INFINITY);
    flushParagraph();
    return paragraphs;
  }, [
    segments,
    edits,
    currentMs,
    onSeek,
    annotations,
    t,
    sceneTimes,
    sceneThumbs,
    onSelectSegmentAt,
  ]);

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <div>
          {t("transcriptEditor.transcript")}{" "}
          {selection ? (
            <span className="text-foreground">
              {t("transcriptEditor.selectionRange", {
                start: formatMs(selection.startMs),
                end: formatMs(selection.endMs),
              })}
            </span>
          ) : (
            <span>{t("transcriptEditor.selectTextToTrim")}</span>
          )}
        </div>
      </div>

      {/* contentEditable purely for the CARET: clicking a word places a
          real blinking caret (plain text nodes don't get one in Chrome), so
          "/" splits exactly where you clicked. Every actual edit is
          suppressed — the document is a view over the recording, edited
          through actions, never through typing. */}
      <div
        ref={rootRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onBeforeInput={(e) => e.preventDefault()}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        tabIndex={0}
        className="relative flex-1 overflow-auto p-3 text-[14px] leading-relaxed caret-primary outline-none"
      >
        {selection && toolbarPos ? (
          <div
            className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-md"
            style={{ left: toolbarPos.x, top: toolbarPos.y - 6 }}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <SelectionToolButton
              label={t("transcriptEditor.ignore")}
              onClick={() => {
                onTrimRange?.({
                  startMs: selection.startMs,
                  endMs: selection.endMs,
                });
                clearSelection();
              }}
            >
              <IconStrikethrough className="h-4 w-4" />
            </SelectionToolButton>
            {selectionTouchesExcluded && onRestoreRange ? (
              <SelectionToolButton
                label={t("transcriptEditor.restore")}
                onClick={() => {
                  onRestoreRange({
                    startMs: selection.startMs,
                    endMs: selection.endMs,
                  });
                  clearSelection();
                }}
              >
                <IconArrowBackUp className="h-4 w-4" />
              </SelectionToolButton>
            ) : null}
            {onCreateSection ? (
              <SelectionToolButton
                label={t("transcriptEditor.createSection")}
                onClick={() => {
                  onCreateSection({
                    startMs: selection.startMs,
                    endMs: selection.endMs,
                  });
                  clearSelection();
                }}
              >
                <IconBracketsContain className="h-4 w-4" />
              </SelectionToolButton>
            ) : null}
            {onAddMarkerAt ? (
              <SelectionToolButton
                label={t("transcriptEditor.addMarker")}
                onClick={() => {
                  onAddMarkerAt(selection.startMs);
                  clearSelection();
                }}
              >
                <IconBookmark className="h-4 w-4" />
              </SelectionToolButton>
            ) : null}
          </div>
        ) : null}
        {segments.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            {t("transcriptEditor.noTranscript")}
          </div>
        ) : (
          rendered
        )}
      </div>

      {/* Right-click on a selection — previously there was no context menu
          at all for a partial (sub-segment) selection, only the floating
          toolbar. Copy/Cut/Delete here mirror Descript's own menu; Cut
          removes the text from view (see `cutSelection`), Delete matches
          plain Backspace (strikethrough, reversible). */}
      {selection ? (
        <CoordinateMenu
          open={menuPos !== null}
          x={menuPos?.x ?? 0}
          y={menuPos?.y ?? 0}
          onOpenChange={(open) => {
            if (!open) setMenuPos(null);
          }}
        >
          <DropdownMenuItem onSelect={copySelection}>
            <IconCopy className="h-4 w-4" />
            {t("transcriptEditor.copy")}
          </DropdownMenuItem>
          {onTrimRange ? (
            <DropdownMenuItem onSelect={cutSelection}>
              <IconCut className="h-4 w-4" />
              {t("transcriptEditor.cut")}
            </DropdownMenuItem>
          ) : null}
          {onTrimRange ? (
            <DropdownMenuItem onSelect={deleteSelection}>
              <IconTrash className="h-4 w-4" />
              {t("transcriptEditor.delete")}
            </DropdownMenuItem>
          ) : null}
          {selectionTouchesExcluded && onRestoreRange ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onRestoreRange({
                    startMs: selection.startMs,
                    endMs: selection.endMs,
                  });
                  clearSelection();
                  setMenuPos(null);
                }}
              >
                <IconArrowBackUp className="h-4 w-4" />
                {t("transcriptEditor.restore")}
              </DropdownMenuItem>
            </>
          ) : null}
          {onCreateSection ? (
            <DropdownMenuItem
              onSelect={() => {
                onCreateSection({
                  startMs: selection.startMs,
                  endMs: selection.endMs,
                });
                clearSelection();
                setMenuPos(null);
              }}
            >
              <IconBracketsContain className="h-4 w-4" />
              {t("transcriptEditor.createSection")}
            </DropdownMenuItem>
          ) : null}
          {onAddMarkerAt ? (
            <DropdownMenuItem
              onSelect={() => {
                onAddMarkerAt(selection.startMs);
                clearSelection();
                setMenuPos(null);
              }}
            >
              <IconBookmark className="h-4 w-4" />
              {t("transcriptEditor.addMarker")}
            </DropdownMenuItem>
          ) : null}
        </CoordinateMenu>
      ) : null}
    </div>
  );
}

function SelectionToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
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
