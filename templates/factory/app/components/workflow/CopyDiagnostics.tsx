import { callAction } from "@agent-native/core/client/hooks";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { readActionFailure } from "./workflow-errors";
import { useWorkflowStrings } from "./workflow-strings";

interface CopyDiagnostics {
  /** Reads the bundle and copies it; opens the manual dialog when the clipboard is blocked. */
  copy: () => void;
  pending: boolean;
  /** Render once, outside any menu: a dialog inside a menu closes with it. */
  dialog: ReactNode;
}

/**
 * One block of text to send back when something fails: the
 * `get-workflow-diagnostics` bundle, as JSON, on the clipboard. A blocked
 * clipboard (an insecure page, a browser that wants a fresh click) opens a
 * dialog with the same text to copy by hand; a failed read is a toast with the
 * action's own error, never an empty copy.
 */
export function useCopyDiagnostics(target: {
  factoryId: string;
  workflowId?: string;
}): CopyDiagnostics {
  const ws = useWorkflowStrings();
  const [pending, setPending] = useState(false);
  const [manualText, setManualText] = useState<string | null>(null);
  const { factoryId, workflowId } = target;

  const copy = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      const bundle = await callAction<Record<string, unknown>>(
        "get-workflow-diagnostics",
        { factoryId, ...(workflowId === undefined ? {} : { workflowId }) },
        { method: "GET" },
      );
      const text = JSON.stringify(bundle, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        toast.success(ws.diagnostics.copied);
      } catch {
        setManualText(text);
      }
    } catch (error) {
      const failure = readActionFailure(error, ws.errors.unknown);
      toast.error(
        ws.diagnostics.failed(
          failure.errorCode
            ? `${failure.errorCode}: ${failure.message}`
            : failure.message,
        ),
      );
    } finally {
      setPending(false);
    }
  }, [factoryId, workflowId, pending, ws]);

  const dialog = (
    <Dialog
      open={manualText !== null}
      onOpenChange={(open) => {
        if (!open) setManualText(null);
      }}
    >
      <DialogContent
        className="max-w-2xl"
        closeLabel={ws.common.close}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{ws.diagnostics.copy}</DialogTitle>
        </DialogHeader>
        <Textarea
          readOnly
          autoFocus
          aria-label={ws.diagnostics.copy}
          value={manualText ?? ""}
          onFocus={(event) => event.currentTarget.select()}
          className="h-80 resize-none font-mono text-xs"
          spellCheck={false}
        />
      </DialogContent>
    </Dialog>
  );

  return { copy: () => void copy(), pending, dialog };
}
