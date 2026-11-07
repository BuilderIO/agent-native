import { useT } from "@agent-native/core/client/i18n";
import { IconRobot } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useContentActionMutation } from "@/hooks/use-content-action-mutation";
import { documentQueryFilter } from "@/lib/document-query";

/** What agents may do on a page, in people's words. The server stores it as the page's text lock. */
export type AgentLevel = "comment" | "edit";

export function useAgentLevel(documentId: string, locked: boolean) {
  const t = useT();
  const queryClient = useQueryClient();
  const setLock = useContentActionMutation("set-document-agent-text-lock", {
    invalidates: [],
  });
  const [pending, setPending] = useState<AgentLevel | null>(null);
  const level: AgentLevel = locked ? "comment" : "edit";

  const apply = useCallback(
    async (next: AgentLevel, announce: boolean) => {
      setPending(next);
      try {
        const nextLocked = next === "comment";
        await setLock.mutateAsync({ id: documentId, locked: nextLocked });
        queryClient.setQueriesData(
          documentQueryFilter(documentId),
          (old: unknown) =>
            old && typeof old === "object"
              ? { ...old, agentTextLocked: nextLocked }
              : old,
        );
        if (announce) {
          toast.success(
            t(
              nextLocked
                ? "editor.toolbar.agentLevelCommentConfirm"
                : "editor.toolbar.agentLevelEditConfirm",
            ),
            {
              // The phone sheet turns off clicks outside it; Undo has to work there.
              className: "pointer-events-auto",
              action: {
                label: t("editor.toolbar.undo"),
                onClick: () =>
                  void apply(nextLocked ? "edit" : "comment", false),
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
        setPending(null);
        void queryClient.invalidateQueries(documentQueryFilter(documentId));
      }
    },
    [documentId, queryClient, setLock, t],
  );

  const setLevel = useCallback(
    (next: AgentLevel) => {
      if (next !== level) void apply(next, true);
    },
    [apply, level],
  );

  return { level: pending ?? level, setLevel, pending: pending !== null };
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
  const hint = t("editor.toolbar.agentLevelNoteHint");
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
        {t("editor.toolbar.agentLevelNote")}
      </span>
    </Button>
  );
}
