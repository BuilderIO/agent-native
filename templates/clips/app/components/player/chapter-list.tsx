/**
 * A clip's chapters as a list under the description, on the recording page
 * and on share links. Each row is a time and a title; clicking it seeks the
 * player there. Editing stays in the editor sidebar.
 *
 * Times are the ones the viewer sees, after trims and cuts, from the same
 * mapping the player uses for its chapter marks. A chapter inside a cut is
 * left out, as it is on the scrubber.
 */

import { useT } from "@agent-native/core/client/i18n";
import { useId, useMemo } from "react";

import type { Chapter } from "@/hooks/use-player-shortcuts";
import {
  editedMarkerMs,
  formatMs,
  parseEdits,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

interface VisibleChapter {
  chapter: Chapter;
  editedMs: number;
}

/** Chapters as the viewer sees them: visible ones, at their edited times. */
export function visibleChapters(
  chapters: Chapter[],
  edits: EditsJson,
): VisibleChapter[] {
  return chapters
    .flatMap((chapter) => {
      const editedMs = editedMarkerMs(chapter.startMs, edits);
      return editedMs === null ? [] : [{ chapter, editedMs }];
    })
    .sort((a, b) => a.editedMs - b.editedMs);
}

interface ChapterListProps {
  chapters: Chapter[];
  /** The recording's editsJson, so times match the trimmed player. */
  editsJson: string | null | undefined;
  /** Seek the player; takes original-media milliseconds. */
  onSeek: (originalMs: number) => void;
  className?: string;
}

export function ChapterList({
  chapters,
  editsJson,
  onSeek,
  className,
}: ChapterListProps) {
  const t = useT();
  const headingId = useId();
  const visible = useMemo(
    () => visibleChapters(chapters, parseEdits(editsJson)),
    [chapters, editsJson],
  );
  if (visible.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={cn("mt-4", className)}>
      <h3
        id={headingId}
        className="mb-1.5 text-sm font-semibold text-foreground"
      >
        {t("chapters.title")}
      </h3>
      <ul className="flex flex-col gap-1 rounded-lg border border-border p-3">
        {visible.map(({ chapter, editedMs }, i) => (
          <li key={`${chapter.startMs}:${i}`} className="text-sm leading-snug">
            {/* One button for time and title, so a screen reader hears which
                chapter it jumps to. */}
            <button
              type="button"
              onClick={() => onSeek(chapter.startMs)}
              className="group text-start"
            >
              <span className="me-2 font-mono text-primary group-hover:underline">
                {formatMs(editedMs)}
              </span>
              <span className="break-words text-foreground">
                {chapter.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
