import { useRef } from "react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { ItemJourney } from "../ItemJourney";
import { useItemsStrings } from "../items-strings";
import type { ItemTarget, OpenWorkflow } from "./read-types";

/**
 * The item journey over the current view. The last item stays mounted while
 * the sheet slides out, so closing never flashes an empty panel.
 */
export function ItemJourneySheet({
  factoryId,
  target,
  onOpenChange,
  onOpenWorkflow,
}: {
  factoryId: string;
  target: ItemTarget | null;
  onOpenChange: (open: boolean) => void;
  onOpenWorkflow?: OpenWorkflow;
}) {
  const s = useItemsStrings();

  const last = useRef<ItemTarget | null>(null);
  if (target) last.current = target;
  const shown = target ?? last.current;
  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showClose={false}
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <SheetTitle className="sr-only">
          {s.items.sheetTitle(shown?.title ?? s.items.untitled)}
        </SheetTitle>
        {shown ? (
          <ItemJourney
            key={`${shown.workflowId}:${shown.itemId}`}
            factoryId={factoryId}
            workflowId={shown.workflowId}
            itemId={shown.itemId}
            onClose={() => onOpenChange(false)}
            onOpenWorkflow={
              onOpenWorkflow
                ? (workflowId, nodeId, openTarget) => {
                    onOpenChange(false);
                    onOpenWorkflow(workflowId, nodeId, openTarget);
                  }
                : undefined
            }
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
