import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { TagInput } from "@/components/library/tag-input";

// Matches the bound `tag-recording` enforces server-side, so an over-long tag
// is refused before it is optimistically shown and then snatched back.
const MAX_TAG_LENGTH = 64;

interface RecordingTagsBarProps {
  recordingId: string;
  tags: string[];
  canEdit: boolean;
}

/**
 * The tag box under the player.
 *
 * Deliberately here rather than in the settings panel: adding a tag shouldn't
 * mean opening settings. A tag is created by typing it and pressing Enter, on
 * the recording itself — there is no tag-administration screen and no
 * vocabulary to maintain.
 *
 * Writes go through `tag-recording`, one tag at a time. `update-recording`
 * also accepts tags, but it replaces the whole set by deleting and reinserting
 * every row, so two edits in flight together resolve to whichever finishes
 * last and the other tag is silently lost. The per-tag action has no such
 * ordering dependency.
 *
 * Edits are held locally until the write settles. `get-recording-player-data`
 * is refetched on invalidation (and polled while a recording is still
 * processing), so rendering straight from the prop would let a refetch that
 * was already in flight put the pre-edit set back on screen.
 */
export function RecordingTagsBar({
  recordingId,
  tags,
  canEdit,
}: RecordingTagsBarProps) {
  const t = useT();
  const [local, setLocal] = useState<string[]>(tags);
  // Counted in state, not a ref: the reconciling effect below has to re-run
  // when the last write settles, otherwise the server value it skipped while
  // saving is never adopted.
  const [pending, setPending] = useState(0);
  const lastRecordingIdRef = useRef(recordingId);

  const update = useActionMutation<
    unknown,
    { recordingId: string; tag: string; op: "add" | "remove" }
  >("tag-recording");

  const serverKey = tags.join("\u0000");
  useEffect(() => {
    // The route does not remount this component between recordings, so a
    // recording change has to reset the edit state outright — otherwise a
    // write still in flight from the previous recording suppresses the new
    // one's tags, and the next edit writes them onto the wrong recording.
    if (lastRecordingIdRef.current !== recordingId) {
      lastRecordingIdRef.current = recordingId;
      setPending(0);
      setLocal(tags);
      return;
    }
    if (pending === 0) setLocal(tags);
    // serverKey is the value identity; tags is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey, pending, recordingId]);

  async function apply(tag: string, op: "add" | "remove") {
    setPending((count) => count + 1);
    try {
      await update.mutateAsync({ recordingId, tag, op });
    } catch (error) {
      // Undo only this tag. Reverting to the whole server set would also
      // discard a sibling edit that is still in flight and will succeed.
      setLocal((current) =>
        op === "add"
          ? current.filter((entry) => entry !== tag)
          : current.includes(tag)
            ? current
            : [...current, tag],
      );
      toast.error(
        actionErrorMessage(error as Error) ??
          t("recordingPage.tagsUpdateFailed"),
      );
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }

  function commit(next: string[]) {
    const added = next.filter((tag) => !local.includes(tag));
    const removed = local.filter((tag) => !next.includes(tag));

    const tooLong = added.filter((tag) => tag.length > MAX_TAG_LENGTH);
    if (tooLong.length > 0) {
      toast.error(t("recordingPage.tagTooLong", { max: MAX_TAG_LENGTH }));
    }
    const accepted = added.filter((tag) => tag.length <= MAX_TAG_LENGTH);
    if (accepted.length === 0 && removed.length === 0) return;

    setLocal([...next.filter((tag) => !tooLong.includes(tag))]);
    for (const tag of accepted) void apply(tag, "add");
    for (const tag of removed) void apply(tag, "remove");
  }

  // Suggestions are a separate cached read — see list-recording-tags.
  const suggestionsQ = useActionQuery<{ tags: string[] }>(
    "list-recording-tags",
    {},
    { enabled: canEdit, staleTime: 60_000 },
  );

  // Nothing to show, and no way to add any.
  if (!canEdit && local.length === 0) return null;

  return (
    <div className="mt-3">
      {canEdit ? (
        <TagInput
          value={local}
          suggestions={suggestionsQ.data?.tags ?? []}
          onChange={commit}
          placeholder={t("recordingPage.addTag")}
          aria-label={t("recordingPage.tags")}
          className="max-w-md"
        />
      ) : (
        <div
          role="list"
          aria-label={t("recordingPage.tags")}
          className="flex flex-wrap items-center gap-1"
        >
          {local.map((tag) => (
            <span
              key={tag}
              role="listitem"
              className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
