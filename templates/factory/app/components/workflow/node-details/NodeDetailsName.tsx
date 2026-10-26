import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { useWorkflowCanvasStrings } from "@/components/workflow-canvas/strings";
import type { WorkflowEditor, WorkflowNode } from "@/lib/workflow-editor";

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
}: {
  editor: WorkflowEditor;
  node: WorkflowNode;
  /** What the canvas shows for the step: its label, else its derived title. */
  title: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const s = useWorkflowCanvasStrings();
  const [draft, setDraft] = useState(title);
  // Escape reverts and leaves the field. That blur must not save what was typed.
  const reverting = useRef(false);

  // An undo, or an edit made elsewhere, can change the title; the field shows it.
  useEffect(() => {
    setDraft(title);
  }, [title]);

  const commit = (text: string) => {
    const next = text.trim();
    const label = next === "" ? null : next;
    if (label === (node.label ?? null)) {
      setDraft(title);
      return;
    }
    const outcome = editor.setNodeLabel(node.id, label);
    if (!outcome.ok) {
      setDraft(title);
      toast.error(s.rejection[outcome.rejection.code]);
    }
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
        if (reverting.current) {
          reverting.current = false;
          return;
        }
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") leaveField(event.currentTarget);
        if (event.key === "Escape") {
          reverting.current = true;
          setDraft(title);
          leaveField(event.currentTarget);
        }
      }}
    />
  );
}
