import { IconPlus, IconTrash, type Icon } from "@tabler/icons-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type SyntheticEvent,
} from "react";

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

/** Edge commands for the hover controls. The canvas provides them only when it can be edited. */
export interface EdgeActions {
  /** Puts a step on this connection, as the selected connection's toolbar does. */
  onInsertOnEdge: (edgeId: string) => void;
  /** Removes this one connection as a single undo step. */
  onRemoveEdge: (edgeId: string) => void;
}

/** Null on a read-only canvas, so no connection offers its hover controls. */
export const EdgeActionsContext = createContext<EdgeActions | null>(null);

/**
 * The controls render into the edge label layer, but React still bubbles their
 * events up the edge's component tree, where the edge selects itself on click.
 * Stopping them here leaves a click on a control to the control alone.
 */
function keepOnControls(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * The controls at a connection's midpoint: Add step, then Remove connection.
 * Add stays on the midpoint at rest and on hover, and Remove grows the toolbar
 * to its right. A loop cannot take a step, so it offers only removal, in the
 * place Add would take. Keyboard users reach the same commands from the
 * selected connection's toolbar.
 */
export function EdgeActionButtons({
  edgeId,
  insert,
  remove,
  onPointerEnter,
  onPointerLeave,
}: {
  edgeId: string;
  insert: boolean;
  remove: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const actions = useContext(EdgeActionsContext);
  const s = useWorkflowCanvasStrings();

  if (!actions) return null;
  return (
    <div
      role="toolbar"
      aria-label={s.edge.toolbarName}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={keepOnControls}
      onClick={keepOnControls}
      className="workflow-edge-actions flex items-center gap-2 rounded-lg bg-card p-2 ring-1 ring-border"
    >
      {insert && (
        <EdgeActionButton
          icon={IconPlus}
          label={s.toolbar.addStep}
          onClick={() => actions.onInsertOnEdge(edgeId)}
        />
      )}
      {remove && (
        <EdgeActionButton
          icon={IconTrash}
          label={s.edge.remove}
          onClick={() => actions.onRemoveEdge(edgeId)}
        />
      )}
    </div>
  );
}

function EdgeActionButton({
  icon: ButtonIcon,
  label,
  onClick,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={label}
          onClick={onClick}
        >
          <ButtonIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
