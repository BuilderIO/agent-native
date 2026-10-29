import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDecks, type AgentChangeUndoResult } from "@/context/DeckContext";

/** One "Agent updated N slides · Undo" toast per agent run on this deck. */
export function AgentChangeUndo({ deckId }: { deckId: string }) {
  const t = useT();
  const { subscribeAgentChanges, undoAgentChange } = useDecks();
  const [conflictToken, setConflictToken] = useState<string | null>(null);

  const reportFailure = useCallback(
    (result: AgentChangeUndoResult) => {
      if (result === "failed") {
        toast.error(t("deckEditor.historyStepFailed"));
      }
    },
    [t],
  );

  const undo = useCallback(
    async (token: string) => {
      const result = await undoAgentChange(deckId, token);
      if (result === "conflict") setConflictToken(token);
      else reportFailure(result);
    },
    [deckId, reportFailure, undoAgentChange],
  );

  useEffect(
    () =>
      subscribeAgentChanges((change) => {
        if (change.deckId !== deckId) return;
        toast(
          t("deckEditor.agentUpdatedSlides", { count: change.slideCount }),
          {
            id: `agent-change-${deckId}`,
            className: "!bg-background !text-foreground !border-border",
            duration: 10_000,
            closeButton: true,
            classNames: {
              closeButton:
                "!static !order-1 !size-6 !transform-none !rounded-md !border-0 !bg-transparent !p-0 !text-muted-foreground hover:!bg-muted",
            },
            action: {
              label: t("editorToolbar.undo"),
              onClick: () => void undo(change.token),
            },
          },
        );
      }),
    [deckId, subscribeAgentChanges, t, undo],
  );

  const overwrite = async () => {
    const token = conflictToken;
    setConflictToken(null);
    if (!token) return;
    reportFailure(await undoAgentChange(deckId, token, { overwrite: true }));
  };

  return (
    <AlertDialog
      open={conflictToken !== null}
      onOpenChange={(open) => !open && setConflictToken(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("deckEditor.agentUndoConflictTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("deckEditor.agentUndoConflictDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("deckEditor.agentUndoKeep")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void overwrite()}>
            {t("deckEditor.agentUndoConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
