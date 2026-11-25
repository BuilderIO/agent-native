import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog.js";
import { Button } from "../ui/button.js";
import { cn } from "../utils.js";

/**
 * Controls passed to an external undo surface such as a toast manager.
 */
export interface UndoAffordanceControls {
  undo: () => void;
  dismiss: () => void;
}

interface SafeDestructiveActionBaseProps {
  label?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  onConfirm: () => void | Promise<void>;
  onError?: (message: string, error: unknown) => void;
}

/**
 * Props for a reversible destructive action that executes immediately and
 * presents an undo affordance instead of a blocking confirmation modal.
 */
export interface ReversibleDestructiveActionProps extends SafeDestructiveActionBaseProps {
  reversible: true;
  onUndo: () => void | Promise<void>;
  undoMessage?: string;
  undoLabel?: string;
  undoDurationMs?: number;
  showInlineUndo?: boolean;
  onShowUndo?: (controls: UndoAffordanceControls) => void;
}

/**
 * Props for an irreversible destructive action guarded by an accessible
 * `AlertDialog` confirmation (never `window.confirm`).
 */
export interface IrreversibleDestructiveActionProps extends SafeDestructiveActionBaseProps {
  reversible?: false;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmText?: string;
}

/**
 * Discriminated props for `SafeDestructiveAction`.
 */
export type SafeDestructiveActionProps =
  | ReversibleDestructiveActionProps
  | IrreversibleDestructiveActionProps;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Action failed. Please try again.";
}

/**
 * Enforces safe destructive UX:
 * - `reversible: true` triggers immediately with an undo affordance.
 * - `reversible: false` (default) opens an accessible `AlertDialog` and never
 *   calls `window.confirm`.
 */
export function SafeDestructiveAction(
  props: SafeDestructiveActionProps,
): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [typedConfirm, setTypedConfirm] = React.useState("");
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [undoVisible, setUndoVisible] = React.useState(false);
  const undoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndoTimer = React.useCallback(() => {
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearUndoTimer, [clearUndoTimer]);

  const dismissUndo = React.useCallback(() => {
    clearUndoTimer();
    setUndoVisible(false);
  }, [clearUndoTimer]);

  const executeUndo = React.useCallback(async () => {
    if (props.reversible !== true) {
      return;
    }
    dismissUndo();
    setIsPending(true);
    try {
      await props.onUndo();
    } catch (error: unknown) {
      props.onError?.(toErrorMessage(error), error);
    } finally {
      setIsPending(false);
    }
  }, [dismissUndo, props]);

  const executeReversibleConfirm = React.useCallback(async () => {
    if (props.reversible !== true) {
      return;
    }
    setIsPending(true);
    try {
      await props.onConfirm();
      clearUndoTimer();
      setUndoVisible(true);
      const duration = props.undoDurationMs ?? 5000;
      if (duration > 0) {
        undoTimerRef.current = setTimeout(() => {
          setUndoVisible(false);
          undoTimerRef.current = null;
        }, duration);
      }
      props.onShowUndo?.({
        undo: () => {
          void executeUndo();
        },
        dismiss: dismissUndo,
      });
    } catch (error: unknown) {
      props.onError?.(toErrorMessage(error), error);
    } finally {
      setIsPending(false);
    }
  }, [clearUndoTimer, dismissUndo, executeUndo, props]);

  const executeIrreversibleConfirm = React.useCallback(async () => {
    setIsPending(true);
    setDialogError(null);
    try {
      await props.onConfirm();
      setTypedConfirm("");
      setDialogOpen(false);
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      setDialogError(message);
      props.onError?.(message, error);
    } finally {
      setIsPending(false);
    }
  }, [props]);

  const handleTriggerClick = () => {
    if (props.disabled || isPending) {
      return;
    }
    if (props.reversible === true) {
      void executeReversibleConfirm();
      return;
    }
    setDialogError(null);
    setTypedConfirm("");
    setDialogOpen(true);
  };

  const triggerLabel = props.label ?? "Delete";

  if (props.reversible === true) {
    const showInline = props.showInlineUndo ?? true;
    return (
      <div className={cn("inline-flex items-center gap-2", props.className)}>
        <Button
          type="button"
          variant="outline-destructive"
          size="sm"
          disabled={props.disabled || isPending}
          onClick={handleTriggerClick}
        >
          {props.children ?? triggerLabel}
        </Button>
        {undoVisible && showInline ? (
          <div
            role="status"
            aria-live="polite"
            data-craft-undo="true"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground shadow-xs"
          >
            <span>{props.undoMessage ?? "Item removed"}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isPending}
              onClick={() => {
                void executeUndo();
              }}
            >
              {props.undoLabel ?? "Undo"}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const requiresTypedMatch =
    props.confirmText !== undefined && props.confirmText.length > 0;
  const confirmDisabled =
    isPending || (requiresTypedMatch && typedConfirm !== props.confirmText);

  return (
    <>
      <Button
        type="button"
        variant="outline-destructive"
        size="sm"
        disabled={props.disabled || isPending}
        className={props.className}
        onClick={handleTriggerClick}
      >
        {props.children ?? triggerLabel}
      </Button>
      <AlertDialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isPending) {
            setDialogOpen(nextOpen);
            if (!nextOpen) {
              setTypedConfirm("");
              setDialogError(null);
            }
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {props.confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {requiresTypedMatch ? (
            <div className="space-y-1.5">
              <label
                htmlFor="craft-destructive-confirm-input"
                className="text-xs font-medium text-muted-foreground"
              >
                Type &ldquo;{props.confirmText}&rdquo; to confirm
              </label>
              <input
                id="craft-destructive-confirm-input"
                type="text"
                value={typedConfirm}
                onChange={(event) => {
                  setTypedConfirm(event.target.value);
                }}
                placeholder={props.confirmText}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          ) : null}
          {dialogError ? (
            <p role="alert" className="text-sm text-destructive">
              {dialogError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {props.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmDisabled}
              onClick={(event) => {
                event.preventDefault();
                void executeIrreversibleConfirm();
              }}
            >
              {props.confirmLabel ?? "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
