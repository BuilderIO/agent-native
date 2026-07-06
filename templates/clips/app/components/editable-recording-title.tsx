import { useActionMutation, useT } from "@agent-native/core/client";
import { Input } from "@agent-native/toolkit/ui/input";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconEdit } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { isDefaultTitle } from "@/hooks/use-auto-title";
import { cn } from "@/lib/utils";

interface EditableRecordingTitleProps {
  recordingId: string;
  title: string | null | undefined;
  displayTitle?: string;
  canEdit?: boolean;
  showPendingSkeleton?: boolean;
  className?: string;
  inputClassName?: string;
  skeletonClassName?: string;
}

type QuerySnapshot = Array<[unknown[], unknown]>;

function patchRecordingTitle(
  queryClient: ReturnType<typeof useQueryClient>,
  recordingId: string,
  title: string,
) {
  const updatedAt = new Date().toISOString();

  queryClient.setQueriesData(
    { queryKey: ["action", "get-recording-player-data"] },
    (old: any) => {
      if (old?.recording?.id !== recordingId) return old;
      return {
        ...old,
        recording: {
          ...old.recording,
          title,
          updatedAt,
        },
      };
    },
  );

  queryClient.setQueriesData(
    { queryKey: ["action", "list-recordings"] },
    (old: any) => {
      if (!Array.isArray(old?.recordings)) return old;
      return {
        ...old,
        recordings: old.recordings.map((recording: any) =>
          recording?.id === recordingId
            ? { ...recording, title, updatedAt }
            : recording,
        ),
      };
    },
  );
}

function restoreSnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots?: QuerySnapshot,
) {
  snapshots?.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
}

export function EditableRecordingTitle({
  recordingId,
  title,
  displayTitle,
  canEdit = false,
  showPendingSkeleton = false,
  className,
  inputClassName,
  skeletonClassName,
}: EditableRecordingTitleProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title ?? "");

  const titleForInput = isDefaultTitle(title) ? "" : (title ?? "");
  const visibleTitle =
    displayTitle ?? (titleForInput.trim() || t("editableTitle.untitled"));

  const updateTitle = useActionMutation<
    any,
    { id: string; title: string },
    "update-recording"
  >("update-recording", {
    onMutate: async (variables) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: ["action", "get-recording-player-data"],
        }),
        queryClient.cancelQueries({ queryKey: ["action", "list-recordings"] }),
      ]);

      const playerSnapshots = queryClient.getQueriesData({
        queryKey: ["action", "get-recording-player-data"],
      }) as QuerySnapshot;
      const listSnapshots = queryClient.getQueriesData({
        queryKey: ["action", "list-recordings"],
      }) as QuerySnapshot;

      patchRecordingTitle(queryClient, variables.id, variables.title);

      return { playerSnapshots, listSnapshots };
    },
    onError: (_error, _variables, context) => {
      const snapshots = context as
        | { playerSnapshots?: QuerySnapshot; listSnapshots?: QuerySnapshot }
        | undefined;
      restoreSnapshots(queryClient, snapshots?.playerSnapshots);
      restoreSnapshots(queryClient, snapshots?.listSnapshots);
      toast.error(t("editableTitle.renameFailed"));
    },
  });

  useEffect(() => {
    if (!editing) setDraft(titleForInput);
  }, [editing, titleForInput]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  function startEditing() {
    if (!canEdit) return;
    setDraft(titleForInput);
    setEditing(true);
  }

  function cancelEditing(skipBlurCommit = false) {
    if (skipBlurCommit) skipBlurCommitRef.current = true;
    setDraft(titleForInput);
    setEditing(false);
  }

  function commitTitle() {
    const nextTitle = draft.trim();
    const currentTitle = titleForInput.trim();

    if (!nextTitle) {
      toast.error(t("editableTitle.emptyTitle"));
      cancelEditing();
      return;
    }

    setEditing(false);
    if (nextTitle === currentTitle) return;

    updateTitle.mutate({ id: recordingId, title: nextTitle });
  }

  let content: ReactNode;
  if (showPendingSkeleton && !editing) {
    content = (
      <Skeleton
        aria-label={t("editableTitle.generatingTitle")}
        className={cn("h-4 w-56 max-w-full", skeletonClassName)}
      />
    );
  } else {
    content = <span className="truncate">{visibleTitle}</span>;
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            skipBlurCommitRef.current = true;
            commitTitle();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing(true);
          }
        }}
        onBlur={() => {
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
            return;
          }
          commitTitle();
        }}
        placeholder={t("editableTitle.placeholder")}
        className={cn("h-8 w-full min-w-0", inputClassName)}
        disabled={updateTitle.isPending}
      />
    );
  }

  if (!canEdit) {
    return <div className={cn("min-w-0 truncate", className)}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
      className={cn(
        "group/title -mx-1 flex min-w-0 max-w-full items-center gap-1 rounded px-1 text-start",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-label={t("editableTitle.editLabel")}
    >
      <span className="min-w-0 flex-1 truncate">{content}</span>
      <IconEdit className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-70 group-focus-visible/title:opacity-70" />
    </button>
  );
}
