import { useWorkflowStrings } from "@/components/workflow/workflow-strings";

import { useWorkflowCanvasStrings } from "./strings";

/** Which run the canvas shows, as a small muted pill. Renders nothing when no run is showing. */
export function RunModeBadge({
  mode,
}: {
  mode: "dry" | "test" | "live" | null;
}) {
  const s = useWorkflowCanvasStrings();
  const ws = useWorkflowStrings();
  if (mode === null) return null;
  const labels = {
    dry: ws.runKind.dry_run,
    test: ws.runKind.test,
    live: s.runMode.live,
  };
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-2 text-xs leading-none font-medium text-muted-foreground">
      {labels[mode]}
    </span>
  );
}
