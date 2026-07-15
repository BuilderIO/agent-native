import { useActionQuery } from "@agent-native/core/client";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

/**
 * Read-mostly Descript-style transcript document for a Clips recording —
 * the SHARED convergence surface between the clips editor and the full
 * (multi-track) editor. Renders the recording's transcript as pause-based
 * paragraphs of clickable, playhead-highlighted words.
 *
 * The clips editor keeps its richer `TranscriptEditor` (caret, "/" splits,
 * markers); this component is the portable core for hosts that only need
 * read/seek — e.g. the full editor's inspector when a spoken-word track is
 * selected. All times are RECORDING milliseconds; hosts map to/from their
 * own timeline space.
 */

interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

const PARAGRAPH_PAUSE_MS = 700;
const PARAGRAPH_MAX_MS = 30_000;

export function TranscriptDocument({
  recordingId,
  currentMs,
  onSeekMs,
  windowStartMs,
  windowEndMs,
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
  className?: string;
}) {
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

  if (!query.isLoading && segments.length === 0) return null;

  const hasWindow =
    typeof windowStartMs === "number" && typeof windowEndMs === "number";

  return (
    <div
      className={cn(
        "select-text text-sm leading-7 text-foreground/90",
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
            const outsideWindow =
              hasWindow &&
              (s.endMs <= (windowStartMs as number) ||
                s.startMs >= (windowEndMs as number));
            return (
              <span
                key={`${s.startMs}-${i}`}
                data-start-ms={s.startMs}
                data-end-ms={s.endMs}
                onClick={() => onSeekMs?.(s.startMs)}
                className={cn(
                  "cursor-pointer rounded px-0.5",
                  active && "bg-primary/20 text-foreground",
                  outsideWindow && "opacity-40",
                  onSeekMs && "hover:bg-accent/60",
                )}
              >
                {s.text}{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
