import { useState, type RefObject } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StepOverlay } from "@/components/workflow-canvas";
import { NodeInspector } from "@/components/workflow-canvas/inspector/NodeInspector";
import type { WorkflowEditor, WorkflowNode } from "@/lib/workflow-editor";

import { NodeAuditPanel } from "../NodeAuditPanel";
import { TestStepButton } from "../TestStepButton";
import { openingTab } from "../workflow-run-overlay";
import { useWorkflowStrings } from "../workflow-strings";

/** The audit's first rows at their final size, while a queued run has no steps to read. */
function AuditPending() {
  return (
    <div className="space-y-5 px-4 py-4" aria-busy>
      <Skeleton className="h-5 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

type ParametersTab = "parameters" | "history";

const TRIGGER_CLASS =
  "h-8 rounded-md px-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-border";

/**
 * The middle column of the details modal: the step's parameters and its
 * history, with the test button at the end of the tab strip.
 */
export function NodeDetailsParameters({
  sectionRef,
  editor,
  factoryId,
  workflowId,
  node,
  title,
  quiet,
  onEngage,
  runId,
  runPending,
  steps,
  serverNodeIds,
  dirty,
  starting,
  onTestStep,
}: {
  sectionRef: RefObject<HTMLDivElement | null>;
  editor: WorkflowEditor;
  factoryId: string;
  workflowId: string;
  node: WorkflowNode;
  /** What the canvas calls the step: its label, else its derived title. */
  title: string;
  /** The issue marks wait until a field is left or a test starts. */
  quiet: boolean;
  /** A field was left, or a test started: the issue marks show. */
  onEngage: () => void;
  runId: string | null;
  /** The run is queued and has no steps to read yet. */
  runPending: boolean;
  /** What the open run did at each step, by node id. */
  steps: Readonly<Record<string, StepOverlay>> | undefined;
  /** The steps of the workflow the server has, which is not always the one on the canvas. */
  serverNodeIds: ReadonlySet<string>;
  dirty: boolean;
  /** A save or a run is starting. */
  starting: boolean;
  /** Resolves to whether the run started. */
  onTestStep: (nodeId: string, sampleItemIds: string[]) => Promise<boolean>;
}) {
  const ws = useWorkflowStrings();

  // A step whose run failed opens on its history. Another run can change that, so the tab follows it.
  const opening: ParametersTab =
    openingTab(steps?.[node.id]) === "audit" ? "history" : "parameters";
  const [tab, setTab] = useState<ParametersTab>(opening);
  const [basis, setBasis] = useState(opening);
  if (basis !== opening) {
    setBasis(opening);
    setTab(opening);
  }

  // The run's steps are what the history reads, so the tab opens once the run has started.
  const testStep = async (nodeId: string, sampleItemIds: string[]) => {
    onEngage();
    const started = await onTestStep(nodeId, sampleItemIds);
    if (started && editor.getSnapshot().selection.nodeIds[0] === nodeId) {
      setTab("history");
    }
  };

  return (
    <div
      ref={sectionRef}
      className="flex min-h-0 w-[420px] min-w-[368px] shrink flex-col border-e border-border"
    >
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setTab(value === "history" ? "history" : "parameters")
        }
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
          <TabsList
            aria-label={ws.nodePanel.tabsName}
            className="h-8 justify-start rounded-none bg-transparent p-0"
          >
            <TabsTrigger value="parameters" className={TRIGGER_CLASS}>
              {ws.nodeDetails.tabParameters}
            </TabsTrigger>
            <TabsTrigger value="history" className={TRIGGER_CLASS}>
              {ws.nodeDetails.tabHistory}
            </TabsTrigger>
          </TabsList>
          <div className="ms-auto">
            <TestStepButton
              factoryId={factoryId}
              workflowId={workflowId}
              node={node}
              onServer={serverNodeIds.has(node.id)}
              dirty={dirty}
              busy={starting}
              onTest={(nodeId, sampleItemIds) =>
                void testStep(nodeId, sampleItemIds)
              }
            />
          </div>
        </div>
        <TabsContent
          value="parameters"
          className="mt-0 flex min-h-0 flex-1 flex-col"
          onBlur={onEngage}
        >
          <NodeInspector editor={editor} node={node} quiet={quiet} />
        </TabsContent>
        <TabsContent
          value="history"
          className="mt-0 min-h-0 flex-1 overflow-y-auto"
        >
          {runPending ? (
            <AuditPending />
          ) : (
            <NodeAuditPanel
              factoryId={factoryId}
              workflowId={workflowId}
              nodeId={node.id}
              title={title}
              runId={runId ?? undefined}
              onClose={() => setTab("parameters")}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
