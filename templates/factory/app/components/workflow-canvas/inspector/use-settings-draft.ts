import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SettingsIssue,
  WorkflowEditor,
  WorkflowNode,
  WorkflowNodeSettings,
} from "@/lib/workflow-editor";

/**
 * The settings a form is editing. Every change goes through the editor, which
 * parses the whole node: a value the schema refuses stays in the form with its
 * issues listed and never reaches the graph. Typing folds into one undo step.
 */
export function useSettingsDraft(editor: WorkflowEditor, node: WorkflowNode) {
  const [draft, setDraft] = useState<WorkflowNodeSettings>(node.settings);
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const committed = useRef(node.settings);

  // Undo, redo, or an agent edit changed the settings from outside the form.
  useEffect(() => {
    if (node.settings === committed.current) return;
    committed.current = node.settings;
    setDraft(node.settings);
    setIssues([]);
  }, [node.settings]);

  const update = useCallback(
    (next: WorkflowNodeSettings) => {
      setDraft(next);
      const result = editor.updateNodeSettings(node.id, next, {
        key: `settings:${node.id}`,
        windowMs: 1000,
      });
      if (result.ok) {
        committed.current = result.node.settings;
        setDraft(result.node.settings);
        setIssues([]);
      } else {
        setIssues(result.rejection.issues ?? []);
      }
    },
    [editor, node.id],
  );

  return { settings: draft, issues, update };
}
