import { IconPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

import { useWorkflowCanvasStrings } from "./strings";

/**
 * What an empty canvas offers: a dashed tile that adds the first step, and a
 * link that asks the agent to build the workflow from a description.
 */
export function EmptyCanvasTile({
  onAddFirstStep,
  onDescribe,
}: {
  onAddFirstStep: () => void;
  onDescribe?: () => void;
}) {
  const s = useWorkflowCanvasStrings();

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant="outline"
        onClick={onAddFirstStep}
        className="h-32 w-64 flex-col gap-2 rounded-lg border-dashed bg-card shadow-none"
      >
        <IconPlus />
        {s.canvasActions.addFirstStep}
      </Button>
      {onDescribe && (
        <Button variant="link" size="sm" onClick={onDescribe}>
          {s.canvasActions.describeFirst}
        </Button>
      )}
    </div>
  );
}
