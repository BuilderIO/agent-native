import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TagInput } from "@/components/library/tag-input";

const MAX_TAG_LENGTH = 64;

type TagOp = "add" | "remove";

const NO_OPS: Record<string, TagOp> = {};

interface RecordingTagsBarProps {
  recordingId: string;
  tags: string[];
  canEdit: boolean;
}

export function RecordingTagsBar({
  recordingId,
  tags,
  canEdit,
}: RecordingTagsBarProps) {
  const t = useT();
  const update = useActionMutation<
    unknown,
    { recordingId: string; tag: string; op: TagOp }
  >("tag-recording");

  const [overlay, setOverlay] = useState<{
    id: string;
    ops: Record<string, TagOp>;
  }>(() => ({ id: recordingId, ops: NO_OPS }));

  const ops = overlay.id === recordingId ? overlay.ops : NO_OPS;

  const displayed = useMemo(() => {
    const kept = tags.filter((tag) => ops[tag] !== "remove");
    const added = Object.keys(ops).filter(
      (tag) => ops[tag] === "add" && !tags.includes(tag),
    );
    return [...kept, ...added];
  }, [tags, ops]);

  const serverKey = tags.join("\u0000");
  useEffect(() => {
    setOverlay((prev) => {
      if (prev.id !== recordingId) return { id: recordingId, ops: NO_OPS };
      let settled = false;
      const next: Record<string, TagOp> = {};
      for (const [tag, op] of Object.entries(prev.ops)) {
        const onServer = tags.includes(tag);
        if ((op === "add" && onServer) || (op === "remove" && !onServer)) {
          settled = true;
          continue;
        }
        next[tag] = op;
      }
      return settled ? { id: recordingId, ops: next } : prev;
    });
    // `overlay` is a dependency as well as `serverKey`: an intention can be
    // satisfied by a server value that never changed — queue a remove for a
    // tag that is already absent and nothing about the payload moves — and
    // without re-running here that entry would sit in the overlay forever,
    // masking the tag if it later came back from somewhere else.
    // `serverKey` is the value identity; `tags` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey, recordingId, overlay]);

  const queues = useRef(new Map<string, Promise<unknown>>());

  function enqueue(forId: string, tag: string, op: TagOp) {
    const key = `${forId}::${tag}`;
    const previous = queues.current.get(key) ?? Promise.resolve();
    const run: Promise<unknown> = previous
      .catch(() => {})
      .then(() => update.mutateAsync({ recordingId: forId, tag, op }))
      .then(undefined, (error: Error) => {
        setOverlay((prev) => {
          if (prev.id !== forId || prev.ops[tag] !== op) return prev;
          const next = { ...prev.ops };
          delete next[tag];
          return { id: prev.id, ops: next };
        });
        toast.error(
          actionErrorMessage(error) ?? t("recordingPage.tagsUpdateFailed"),
        );
      })
      .finally(() => {
        if (queues.current.get(key) === run) queues.current.delete(key);
      });
    queues.current.set(key, run);
  }

  function commit(next: string[]) {
    const forId = recordingId;
    const added = next.filter((tag) => !displayed.includes(tag));
    const removed = displayed.filter((tag) => !next.includes(tag));

    const tooLong = added.filter((tag) => tag.length > MAX_TAG_LENGTH);
    if (tooLong.length > 0) {
      toast.error(t("recordingPage.tagTooLong", { max: MAX_TAG_LENGTH }));
    }
    const accepted = added.filter((tag) => tag.length <= MAX_TAG_LENGTH);
    if (accepted.length === 0 && removed.length === 0) return;

    setOverlay((prev) => {
      const ops = { ...(prev.id === forId ? prev.ops : NO_OPS) };
      for (const tag of accepted) ops[tag] = "add";
      for (const tag of removed) ops[tag] = "remove";
      return { id: forId, ops };
    });
    for (const tag of accepted) enqueue(forId, tag, "add");
    for (const tag of removed) enqueue(forId, tag, "remove");
  }

  const suggestionsQ = useActionQuery<{ tags: string[] }>(
    "list-recording-tags",
    {},
    { enabled: canEdit, staleTime: 60_000 },
  );

  if (!canEdit && displayed.length === 0) return null;

  return (
    <div className="mt-3">
      {canEdit ? (
        <TagInput
          value={displayed}
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
          {displayed.map((tag) => (
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
