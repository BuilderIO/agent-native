import { useT } from "@agent-native/core/client/i18n";
import type { AgentLevel } from "@shared/agent-level";
import { IconRobot } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useContentActionMutation } from "@/hooks/use-content-action-mutation";
import { documentQueryFilter } from "@/lib/document-query";

export type { AgentLevel };

export function useAgentLevel(documentId: string, savedLevel: AgentLevel) {
  const t = useT();
  const queryClient = useQueryClient();
  const setLock = useContentActionMutation("set-document-agent-text-lock", {
    invalidates: [],
  });
  const [pending, setPending] = useState<AgentLevel | null>(null);
  const latestChange = useRef(0);
  const level = pending ?? savedLevel;

  const apply = useCallback(
    async (next: AgentLevel, previous: AgentLevel, announce: boolean) => {
      // Undo can land while a menu change is saving; only the latest one ends the wait.
      const change = ++latestChange.current;
      setPending(next);
      try {
        await setLock.mutateAsync({ id: documentId, level: next });
        queryClient.setQueriesData(
          documentQueryFilter(documentId),
          (old: unknown) =>
            old && typeof old === "object"
              ? { ...old, agentLevel: next, agentTextLocked: next !== "edit" }
              : old,
        );
        if (announce) {
          toast.success(
            next === "view"
              ? t("editor.toolbar.agentLevelViewConfirm")
              : next === "comment"
                ? t("editor.toolbar.agentLevelCommentConfirm")
                : t("editor.toolbar.agentLevelEditConfirm"),
            {
              // The phone sheet turns off clicks outside it; Undo has to work there.
              className: "pointer-events-auto",
              action: {
                label: t("editor.toolbar.undo"),
                onClick: () => void apply(previous, next, false),
              },
            },
          );
        }
      } catch (err) {
        toast.error(t("editor.toolbar.agentLevelUpdateFailed"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
        });
      } finally {
        if (change === latestChange.current) setPending(null);
        void queryClient.invalidateQueries(documentQueryFilter(documentId));
      }
    },
    [documentId, queryClient, setLock, t],
  );

  const setLevel = useCallback(
    (next: AgentLevel) => {
      if (next !== level) void apply(next, level, true);
    },
    [apply, level],
  );

  return { level, setLevel, pending: pending !== null };
}

/** The note beside the Share button while agents are limited on this page. */
export function AgentLevelNote({
  level,
  onOpen,
}: {
  level: AgentLevel;
  onOpen: () => void;
}) {
  const t = useT();
  if (level === "edit") return null;
  const hint =
    level === "view"
      ? t("editor.toolbar.agentLevelViewNoteHint")
      : t("editor.toolbar.agentLevelNoteHint");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onOpen}
      title={hint}
      aria-label={hint}
      className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-xs font-normal text-muted-foreground"
    >
      <IconRobot aria-hidden="true" className="size-4" />
      <span className="hidden @min-[40rem]/toolbar:inline">
        {level === "view"
          ? t("editor.toolbar.agentLevelViewNote")
          : t("editor.toolbar.agentLevelNote")}
      </span>
    </Button>
  );
}
