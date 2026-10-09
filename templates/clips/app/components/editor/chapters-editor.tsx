import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  CHAPTERS_BUSY,
  CHAPTERS_CHANGED,
  chapterSaveFailure,
  sameChapters,
  storableMs,
} from "@shared/stored-chapters";
import { IconBookmarks, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMs } from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

export interface Chapter {
  startMs: number;
  title: string;
}

/**
 * A shown chapter with an id of its own, so a row keeps its title box and
 * its edits find it when the list is replaced from the server.
 */
type Row = Chapter & { id: number };

let lastRowId = 0;

/** Rows for a list, keeping the ids of rows it still has. */
function rowsFor(list: readonly Chapter[], before: readonly Row[]): Row[] {
  const unused = [...before];
  const claim = (fits: (r: Row) => boolean) => {
    const i = unused.findIndex(fits);
    return i < 0 ? undefined : unused.splice(i, 1)[0].id;
  };
  // Time and title first, so a retitled row doesn't take another's id.
  const exact = list.map((c) =>
    claim((r) => r.startMs === c.startMs && r.title === c.title),
  );
  return list.map((c, i) => ({
    startMs: c.startMs,
    title: c.title,
    id: exact[i] ?? claim((r) => r.startMs === c.startMs) ?? ++lastRowId,
  }));
}

const FAILURE_MESSAGE = {
  changed: "chapters.changedElsewhere",
  unreadable: "chapters.unreadable",
  failed: "chapters.saveFailed",
} as const;

export interface ChaptersEditorProps {
  recordingId: string;
  chapters: Chapter[];
  currentMs: number;
  onSeek?: (ms: number) => void;
  className?: string;
}

