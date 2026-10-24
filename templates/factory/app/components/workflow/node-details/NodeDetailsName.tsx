import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { useWorkflowCanvasStrings } from "@/components/workflow-canvas/strings";
import type { WorkflowEditor, WorkflowNode } from "@/lib/workflow-editor";

import { nameKeyAction } from "./name-field";

/**
 * Moves focus from a field to the modal around it. Focus left on the page body
 * would fall out of the modal's focus trap.
 */
export function leaveField(field: HTMLElement) {
  field.closest<HTMLElement>('[role="dialog"]')?.focus();
}

/**
 * The step's name in the details header. It edits the step's label, which is
 * free text. The identifier never changes, so nothing else needs rewriting.
 */
export function NodeDetailsName({
  editor,
  node,
  title,
  inputRef,
  onCommitAndClose,
}: {
  editor: WorkflowEditor;
  node: WorkflowNode;
  /** What the canvas shows for the step: its label, else its derived title. */
  title: string;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Set when the modal was opened only to rename: Enter commits the name, then calls this to close it. */
  onCommitAndClose?: () => void;
}) {
  const s = useWorkflowCanvasStrings();
  const [draft, setDraft] = useState(title);
  // Escape reverts and leaves the field, and Enter that closes the modal has already saved. The blur that
  // follows either must not save again.
  const settled = useRef(false);

  // An undo, or an edit made elsewhere, can change the title; the field shows it.
  useEffect(() => {
    setDraft(title);
  }, [title]);

  /** False when the editor refused the name: the field goes back to the title and says why. */
  const commit = (text: string): boolean => {
    const next = text.trim();
    const label = next === "" ? null : next;
    if (label === (node.label ?? null)) {
      setDraft(title);
      return true;
    }
    const outcome = editor.setNodeLabel(node.id, label);
    if (!outcome.ok) {
      setDraft(title);
      toast.error(s.rejection[outcome.rejection.code]);
      return false;
    }
    return true;
  };

  return (
    <Input
      ref={inputRef}
      value={draft}
      maxLength={64}
      aria-label={s.inspector.nameLabel}
      className="h-8 min-w-0 max-w-lg flex-1 border-transparent bg-transparent px-2 font-medium shadow-none hover:bg-muted focus-visible:bg-background"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (settled.current) {
          settled.current = false;
          return;
        }
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        const composing =
          event.nativeEvent.isComposing || event.keyCode === 229;
        switch (
          nameKeyAction(event.key, onCommitAndClose !== undefined, composing)
        ) {
          case "commit-and-close":
            if (commit(event.currentTarget.value)) {
              settled.current = true;
              onCommitAndClose?.();
            }
            break;
          case "leave":
            leaveField(event.currentTarget);
            break;
          case "revert":
            settled.current = true;
            setDraft(title);
            leaveField(event.currentTarget);
            break;
        }
      }}
    />
  );
}
