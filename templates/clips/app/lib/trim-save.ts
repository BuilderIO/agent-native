import {
  isSameRecord,
  rebaseOntoSaved,
  saveWithMerge,
  type SavedRecord,
  type SaveWithMergeOptions,
} from "@agent-native/core/save-conflict";

import { identifyTrims, type TrimRange } from "./timestamp-mapping";

/**
 * One turn of the trim save queue. It sends the newest edit, not the one that
 * queued it: a save ahead of it may have merged another writer's change, and an
 * older snapshot would write over that. Edits made while it runs stay in `local`.
 */
export async function saveNewestTrims({
  saved,
  local,
  save,
  resolveOverlap,
}: {
  saved: { current: SavedRecord<TrimRange[]> };
  local: { current: TrimRange[] | null };
} & Pick<
  SaveWithMergeOptions<TrimRange[]>,
  "save" | "resolveOverlap"
>): Promise<void> {
  if (!local.current) return;
  const mine: TrimRange[] = identifyTrims(local.current);
  // An earlier turn already sent this edit.
  if (isSameRecord(saved.current.value, mine)) return;
  const result = await saveWithMerge<TrimRange[]>({
    base: saved.current,
    mine,
    save,
    resolveOverlap,
  });
  saved.current = result;
  local.current = rebaseOntoSaved<TrimRange[]>(
    mine,
    identifyTrims(local.current),
    result.value,
  );
}
