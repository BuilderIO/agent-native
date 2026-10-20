import { useActionMutation } from "@agent-native/core/client/hooks";
import { PromptComposer } from "@agent-native/toolkit/composer";
import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  holdNewWorkflowRequest,
  minimalWorkflowGraph,
  workflowNameFromPrompt,
} from "./new-workflow";
import { readActionFailure } from "./workflow-errors";
import { useWorkflowStrings } from "./workflow-strings";
import type { SaveWorkflowResult } from "./workflow-types";

interface NewWorkflowDialogProps {
  factoryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new workflow's id once it is saved, so the page can open it. */
  onCreated: (workflowId: string) => void;
}

/**
 * Asks what the workflow should do, then creates a switched-off workflow and
 * opens it. A request goes to the canvas's agent, which builds the steps;
 * "Start from scratch" opens the blank canvas instead.
 */
export function NewWorkflowDialog({
  factoryId,
  open,
  onOpenChange,
  onCreated,
}: NewWorkflowDialogProps) {
  const ws = useWorkflowStrings();

  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useActionMutation<
    SaveWorkflowResult,
    { factoryId: string; name: string; graph: unknown; summary?: string }
  >("save-factory-workflow");

  useEffect(() => {
    if (!open) {
      setPrompt("");
      setError(null);
    }
  }, [open]);

  // A null request starts from scratch. The request is held only after the save succeeds, so a refused save sends nothing.
  function startWith(request: string | null) {
    if (create.isPending) return;
    setError(null);
    const name =
      request === null
        ? ws.newDialog.untitledName
        : workflowNameFromPrompt(request);
    create.mutate(
      { factoryId, name, graph: minimalWorkflowGraph() },
      {
        onSuccess: (result) => {
          if (request !== null) {
            holdNewWorkflowRequest(result.workflowId, request);
          }
          onOpenChange(false);
          onCreated(result.workflowId);
        },
        onError: (failure) => {
          const { message } = readActionFailure(failure, ws.errors.unknown);
          setError(ws.newDialog.createFailed(message));
        },
      },
    );
  }

  function submitPrompt(text: string) {
    const request = text.trim();
    if (request) startWith(request);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        closeLabel={ws.common.close}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{ws.newDialog.dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <PromptComposer
            autoFocus
            attachmentsEnabled={false}
            showModelSelector={false}
            voiceEnabled={false}
            // An empty fragment, not null: null brings back the composer's own send button. Enter still sends.
            actionButton={<></>}
            // Keeps the text when the save fails, so the request can be sent again without retyping.
            preserveDraftOnSubmit
            disabled={create.isPending}
            submitting={create.isPending}
            placeholder={ws.newDialog.promptPlaceholder}
            ariaLabel={ws.newDialog.promptPlaceholder}
            onTextChange={setPrompt}
            onSubmit={submitPrompt}
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={create.isPending}
            onClick={() => startWith(null)}
          >
            {ws.newDialog.startFromScratch}
          </Button>
          <Button
            type="button"
            disabled={!prompt.trim() || create.isPending}
            onClick={() => startWith(prompt.trim())}
          >
            {create.isPending ? <IconLoader2 className="animate-spin" /> : null}
            {ws.newDialog.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
