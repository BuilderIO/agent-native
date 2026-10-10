/**
 * Chapter list shown under the description on the recording page and the
 * share page, Loom-style.
 *
 * - View: a "Chapters" box. Each row is a timestamp link (click to jump)
 *   followed by the title. Editors get a pencil that flips the box into edit
 *   mode, or an "Add chapters" button when there are none.
 * - Edit: one text area, one chapter per line as "<time> <title>". Save
 *   parses the lines back into chapters; Cancel (or Escape) discards.
 *
 * Times on screen are the times the viewer sees: after trims and cuts
 * (originalToEdited), the same mapping the player uses for its chapter
 * marks. Chapters are stored in original-media milliseconds, so typed times
 * are mapped back with editedToOriginal. A chapter inside a cut isn't shown
 * or editable here, and is kept as it is when the others are saved.
 *
 * Persistence is the existing `set-chapters` action, the same one the editor
 * sidebar uses, so the two stay in sync.
 */

import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  chapterSaveFailure,
  sameChapters,
  sameCuts,
  storableMs,
} from "@shared/stored-chapters";
import { IconPencil, IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Chapter } from "@/hooks/use-player-shortcuts";
import {
  editedMarkerMs,
  editedToOriginal,
  effectiveDuration,
  formatMs,
  cutRangesOf,
  isExcluded,
  parseEdits,
  type CutRange,
  type EditsJson,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

/**
 * Parse "m:ss" or "h:mm:ss" into milliseconds. A bare number is refused, so
 * a numbered list ("1 Introduction") or a title starting with a number
 * isn't quietly saved as a chapter near 0:00.
 * Returns null for anything malformed so a bad edit is rejected rather than
 * silently snapping a chapter to 0:00.
 */
const MAX_CHAPTER_SECONDS = 100 * 3600;

// The zero of each other digit set the app's locales type: Arabic-Indic,
// Persian/Urdu, Devanagari.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966];

/**
 * Times typed in the viewer's own digits, or the full-width digits and
 * colon CJK input methods produce, read as ASCII.
 */
function asciiDigits(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f]/g, (ch) => {
      const code = ch.charCodeAt(0);
      const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9)!;
      return String(code - zero);
    });
}

export function parseTimestamp(input: string): number | null {
  const parts = asciiDigits(input)
    .trim()
    .split(":")
    .map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  // Digits only, and few enough that the result is a real, finite time.
  if (parts.some((p) => p === "" || !/^\d{1,6}$/.test(p))) return null;
  const nums = parts.map(Number);
  // Only the first part may run over: "1:75" or "0:4800" is a typo, not
  // 2:15 or 1:20:00.
  if (nums.slice(1).some((n) => n >= 60)) return null;
  let seconds: number;
  if (nums.length === 2) seconds = nums[0] * 60 + nums[1];
  else seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  return seconds < MAX_CHAPTER_SECONDS ? seconds * 1000 : null;
}

export type ChapterLineError =
  | { kind: "shape"; line: number }
  | { kind: "badTime"; line: number; value: string }
  | { kind: "pastEnd"; line: number; value: string }
  | { kind: "duplicate"; line: number; value: string };

/**
 * Parse the edit text area into chapters (times as typed, in whole-second
 * ms). One chapter per non-empty line: a leading time token, then the
 * title. Returns the first malformed line's problem (not chapters) so the
 * user can fix it before saving; the component words it in the viewer's
 * language.
 */
