import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import {
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

interface PendingChoice<T> {
  overlap: SaveOverlap<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface SaveConflictPromptOptions<T> {
  /** What's being saved, in a few words, for the count. Like `form_fields`. */
  record: string;
  /** Names a changed path for the person. Without it, no list of fields shows. */
  describeField?: (path: string, overlap: SaveOverlap<T>) => string | null;
  /** Takes the version the person gave up, as an ordinary new edit. */
  onRestore: (value: T) => void;
}

/**
 * The one prompt for two writers changing the same field. Pass `resolveOverlap`
 * to `saveWithMerge` and render `prompt`. It waits for a choice, counts it, and
 * then offers the other version until it's dismissed.
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
    other: T;
  } | null>(null);

  const queueRef = React.useRef(queue);
  queueRef.current = queue;
  // A save waiting on a choice nobody can make any more must fail, not hang.
  React.useEffect(
    () => () => {
      for (const pending of queueRef.current) {
        pending.reject(new SaveOverlapError(pending.overlap));
      }
    },
    [],
  );

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
    (overlap: SaveOverlap<T>) =>
      new Promise<T>((resolve, reject) => {
        count("shown", overlap.fields.length);
        setQueue((current) => [...current, { overlap, resolve, reject }]);
      }),
    [count],
  );

  const pending = queue.length > 0 ? queue[0] : null;

  function choose(kept: "mine" | "theirs") {
    if (!pending) return;
    const { overlap, resolve } = pending;
    count(kept === "mine" ? "keep_mine" : "use_theirs", overlap.fields.length);
    setSettled({
      kept,
      other: kept === "mine" ? overlap.useTheirs : overlap.keepMine,
    });
    setQueue((current) => current.slice(1));
    resolve(kept === "mine" ? overlap.keepMine : overlap.useTheirs);
  }

  function restore() {
    if (!settled) return;
    count("restored");
    setSettled(null);
    onRestore(settled.other);
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
