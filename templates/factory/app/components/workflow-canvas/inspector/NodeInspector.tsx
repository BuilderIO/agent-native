import { useMemo } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkflowEditor, WorkflowNode } from "@/lib/workflow-editor";

import { IssueMark } from "../IssueMark";
import { useWorkflowCanvasStrings } from "../strings";
import { useEditorSnapshot } from "../use-workflow-editor";
import { buildFormContext, type FormContext } from "./context";
import { AiForm } from "./forms/AiForm";
import { CombineForm } from "./forms/CombineForm";
import { EndForm } from "./forms/EndForm";
import { FilterForm } from "./forms/FilterForm";
import { ActionForm, AgentForm, LookupForm } from "./forms/OperationNodeForm";
import { SourceForm } from "./forms/SourceForm";
import { SplitForm } from "./forms/SplitForm";
import { SwitchForm } from "./forms/SwitchForm";
import { TriggerForm } from "./forms/TriggerForm";
import { WaitForm } from "./forms/WaitForm";
import { QuietMarks, useQuietMarks } from "./issue-marks";
import { useSettingsDraft } from "./use-settings-draft";

function SettingsForm({
  editor,
  node,
  context,
}: {
  editor: WorkflowEditor;
  node: WorkflowNode;
  context: FormContext;
}) {
  const quiet = useQuietMarks();
  const { settings, issues, update } = useSettingsDraft(editor, node);
  // The draft holds this node's own kind of settings, so each branch below can
  // hand it to the form for that kind; the union cannot say so on its own.
  const props = {
    settings: settings as never,
    onChange: update as never,
    context,
  };
  let form;
  switch (node.kind) {
    case "trigger":
      form = <TriggerForm {...props} />;
      break;
    case "source":
      form = <SourceForm {...props} />;
      break;
    case "lookup":
      form = <LookupForm {...props} />;
      break;
    case "action":
      form = <ActionForm {...props} />;
      break;
    case "filter":
      form = <FilterForm {...props} />;
      break;
    case "switch":
      form = <SwitchForm {...props} />;
      break;
    case "combine":
      form = <CombineForm {...props} />;
      break;
    case "split":
      form = <SplitForm {...props} />;
      break;
    case "ai":
      form = <AiForm {...props} />;
      break;
    case "agent":
      form = <AgentForm {...props} />;
      break;
    case "wait":
      form = <WaitForm {...props} />;
      break;
    case "end":
      form = <EndForm {...props} />;
      break;
  }
  return (
    <>
      {form}
      {!quiet && issues.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 text-xs text-destructive"
        >
          {issues.map((issue, index) => (
            <li key={`${index}:${issue.message}`}>
              {issue.path.length > 0 && (
                <span className="font-mono">{issue.path.join(".")}: </span>
              )}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export interface NodeInspectorProps {
  editor: WorkflowEditor;
  node: WorkflowNode;
  /** Holds the issue marks back while the step is opened for the first time after it was added. */
  quiet?: boolean;
}

/**
 * The parameters of one step: a form built for its kind from the contract and
 * its operation's declared fields. The step details modal shows it on the
 * Parameters tab, under its own header.
 */
export function NodeInspector({
  editor,
  node,
  quiet = false,
}: NodeInspectorProps) {
  const s = useWorkflowCanvasStrings();

  const { graph } = useEditorSnapshot(editor);
  const issues = editor.validate().byNode[node.id] ?? [];
  const context = useMemo(
    () => buildFormContext(graph, node, editor.catalog),
    [graph, node, editor.catalog],
  );
  return (
    <QuietMarks value={quiet}>
      <ScrollArea className="min-h-0 flex-1">
        <fieldset className="flex min-w-0 flex-col gap-4 p-4">
          <SettingsForm editor={editor} node={node} context={context} />
          {!quiet && issues.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <IssueMark issues={issues} />
              <span>{s.inspector.problemsHeading}</span>
            </div>
          )}
        </fieldset>
      </ScrollArea>
    </QuietMarks>
  );
}
