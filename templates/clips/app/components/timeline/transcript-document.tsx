import { useActionQuery } from "@agent-native/core/client";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useSceneThumbnails } from "@/components/editor/use-scene-thumbnails";
import { cn } from "@/lib/utils";

/**
 * Read-mostly Descript-style transcript document for a Clips recording —
 * the SHARED convergence surface between the clips editor and the full
 * (multi-track) editor. Renders the recording's transcript as pause-based
 * paragraphs of clickable, playhead-highlighted words.
 *
 * The clips editor keeps its richer `TranscriptEditor` (caret, "/" splits,
 * markers); this component is the portable core for hosts that need
 * read/seek plus the two Descript essentials: inline scene thumbnails at
 * segment starts (`scenes` + `videoUrl`) and select-words-then-Delete
 * (`onDeleteRange`). All times are RECORDING milliseconds; hosts map
 * to/from their own timeline space.
 */

interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptWindow {
  startMs: number;
  endMs: number;
}

const PARAGRAPH_PAUSE_MS = 700;
const PARAGRAPH_MAX_MS = 30_000;

export function TranscriptDocument({
  recordingId,
  currentMs,
  onSeekMs,
  windowStartMs,
  windowEndMs,
  windows,
  scenes,
  videoUrl,
  onSceneClick,
  onDeleteRange,
  className,
}: {
  recordingId: string;
  /** Playhead in recording ms (null when the playhead is outside this clip). */
  currentMs: number | null;
  onSeekMs?: (ms: number) => void;
  /**
   * The portion of the recording the host actually uses (e.g. the trimmed
   * source window of a timeline item). Words outside it stay visible but
   * dimmed, so the surrounding context remains readable.
   */
  windowStartMs?: number;
  windowEndMs?: number;
  /**
   * Multi-window variant of windowStartMs/EndMs — e.g. the source windows of
   * every timeline item using this recording. Words covered by none of the
   * windows dim (deleted material reads as removed). Takes precedence over
   * the single-window props.
   */
  windows?: TranscriptWindow[];
  /**
   * Scene start times (recording ms). Each renders as a mini video-frame
   * thumbnail flowing INLINE with the words at its exact position —
   * mid-sentence if that's where the boundary lands, exactly like Descript.
   */
  scenes?: number[];
  /** Video URL to capture scene thumbnails from (required for thumbs). */
  videoUrl?: string | null;
  /** Clicking a scene thumbnail; defaults to onSeekMs. */
  onSceneClick?: (ms: number) => void;
  /**
   * Enables Descript-style word deletion: select words, press
   * Delete/Backspace, and the resolved recording-ms range is reported. The
   * host decides what deletion means (trim edits, timeline ripple, …).
   */
  onDeleteRange?: (range: { startMs: number; endMs: number }) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<{
    startMs: number;
    endMs: number;
  } | null>(null);

  const query = useActionQuery(
    "get-recording-player-data" as any,
    {
      recordingId,
    } as any,
  ) as {
    data?: { transcript?: { segments?: unknown; status?: string } };
    isLoading: boolean;
  };

  const segments = useMemo<TranscriptSegment[]>(() => {
    const raw = query.data?.transcript?.segments;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s: any) => ({
        startMs: Number(s.startMs) || 0,
        endMs: Number(s.endMs) || 0,
        text: String(s.text ?? "").trim(),
      }))
      .filter((s) => s.text);
  }, [query.data?.transcript?.segments]);

  const paragraphs = useMemo(() => {
    const out: TranscriptSegment[][] = [];
    let current: TranscriptSegment[] = [];
    let prevEndMs: number | null = null;
    let prevText = "";
    let paragraphStartMs: number | null = null;
    for (const s of segments) {
      const pause = prevEndMs !== null ? s.startMs - prevEndMs : 0;
      const paragraphMs =
        paragraphStartMs !== null ? s.startMs - paragraphStartMs : 0;
      const atSentenceEnd = /[.!?…。！？]$/.test(prevText);
      if (
        prevEndMs !== null &&
        (pause > PARAGRAPH_PAUSE_MS ||
          (paragraphMs > PARAGRAPH_MAX_MS && atSentenceEnd))
      ) {
        if (current.length) out.push(current);
        current = [];
        paragraphStartMs = null;
      }
      if (paragraphStartMs === null) paragraphStartMs = s.startMs;
      prevEndMs = s.endMs;
      prevText = s.text;
      current.push(s);
    }
    if (current.length) out.push(current);
    return out;
  }, [segments]);

  const sceneTimes = useMemo(
    () =>
      [
        ...new Set((scenes ?? []).map((ms) => Math.max(0, Math.round(ms)))),
      ].sort((a, b) => a - b),
    [scenes],
  );
  const sceneThumbs = useSceneThumbnails({
    videoUrl: videoUrl ?? null,
    times: sceneTimes,
    enabled: Boolean(videoUrl) && sceneTimes.length > 0 && segments.length > 0,
  });

  const coverageWindows = useMemo<TranscriptWindow[] | null>(() => {
    if (windows) return windows;
    if (typeof windowStartMs === "number" && typeof windowEndMs === "number") {
      return [{ startMs: windowStartMs, endMs: windowEndMs }];
    }
    return null;
  }, [windows, windowStartMs, windowEndMs]);

  // Resolve the browser's text selection back to a recording-ms range via
  // the word spans' data attributes (same approach as TranscriptEditor).
  const resolveSelection = (): { startMs: number; endMs: number } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const root = rootRef.current;
    if (!root) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const startEl = findSegmentElement(range.startContainer);
    const endEl = findSegmentElement(range.endContainer);
    if (!startEl || !endEl) return null;
    const startMs = Number(startEl.dataset.startMs ?? Number.NaN);
    const endMs = Number(endEl.dataset.endMs ?? Number.NaN);
    if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return null;
    return { startMs, endMs };
  };

  const handleMouseUp = () => {
    if (!onDeleteRange) return;
    const sel = resolveSelection();
    setSelection(sel);
    // Focus the container so Delete/Backspace reaches our handler; focusing
    // a non-editable ancestor keeps the DOM text selection intact.
    if (sel) rootRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onDeleteRange || !selection) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    e.preventDefault();
    // Keep the host's own delete shortcuts (e.g. the full editor's
    // Backspace-removes-selected-item) out of this gesture.
    e.stopPropagation();
    onDeleteRange(selection);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  if (!query.isLoading && segments.length === 0) return null;

  let sceneIndex = 0;
  const renderScenesBefore = (segStartMs: number, segEndMs: number) => {
    const out: ReactNode[] = [];
    while (
      sceneIndex < sceneTimes.length &&
      sceneTimes[sceneIndex] <= Math.max(segStartMs, segEndMs - 1)
    ) {
      const ms = sceneTimes[sceneIndex++];
      const thumb = sceneThumbs[ms];
      out.push(
        <button
          key={`scene-${ms}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            (onSceneClick ?? onSeekMs)?.(ms);
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
        </button>,
      );
    }
    return out;
  };

  return (
    <div
      ref={rootRef}
      tabIndex={onDeleteRange ? 0 : undefined}
      onMouseUp={onDeleteRange ? handleMouseUp : undefined}
      onKeyDown={onDeleteRange ? handleKeyDown : undefined}
      className={cn(
        "select-text text-sm leading-7 text-foreground/90 outline-none",
        className,
      )}
    >
      {paragraphs.map((para, pi) => (
        <p key={pi} className="mb-3 last:mb-0">
          {para.map((s, i) => {
            const active =
              currentMs !== null &&
              currentMs >= s.startMs &&
              currentMs < s.endMs;
            // Frame-rounded edit boundaries can leave sub-frame slivers of
            // nominal overlap; require meaningful coverage before treating a
            // word as kept.
            const outsideWindow =
              coverageWindows !== null &&
              !coverageWindows.some(
                (w) =>
                  Math.min(s.endMs, w.endMs) - Math.max(s.startMs, w.startMs) >
                  60,
              );
            return (
              <span key={`${s.startMs}-${i}`} className="inline">
                {renderScenesBefore(s.startMs, s.endMs)}
                <span
                  data-start-ms={s.startMs}
                  data-end-ms={s.endMs}
                  onClick={() => onSeekMs?.(s.startMs)}
                  className={cn(
                    "cursor-pointer rounded px-0.5",
                    active && "bg-primary/20 text-foreground",
                    outsideWindow &&
                      "opacity-40 line-through decoration-border",
                    onSeekMs && "hover:bg-accent/60",
                  )}
                >
                  {s.text}{" "}
                </span>
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function findSegmentElement(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.dataset.startMs !== undefined) {
      return el;
    }
    el = el.parentNode;
  }
  return null;
}
