import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_MAX_ITERATIONS,
  LIMIT_REACHED_PORT,
  type Rejection,
  type WorkflowEditor,
  type WorkflowEdge,
} from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "./strings";

const MIN_PASSES = 1;
const MAX_PASSES = 25;

/** Loop controls for the selected connection, an insert action, and removing the connection. */
export function EdgeToolbar({
  editor,
  edge,
  onRejection,
  onInsert,
}: {
  editor: WorkflowEditor;
  edge: WorkflowEdge;
  onRejection: (rejection: Rejection) => void;
  /** Puts a step on this connection. Without it the toolbar has no insert button. */
  onInsert?: (edgeId: string) => void;
}) {
  const s = useWorkflowCanvasStrings();

  const passes = edge.back?.maxIterations;
  const [draft, setDraft] = useState(
    passes === undefined ? "" : String(passes),
  );
  useEffect(() => {
    setDraft(passes === undefined ? "" : String(passes));
  }, [passes, edge.id]);

  const parsed = Number(draft);
  const valid =
    Number.isInteger(parsed) && parsed >= MIN_PASSES && parsed <= MAX_PASSES;

  const report = (outcome: { ok: boolean; rejection?: Rejection }) => {
    if (!outcome.ok && outcome.rejection) onRejection(outcome.rejection);
  };

  return (
    <div
      role="toolbar"
      aria-label={s.edge.toolbarName}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Switch
          id={`edge-loop-${edge.id}`}
          checked={passes !== undefined}
          disabled={edge.from.port === LIMIT_REACHED_PORT}
          onCheckedChange={(checked) =>
            report(
              editor.setBackEdge(
                edge.id,
                checked ? { maxIterations: DEFAULT_MAX_ITERATIONS } : null,
              ),
            )
          }
        />
        <Label htmlFor={`edge-loop-${edge.id}`}>
          <span className="font-normal">{s.edge.loop}</span>
        </Label>
      </div>
      {passes !== undefined && (
        <div className="flex items-center gap-2">
          <Label htmlFor={`edge-passes-${edge.id}`}>
            <span className="font-normal text-muted-foreground">
              {s.edge.passes}
            </span>
          </Label>
          <Input
            id={`edge-passes-${edge.id}`}
            type="number"
            inputMode="numeric"
            min={MIN_PASSES}
            max={MAX_PASSES}
            value={draft}
            aria-invalid={!valid}
            className="h-8 w-16"
            onChange={(event) => {
              setDraft(event.target.value);
              const next = Number(event.target.value);
              if (
                Number.isInteger(next) &&
                next >= MIN_PASSES &&
                next <= MAX_PASSES
              ) {
                report(editor.setBackEdge(edge.id, { maxIterations: next }));
              }
            }}
          />
        </div>
      )}
      {onInsert && edge.back === undefined && (
        <Button variant="ghost" size="sm" onClick={() => onInsert(edge.id)}>
          <IconPlus />
          {s.creator.insertOnEdge}
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={s.edge.remove}
            onClick={() => report(editor.disconnect(edge.id))}
          >
            <IconTrash />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{s.edge.remove}</TooltipContent>
      </Tooltip>
    </div>
  );
}
