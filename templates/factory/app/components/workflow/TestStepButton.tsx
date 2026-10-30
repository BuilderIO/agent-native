import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconFlask, IconLoader2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WorkflowNode } from "@/lib/workflow-editor";

import type { NodeAudit } from "./items/read-types";
import {
  TEST_STEP_LOOKBACK_STEPS,
  stepNeedsItems,
  testSampleFor,
} from "./test-step";
import { useWorkflowStrings } from "./workflow-strings";

interface TestStepButtonProps {
  factoryId: string;
  workflowId: string;
  node: WorkflowNode;
  /** The step is in the workflow the server has: a step that is not has never run, and reading its audit is a 404. */
  onServer: boolean;
  dirty: boolean;
  /** A save or a run is starting. */
  busy: boolean;
  onTest: (nodeId: string, sampleItemIds: string[]) => void;
}

/**
 * Runs the one step on the items it last received, without side effects. A step
 * that takes items waits for a run of the whole workflow to have shown it some,
 * unless it reads nothing about an item and so runs once on its own.
 */
export function TestStepButton({
  factoryId,
  workflowId,
  node,
  onServer,
  dirty,
  busy,
  onTest,
}: TestStepButtonProps) {
  const ws = useWorkflowStrings();

  const needsItems = stepNeedsItems(node);
  // Only runs of the whole workflow are read: a test run has no upstream steps, so it records no items going in.
  // The sample is the newest of the latest runs that gave the step items, not just the newest run.
  const read = (mode: "dry" | "live") => ({
    factoryId,
    workflowId,
    nodeId: node.id,
    mode,
    limit: TEST_STEP_LOOKBACK_STEPS,
    sampleStepWithItems: true,
  });
  const enabled = needsItems && onServer;
  const dry = useActionQuery<NodeAudit>(
    "get-workflow-node-audit",
    read("dry"),
    {
      enabled,
    },
  );
  const live = useActionQuery<NodeAudit>(
    "get-workflow-node-audit",
    read("live"),
    { enabled },
  );

  const { itemIds: sampleItemIds, fromOlderRun } = testSampleFor([
    dry.data,
    live.data,
  ]);
  const waiting = needsItems && sampleItemIds.length === 0;
  const reading = waiting && (dry.isLoading || live.isLoading);
  let blocked: string | null = null;
  if (waiting && !reading) {
    // A failed read is not "no items yet": say which it is.
    blocked =
      dry.isError || live.isError
        ? ws.nodePanel.testStepSamplesFailed
        : ws.nodePanel.testStepNeedsRun;
  }

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full"
      disabled={busy || reading || blocked !== null}
      onClick={() => onTest(node.id, sampleItemIds)}
    >
      {busy ? <IconLoader2 className="animate-spin" /> : <IconFlask />}
      {dirty ? ws.nodePanel.saveAndTestStep : ws.nodePanel.testStep}
    </Button>
  );
  const note =
    blocked ?? (fromOlderRun ? ws.nodePanel.testStepOlderSample : null);
  if (note === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button takes no hover, so the span carries the tooltip. */}
        <span tabIndex={0} className="block rounded-md">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  );
}