export function parseChapterLines(
  text: string,
  options: {
    /** The clip's length as the viewer sees it; new times past it are refused. */
    maxMs?: number;
    /**
     * How many chapters already sit at each shown time. Those are accepted
     * as they are: past maxMs (the stored duration can be shorter than the
     * media the player plays) and as repeats (chapters a fraction of a
     * second apart show at the same whole second).
     */
    existingMs?: ReadonlyMap<number, number>;
  } = {},
): { chapters: Chapter[] } | { error: ChapterLineError } {
  const { maxMs, existingMs } = options;
  const lines = text.split("\n");
  const chapters: Chapter[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const match = line.match(/^(\S+)\s+(.*)$/);
    if (!match) return { error: { kind: "shape", line: i + 1 } };
    const ms = parseTimestamp(match[1]);
    if (ms == null) {
      return { error: { kind: "badTime", line: i + 1, value: match[1] } };
    }
    if (
      maxMs !== undefined &&
      maxMs > 0 &&
      ms >= maxMs &&
      !existingMs?.has(ms)
    ) {
      return { error: { kind: "pastEnd", line: i + 1, value: match[1] } };
    }
    // No new chapter on a moment that already has one; repeats the list
    // already had are kept.
    const atThisTime = chapters.filter((c) => c.startMs === ms).length;
    if (atThisTime >= Math.max(1, existingMs?.get(ms) ?? 0)) {
      return { error: { kind: "duplicate", line: i + 1, value: match[1] } };
    }
    chapters.push({ startMs: ms, title: match[2].trim() });
  }
  return { chapters: chapters.sort((a, b) => a.startMs - b.startMs) };
}

/** A title on one line, so it survives the one-chapter-per-line text box. */
function oneLine(title: string): string {
  return title.replace(/\s*\n\s*/g, " ").trim();
}

interface VisibleChapter {
  chapter: Chapter;
  editedMs: number;
}

