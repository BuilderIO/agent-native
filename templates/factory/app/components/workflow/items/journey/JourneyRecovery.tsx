import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconCircleOff, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";

import { useItemsStrings } from "../../items-strings";
import { readActionFailure } from "../../workflow-errors";
import { useWorkflowStrings } from "../../workflow-strings";

/** What the drawer shows while a move is on its way to the server. */
type PendingRecovery = "requeued" | "dismissed";

interface RecoveryRequest {
  factoryId: string;
  itemId: string;
}

/** The statuses a person can act on from the drawer: an item handed off, or one that failed. */
export function canRecover(status: string | null): boolean {
  return status === "needs_manual" || status === "failed";
}

/**
 * Sends an item that needs a person back to its workflow, or closes it. The
 * drawer shows the move at once and puts it back, with the typed error in a
 * toast, when the server refuses; a retry asks first while the workflow is on,
 * because the item may then send messages or update records. Every action
 * query refetches after a write, so the list and the journey follow.
 */
export function useJourneyRecovery({
  factoryId,
  itemId,
  workflowOn,
  refetch,
}: {
  factoryId: string;
  itemId: string;
  /** Undefined while it is not known: the dialog asks rather than guess. */
  workflowOn: boolean | undefined;
  refetch: () => Promise<unknown>;
}) {
  const s = useItemsStrings();
  const ws = useWorkflowStrings();
  const requeue = useActionMutation<unknown, RecoveryRequest>(
    "requeue-factory-item",
  );
  const dismiss = useActionMutation<unknown, RecoveryRequest>(
    "dismiss-factory-item",
  );
  const [pending, setPending] = useState<PendingRecovery | null>(null);
  const [confirming, setConfirming] = useState(false);

  const move = async (kind: PendingRecovery) => {
    setPending(kind);
    try {
      await (kind === "requeued" ? requeue : dismiss).mutateAsync({
        factoryId,
        itemId,
      });
    } catch (error) {
      setPending(null);
      const reason = readActionFailure(error, ws.errors.unknown).message;
      toast.error(
        kind === "requeued"
          ? s.journey.retryFailed(reason)
          : s.journey.dismissFailed(reason),
      );
      return;
    }
    await refetch();
    setPending(null);
  };

  return {
    pending,
    confirming,
    setConfirming,
    retry: () =>
      workflowOn === false ? void move("requeued") : setConfirming(true),
    confirmRetry: () => void move("requeued"),
    dismiss: () => void move("dismissed"),
  };
}

type JourneyRecovery = ReturnType<typeof useJourneyRecovery>;

/** The two ways back from "needs a person", and the question a retry asks while the workflow is on. */
export function JourneyRecoveryActions({
  recovery,
}: {
  recovery: JourneyRecovery;
}) {
  const s = useItemsStrings();
  const ws = useWorkflowStrings();

  return (
    <>
      <Button variant="outline" size="sm" onClick={recovery.retry}>
        <IconRefresh />
        {s.journey.retry}
      </Button>
      <Button variant="outline" size="sm" onClick={recovery.dismiss}>
        <IconCircleOff />
        {s.journey.dismiss}
      </Button>
      <AlertDialog
        open={recovery.confirming}
        onOpenChange={recovery.setConfirming}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{s.journey.retryDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {s.journey.retryDialogBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ws.liveRun.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={recovery.confirmRetry}>
              {s.journey.retry}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
