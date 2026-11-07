import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import {
  rebaseOntoSaved,
  SaveOverlapError,
  type SaveOverlap,
} from "@agent-native/core/save-conflict";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import * as React from "react";
import { toast } from "sonner";

interface PendingChoice<T> {
  overlap: SaveOverlap<T>;
  finished: Promise<boolean>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface SaveConflictPromptOptions<T> {
  /** What's being saved, in a few words, for the count. Like `form_fields`. */
  record: string;
  /** Names a changed path for the person. Without it, no list of fields shows. */
  describeField?: (path: string, overlap: SaveOverlap<T>) => string | null;
  /**
   * The person asked for the version they gave up. `restoreOnto` puts it on the
   * record as it is now, keeping what changed since the choice, and `other` is
   * that version whole. Save the result as an ordinary new edit.
   */
  onRestore: (restoreOnto: (current: T) => T, other: T) => void;
}

/**
 * The one prompt for two writers changing the same field. Pass `resolveOverlap`
 * to `saveWithMerge` and render `prompt`. It waits for a choice, counts it, and
 * once that save lands offers the other version until it's dismissed.
 */
export function useSaveConflictPrompt<T>({
  record,
  describeField,
  onRestore,
}: SaveConflictPromptOptions<T>) {
  const t = useT();
  const [queue, setQueue] = React.useState<PendingChoice<T>[]>([]);
  const [settled, setSettled] = React.useState<{
    kept: "mine" | "theirs";
    chosen: T;
    other: T;
  } | null>(null);

  const tRef = React.useRef(t);
  tRef.current = t;
  const mountedRef = React.useRef(true);
  const waitingRef = React.useRef(new Set<PendingChoice<T>>());
  const newestChoiceRef = React.useRef<PendingChoice<T> | null>(null);
  // A save waiting on a choice nobody can make any more must fail, not hang.
  React.useEffect(() => {
    mountedRef.current = true;
    const waiting = waitingRef.current;
    return () => {
      mountedRef.current = false;
      if (waiting.size > 0) toast.error(tRef.current("saveConflict.notSaved"));
      for (const choice of waiting) {
        choice.reject(new SaveOverlapError(choice.overlap));
      }
      waiting.clear();
    };
  }, []);

  const count = React.useCallback(
    (outcome: string, fieldCount?: number) => {
      trackEvent("save_conflict_prompt", {
        record,
        outcome,
        ...(fieldCount === undefined ? {} : { field_count: fieldCount }),
      });
    },
    [record],
  );

  const resolveOverlap = React.useCallback(
    (overlap: SaveOverlap<T>, finished: Promise<boolean>) =>
      new Promise<T>((resolve, reject) => {
        if (!mountedRef.current) {
          toast.error(tRef.current("saveConflict.notSaved"));
          reject(new SaveOverlapError(overlap));
          return;
        }
        count("shown", overlap.fields.length);
        const choice = { overlap, finished, resolve, reject };
        waitingRef.current.add(choice);
        setQueue((current) => [...current, choice]);
      }),
    [count],
  );

  const pending = queue.length > 0 ? queue[0] : null;

  function choose(kept: "mine" | "theirs") {
    if (!pending) return;
    const { overlap, finished, resolve } = pending;
    const [chosen, other] =
      kept === "mine"
        ? [overlap.keepMine, overlap.useTheirs]
        : [overlap.useTheirs, overlap.keepMine];
    waitingRef.current.delete(pending);
    newestChoiceRef.current = pending;
    count(kept === "mine" ? "keep_mine" : "use_theirs", overlap.fields.length);
    setSettled(null);
    setQueue((current) => current.slice(1));
    resolve(chosen);
    // A restore while this save is out would be undone when it comes back, since
    // it can look like no edit at all next to what was sent. The notice doesn't
    // say which record it means, so an older save finishing late can't take it.
    // A save that failed kept nothing, and the next one asks again.
    void finished.then((landed) => {
      if (landed && newestChoiceRef.current === pending) {
        setSettled({ kept, chosen, other });
      }
    });
  }

  function restore() {
    if (!settled) return;
    const { chosen, other } = settled;
    count("restored");
    setSettled(null);
    onRestore((current) => rebaseOntoSaved(chosen, other, current), other);
  }

  const fieldNames =
    pending && describeField
      ? Array.from(
          new Set(
            pending.overlap.fields
              .map((path) => describeField(path, pending.overlap))
              .filter((name): name is string => !!name),
          ),
        )
      : [];

  const prompt = (
    <>
      <AlertDialog open={pending !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("saveConflict.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("saveConflict.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {fieldNames.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("saveConflict.changedByBoth", {
                fields: fieldNames.join(", "),
              })}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => choose("theirs")}>
              {t("saveConflict.useTheirs")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => choose("mine")}>
              {t("saveConflict.keepMine")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {settled ? (
        <div
          role="status"
          className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
        >
          <span>
            {settled.kept === "mine"
              ? t("saveConflict.keptMine")
              : t("saveConflict.usedTheirs")}
          </span>
          <Button size="sm" variant="outline" onClick={restore}>
            {t("saveConflict.getOtherBack")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSettled(null)}>
            {t("saveConflict.dismiss")}
          </Button>
        </div>
      ) : null}
    </>
  );

  return { resolveOverlap, prompt };
}