/** Chapters as the viewer sees them: visible ones, at their edited times. */
function visibleChapters(
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

/**
 * Turn the parsed text back into stored chapters. A line whose time the
 * user didn't change keeps its chapter's exact stored time (the box shows
 * whole seconds, the store keeps milliseconds), so fixing one title doesn't
 * move every chapter. Chapters hidden inside a cut are kept as they are.
 */
export function chaptersToSave(
  parsed: Chapter[],
  before: Chapter[],
  edits: EditsJson,
): Chapter[] {
  const unused = visibleChapters(before, edits);
  const shownSecond = (v: VisibleChapter) =>
    Math.floor(v.editedMs / 1000) * 1000;
  // Match on time and title first, so a line moved onto another chapter's
  // second doesn't take that chapter's exact time; then on time alone, for
  // a retitled chapter.
  const claimed = new Map<Chapter, VisibleChapter>();
  const claimWhere = (line: Chapter, fits: (v: VisibleChapter) => boolean) => {
    const index = unused.findIndex(fits);
    if (index >= 0) claimed.set(line, unused.splice(index, 1)[0]);
  };
  for (const line of parsed) {
    claimWhere(
      line,
      (v) =>
        shownSecond(v) === line.startMs &&
        oneLine(v.chapter.title) === line.title,
    );
  }
  for (const line of parsed) {
    if (!claimed.has(line)) {
      claimWhere(line, (v) => shownSecond(v) === line.startMs);
    }
  }
  const saved = parsed.map((line) => {
    const match = claimed.get(line);
    const startMs = match
      ? match.chapter.startMs
      : editedToOriginal(line.startMs, edits);
    return { startMs: storableMs(startMs), title: line.title };
  });
  const hidden = before
    .filter((c) => Number.isFinite(c.startMs) && isExcluded(c.startMs, edits))
    .map((c) => ({ startMs: storableMs(c.startMs), title: c.title }));
  return [...saved, ...hidden].sort((a, b) => a.startMs - b.startMs);
}

const FAILURE_MESSAGE = {
  changed: "chapterList.changedWhileEditing",
  unreadable: "chapters.unreadable",
  failed: "chapters.saveFailed",
} as const;

interface ChapterListProps {
  recordingId: string;
  chapters: Chapter[];
  /** The recording's editsJson, so times match the trimmed player. */
  editsJson: string | null | undefined;
  /** The recording's length, to refuse a typed time past the end. */
  durationMs?: number | null;
  canEdit: boolean;
  /** Seek the player; takes original-media milliseconds. */
  onSeek: (originalMs: number) => void;
  className?: string;
}

export function ChapterList(props: ChapterListProps) {
  return props.canEdit ? (
    <EditableChapterList {...props} />
  ) : (
    <ChapterListView {...props} />
  );
}

function ChapterRows({
  visible,
  onSeek,
}: {
  visible: VisibleChapter[];
  onSeek: (originalMs: number) => void;
}) {
  // Keyed by chapter, not position, so focus stays on the same chapter when
  // a save adds one above it.
  const seen = new Map<string, number>();
  const rowKeys = visible.map(({ chapter }) => {
    const base = `${chapter.startMs}:${chapter.title}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}:${n}`;
  });
  return (
    <ul className="flex min-w-0 flex-1 flex-col gap-1">
      {visible.map(({ chapter, editedMs }, i) => (
        <li key={rowKeys[i]} className="text-sm leading-snug">
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
            <span className="break-words text-foreground">{chapter.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChapterBox({
  headingId,
  className,
  children,
}: {
  headingId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section aria-labelledby={headingId} className={cn("mt-4", className)}>
      <h3
        id={headingId}
        className="mb-1.5 text-sm font-semibold text-foreground"
      >
        {t("chapters.title")}
      </h3>
      <div className="rounded-lg border border-border p-3">{children}</div>
    </section>
  );
}

/** Read-only: viewers on the share page, or anyone who can't edit. */
function ChapterListView({
  chapters,
  editsJson,
  onSeek,
  className,
}: ChapterListProps) {
  const headingId = useId();
  const visible = useMemo(
    () => visibleChapters(chapters, parseEdits(editsJson)),
    [chapters, editsJson],
  );
  if (visible.length === 0) return null;
  return (
    <ChapterBox headingId={headingId} className={className}>
      <ChapterRows visible={visible} onSeek={onSeek} />
    </ChapterBox>
  );
}

function EditableChapterList({
  recordingId,
  chapters,
  editsJson,
  durationMs,
  onSeek,
  className,
}: ChapterListProps) {
  const t = useT();
  const headingId = useId();
  const errorId = useId();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A change to the list or the cuts while the box is open would make the
  // draft's times mean something else, so Save compares against these.
  const [editingFrom, setEditingFrom] = useState<{
    chapters: Chapter[];
    cuts: CutRange[];
    /** The text first shown; null after a conflict, when any Save writes. */
    draft: string | null;
  } | null>(null);
  const [pending, setPending] = useState<Chapter[] | null>(null);
  // A save that failed, offered again on the next open together with the
  // list it is checked against: the one it was written against, or, when
  // the server refused it as stale, the list the server has now.
  const [failedSave, setFailedSave] = useState<{
    draft: string;
    from: { chapters: Chapter[]; cuts: CutRange[]; draft: string | null };
    failure: "changed" | "unreadable" | "failed";
  } | null>(null);
  const mutation = useActionMutation("set-chapters");
  const queryClient = useQueryClient();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => setPending(null), [chapters]);

  useEffect(() => {
    if (mode === "view" && returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [mode]);

  const edits = useMemo(() => parseEdits(editsJson), [editsJson]);
  const cuts = useMemo(() => cutRangesOf(edits), [edits]);
  const shown = pending ?? chapters;
  const visible = useMemo(() => visibleChapters(shown, edits), [shown, edits]);

  const startEditing = () => {
    // One save at a time: a second one could land before the first.
    if (mutation.isPending) return;
    const fresh = visible
      .map(
        ({ chapter, editedMs }) =>
          `${formatMs(editedMs)} ${oneLine(chapter.title)}`,
      )
      .join("\n");
    setDraft(failedSave?.draft ?? fresh);
    setEditingFrom(failedSave?.from ?? { chapters: shown, cuts, draft: fresh });
    setError(failedSave ? t(FAILURE_MESSAGE[failedSave.failure]) : null);
    setFailedSave(null);
    setMode("edit");
  };

  const leaveEditing = () => {
    returnFocus.current = true;
    setEditingFrom(null);
    setError(null);
    setMode("view");
  };

  const describe = (lineError: ChapterLineError) => {
    switch (lineError.kind) {
      case "shape":
        return t("chapterList.errorLineShape", { line: lineError.line });
      case "badTime":
        return t("chapterList.errorBadTime", {
          line: lineError.line,
          value: lineError.value,
        });
      case "pastEnd":
        return t("chapterList.errorPastEnd", {
          line: lineError.line,
          value: lineError.value,
        });
      case "duplicate":
        return t("chapterList.errorDuplicate", {
          line: lineError.line,
          value: lineError.value,
        });
    }
  };

  const save = () => {
    const from = editingFrom ?? { chapters: shown, cuts, draft: null };
    if (from.draft !== null && draft === from.draft) {
      leaveEditing();
      return;
    }
    const parsed = parseChapterLines(draft, {
      maxMs: durationMs ? effectiveDuration(durationMs, edits) : undefined,
      existingMs: visibleChapters(from.chapters, edits).reduce((counts, v) => {
        const second = Math.floor(v.editedMs / 1000) * 1000;
        return counts.set(second, (counts.get(second) ?? 0) + 1);
      }, new Map<number, number>()),
    });
    if ("error" in parsed) {
      setError(describe(parsed.error));
      return;
    }
    if (!sameChapters(from.chapters, shown) || !sameCuts(from.cuts, cuts)) {
      // Keep the draft; from now on it is compared with the latest list, so
      // a second Save, after checking, replaces it.
      setEditingFrom({ chapters: shown, cuts, draft: null });
      setError(t("chapterList.changedWhileEditing"));
      return;
    }
    const next = chaptersToSave(parsed.chapters, from.chapters, edits);
    if (sameChapters(next, from.chapters)) {
      leaveEditing();
      return;
    }
    const draftBeforeSave = draft;
    setPending(next);
    leaveEditing();
    mutation.mutate(
      {
        recordingId,
        chapters: next,
        expectedChapters: from.chapters,
        expectedCuts: from.cuts,
      },
      {
        onError: (err) => {
          const refusal = err as {
            errorCode?: unknown;
            details?: { chapters?: unknown; cuts?: unknown };
          } | null;
          const failure = chapterSaveFailure(err);
          const changed = failure === "changed";
          const server =
            changed &&
            Array.isArray(refusal?.details?.chapters) &&
            Array.isArray(refusal?.details?.cuts)
              ? {
                  chapters: refusal.details.chapters as Chapter[],
                  cuts: refusal.details.cuts as CutRange[],
                }
              : null;
          // Show the server's list until the page's data catches up; the
          // next Save is checked against it and replaces it.
          setPending(server?.chapters ?? null);
          setFailedSave({
            draft: draftBeforeSave,
            from: server ? { ...server, draft: null } : from,
            failure,
          });
          // A save whose reply was lost may still have been stored.
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-recording-player-data", { recordingId }],
          });
          // The hook's error text is English and for developers.
          console.error("[clips] set-chapters failed", err);
          toast.error(t(FAILURE_MESSAGE[failure]));
        },
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape and Enter belong to the input method while it is composing.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      leaveEditing();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };

  if (mode === "view" && visible.length === 0) {
    return (
      <div className={cn("mt-4", className)}>
        <Button
          ref={editButtonRef}
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-muted-foreground aria-disabled:cursor-wait aria-disabled:opacity-50"
          onClick={startEditing}
          aria-disabled={mutation.isPending || undefined}
        >
          <IconPlus className="size-3.5" />
          {t("chapterList.add")}
        </Button>
      </div>
    );
  }

  return (
    <ChapterBox headingId={headingId} className={className}>
      {mode === "edit" ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            rows={Math.max(3, draft.split("\n").length + 1)}
            placeholder={t("chapterList.placeholder")}
            aria-labelledby={headingId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="resize-y font-mono text-xs leading-relaxed"
            autoFocus
          />
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="text-[11px] text-destructive"
            >
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save}>
              {t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={leaveEditing}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <ChapterRows visible={visible} onSeek={onSeek} />
          <Button
            ref={editButtonRef}
            size="sm"
            variant="ghost"
            aria-label={t("chapterList.editLabel")}
            className="h-7 w-7 shrink-0 p-0 aria-disabled:cursor-wait aria-disabled:opacity-50"
            onClick={startEditing}
            aria-disabled={mutation.isPending || undefined}
          >
            <IconPencil className="h-4 w-4" />
          </Button>
        </div>
      )}
    </ChapterBox>
  );
}