export function ChaptersEditor({
  recordingId,
  chapters,
  currentMs,
  onSeek,
  className,
}: ChaptersEditorProps) {
  const t = useT();
  const [local, setLocal] = useState<Row[]>(() => rowsFor(chapters, []));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The stored list the next save is checked against, so a save never
  // replaces chapters changed elsewhere (the chapter list, the agent). It is
  // only ever taken from the server; if it is out of date, the server
  // refuses the save and hands back the current list.
  const storedRef = useRef<Chapter[]>(chapters);
  // The shown list, updated in the same step as storedRef: edits build on
  // this, never on `local`, which lags a render behind. Otherwise a
  // keystroke just after a refusal edits the refused list and is checked
  // against the new one, and overwrites it.
  const shownRef = useRef<Row[]>(local);
  // One save at a time; edits made meanwhile wait here as the newest list,
  // so they go out as a single save.
  const unsentRef = useRef<Chapter[] | null>(null);
  const sendingRef = useRef(false);
  const pressedRef = useRef<Row | null>(null);

  const mutation = useActionMutation("set-chapters");
  const queryClient = useQueryClient();

  const show = (rows: Row[]) => {
    shownRef.current = rows;
    setLocal(rows);
  };
  const showStored = () => show(rowsFor(storedRef.current, shownRef.current));

  // Only for new page data: data already seen may be older than storedRef.
  useEffect(() => {
    // Page data fetched while an edit is unsaved can predate it.
    if (unsentRef.current || sendingRef.current) return;
    if (sameChapters(chapters, storedRef.current)) return;
    storedRef.current = chapters;
    showStored();
  }, [chapters]);

  const send = async (): Promise<void> => {
    const next = unsentRef.current;
    if (sendingRef.current || debounceRef.current || !next) return;
    unsentRef.current = null;
    sendingRef.current = true;
    let failure: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = (await mutation.mutateAsync({
          recordingId,
          chapters: next,
          expectedChapters: storedRef.current,
        })) as { chapters?: unknown };
        if (!Array.isArray(result?.chapters)) {
          throw new Error("set-chapters returned no chapters");
        }
        storedRef.current = result.chapters as Chapter[];
        failure = null;
        break;
      } catch (err) {
        failure = err;
        if ((err as any)?.errorCode !== CHAPTERS_BUSY) break;
      }
    }
    sendingRef.current = false;

    if (failure) {
      const latest = failure?.details?.chapters;
      const changed =
        failure?.errorCode === CHAPTERS_CHANGED && Array.isArray(latest);
      if (changed) {
        // Newer edits were made on the list that was refused; drop them.
        storedRef.current = latest;
        unsentRef.current = null;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (!unsentRef.current) showStored();
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-recording-player-data", { recordingId }],
      });
      // The hook's error text is English and for developers.
      console.error("[clips] set-chapters failed", failure);
      toast.error(t(FAILURE_MESSAGE[chapterSaveFailure(failure)]));
    }

    return send();
  };

  const commit = (next: Row[]) => {
    show(next);
    // set-chapters takes whole ms; a stored time may not be one.
    unsentRef.current = next.map((r) => ({
      startMs: storableMs(r.startMs),
      title: r.title,
    }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void send();
    }, 300);
  };

  // Closing the panel mid-pause still saves the last edit.
  useEffect(
    () => () => {
      if (!debounceRef.current) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      void send();
    },
    [],
  );

  const addAtCurrent = () => {
    const shown = shownRef.current;
    const startMs = Math.round(currentMs);
    if (shown.some((c) => c.startMs === startMs)) {
      toast.info(t("chapters.duplicateAtPoint"));
      return;
    }
    const title = t("chapters.defaultTitle", { count: shown.length + 1 });
    commit(
      [...shown, { startMs, title, id: ++lastRowId }].sort(
        (a, b) => a.startMs - b.startMs,
      ),
    );
  };

  // An edit names the row and what it showed. The row may since hold other
  // chapters' content from the server, ahead of the screen; then the edit
  // is not made, and the user is told.
  const findRow = (id: number, seen: Chapter) => {
    const i = shownRef.current.findIndex(
      (r) =>
        r.id === id && r.startMs === seen.startMs && r.title === seen.title,
    );
    if (i < 0) toast.error(t("chapters.changedElsewhere"));
    return i;
  };

  const rename = (id: number, seen: Chapter, title: string) => {
    const i = findRow(id, seen);
    if (i < 0) return false;
    const next = [...shownRef.current];
    next[i] = { ...next[i], title };
    commit(next);
    return true;
  };

  const remove = (id: number, seen: Chapter) => {
    const i = findRow(id, seen);
    if (i < 0) return;
    commit(shownRef.current.filter((_, j) => j !== i));
  };

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <IconBookmarks className="w-4 h-4 text-primary" />
          {t("chapters.title")}
        </div>
        <Button size="sm" variant="secondary" onClick={addAtCurrent}>
          <IconPlus className="w-3.5 h-3.5 mr-1" />
          {t("chapters.addHere")}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {local.length === 0 ? (
          <Empty className="gap-2 rounded-none px-3 py-6 md:p-6">
            <EmptyHeader>
              <EmptyTitle className="text-xs font-normal text-muted-foreground">
                {t("chapters.empty")}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          local.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 border-b border-border/60 group"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSeek?.(c.startMs)}
                    className="text-[11px] font-mono text-muted-foreground w-14 shrink-0 text-left hover:text-foreground"
                  >
                    {formatMs(c.startMs)}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("chapters.seekTo", { time: formatMs(c.startMs) })}
                </TooltipContent>
              </Tooltip>
              <ChapterTitleInput
                title={c.title}
                onRename={(from, title) =>
                  rename(c.id, { startMs: c.startMs, title: from }, title)
                }
                onChangedElsewhere={() =>
                  toast.error(t("chapters.changedElsewhere"))
                }
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0"
                    // What the row showed when pressed, in case it changes
                    // before the click lands.
                    onPointerDown={() => {
                      pressedRef.current = c;
                    }}
                    onClick={() => {
                      remove(c.id, pressedRef.current ?? c);
                      pressedRef.current = null;
                    }}
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("chapters.remove")}</TooltipContent>
              </Tooltip>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * A chapter's title box. A title is saved when the box is left or Enter is
 * pressed, never part-typed; an empty box, or Escape, puts it back. A title
 * changed elsewhere while the box is being edited replaces what was typed
 * at once, so the row always shows the chapter it acts on; the save also
 * names the title it started from, for a change not yet on screen.
 */
function ChapterTitleInput({
  title,
  onRename,
  onChangedElsewhere,
}: {
  title: string;
  /** False, having said so, when the chapter isn't as it was entered. */
  onRename: (from: string, title: string) => boolean;
  onChangedElsewhere: () => void;
}) {
  const [draft, setDraft] = useState(title);
  const [editing, setEditing] = useState(false);
  const enteredWith = useRef(title);
  const latest = useRef({ draft, editing, onRename });
  latest.current = { draft, editing, onRename };

  useEffect(() => {
    if (title === enteredWith.current && editing) return;
    if (editing && latest.current.draft !== enteredWith.current) {
      onChangedElsewhere();
    }
    enteredWith.current = title;
    setDraft(title);
    // Only a new title from the list; `editing` turning off is handled by blur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  /** Saves what was typed, if anything; false if it couldn't be. */
  const saveDraft = () => {
    const { draft, onRename } = latest.current;
    if (!draft.trim() || draft === enteredWith.current) return true;
    return onRename(enteredWith.current, draft);
  };

  // Closing the panel mid-edit removes the box without a blur.
  useEffect(
    () => () => {
      if (latest.current.editing) saveDraft();
    },
    [],
  );

  return (
    <Input
      value={draft}
      onFocus={() => {
        enteredWith.current = title;
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (!saveDraft() || !latest.current.draft.trim()) setDraft(title);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          latest.current.draft = enteredWith.current;
          setDraft(enteredWith.current);
          e.currentTarget.blur();
        }
      }}
      className="h-7 text-xs"
    />
  );
}
