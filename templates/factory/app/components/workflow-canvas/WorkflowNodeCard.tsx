import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconPlus,
  type Icon,
} from "@tabler/icons-react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { memo, useContext, useEffect, type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { StepStatus, WorkflowIssue } from "@/lib/workflow-editor";

import {
  TARGET_HANDLE,
  type AddAfterHandler,
  type PortView,
  type WorkflowFlowNode,
} from "./flow-model";
import { ConnectionMark, IssueMark } from "./IssueMark";
import { NODE_KIND_ICONS, kindTile, nodeProvider } from "./node-kinds";
import type { StepOverlay } from "./overlay";
import { ParkedCountsContext } from "./parked-counts-context";
import { providerIdentity, providerTile } from "./provider-identity";
import { useWorkflowCanvasStrings } from "./strings";

/** Where a tile's one corner mark sits: 6 px in from the bottom-right corner. */
const CORNER_MARK = "absolute end-[6px] bottom-[6px]";

/** The statuses that draw a mark. Running, skipped and unrun steps draw none. */
const STATUS_MARKS: Partial<Record<StepStatus, { icon: Icon; tone: string }>> =
  {
    failed: { icon: IconAlertCircle, tone: "text-destructive" },
    needs_check: { icon: IconAlertTriangle, tone: "text-destructive" },
    succeeded: { icon: IconCheck, tone: "text-success" },
  };

/** A step's status as one 20 px mark. Anything that needs a look says why in its tooltip. */
function StatusMark({ step }: { step: StepOverlay }) {
  const s = useWorkflowCanvasStrings();

  const { status, error } = step;
  const mark = STATUS_MARKS[status];
  if (!mark) return null;
  const MarkIcon = mark.icon;
  const passes = step.passes ?? 1;
  const label =
    passes > 1
      ? `${s.status[status]}. ${s.passCount(passes)}`
      : s.status[status];
  const chip = (
    <span
      role="img"
      aria-label={error ? `${label}. ${error.code}: ${error.message}` : label}
      title={error ? undefined : label}
      tabIndex={error ? 0 : undefined}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full",
        error &&
          "nodrag outline-none focus-visible:ring-2 focus-visible:ring-ring",
        mark.tone,
      )}
    >
      <MarkIcon className="size-4" aria-hidden />
    </span>
  );
  if (!error) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-64">
        <span className="font-mono font-medium">{error.code}</span>{" "}
        {error.message}
      </TooltipContent>
    </Tooltip>
  );
}

/** The status mark in the tile's corner, with the pass count beside it when a loop ran the step more than once. */
function StatusCorner({ step }: { step: StepOverlay }) {
  if (!STATUS_MARKS[step.status]) return null;
  const passes = step.passes ?? 1;
  return (
    <span className={cn(CORNER_MARK, "flex items-center gap-1")}>
      {passes > 1 && (
        <span
          aria-hidden
          className="text-xs leading-none tabular-nums text-muted-foreground"
        >
          {passes}
        </span>
      )}
      <StatusMark step={step} />
    </span>
  );
}

function portLabelFor(ports: PortView[]) {
  return (issue: WorkflowIssue) =>
    ports.find((port) => port.id === issue.port)?.label;
}

/**
 * The tile's one corner mark. The first match wins: a failure, then a problem,
 * then a provider that is not connected, then success.
 */
function cornerMark({
  step,
  issues,
  ports,
  unconnected,
}: {
  step: StepOverlay | undefined;
  issues: WorkflowIssue[];
  ports: PortView[];
  unconnected: readonly string[];
}): ReactNode {
  if (step?.status === "failed" || step?.status === "needs_check") {
    return <StatusCorner step={step} />;
  }
  if (issues.length > 0) {
    return (
      <IssueMark
        issues={issues}
        portLabel={portLabelFor(ports)}
        className={CORNER_MARK}
      />
    );
  }
  if (unconnected.length > 0) {
    return <ConnectionMark providers={unconnected} className={CORNER_MARK} />;
  }
  if (step) return <StatusCorner step={step} />;
  return null;
}

/** A plus line is 46 px from a lone output, and 80 px from one with a label or with items in the run. */
const PLUS_LINE_PX = { plain: 46, long: 80 } as const;

/**
 * One output. The dot is only for dragging a connection. The label sits just
 * outside the tile, the run count follows it, and while nothing leaves the
 * output a plus line ends in a button that adds the next step after it. The
 * line is drawn before the dot so the dot covers its start.
 */
function OutputPort({
  nodeId,
  port,
  y,
  labelled,
  editable,
  onAddAfter,
}: {
  nodeId: string;
  port: PortView;
  /** Distance from the tile's top edge to this output. */
  y: number;
  labelled: boolean;
  editable: boolean;
  onAddAfter?: AddAfterHandler;
}) {
  const s = useWorkflowCanvasStrings();

  const hasIssue = port.issues.length > 0;
  const hasItems = (port.count ?? 0) > 0;
  const plus = editable && !port.connected;
  const lineLength =
    labelled || hasItems ? PLUS_LINE_PX.long : PLUS_LINE_PX.plain;
  return (
    <div className="workflow-port absolute left-full" style={{ top: y }}>
      {plus && (
        <span
          aria-hidden
          className={cn(
            "workflow-plus pointer-events-none absolute top-0 left-0 h-0.5 -translate-y-1/2 rounded-full",
            hasItems ? "bg-success" : "bg-muted-foreground/55",
          )}
          style={{ width: lineLength }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={port.id}
        className="workflow-handle"
        data-issue={hasIssue}
      />
      {labelled && (
        <span
          title={port.label}
          className={cn(
            "absolute top-0 left-3 max-w-24 -translate-y-1/2 truncate rounded-sm bg-background/85 text-xs leading-4",
            hasIssue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {port.label}
          {hasItems && (
            <span className="ms-1 tabular-nums text-foreground">
              {port.count}
            </span>
          )}
        </span>
      )}
      {!labelled && hasItems && !port.connected && (
        <span className="absolute bottom-1 left-2 text-xs leading-4 tabular-nums text-foreground">
          {port.count}
        </span>
      )}
      {plus && (
        <button
          type="button"
          aria-label={
            labelled ? s.palette.addAfterPort(port.label) : s.toolbar.addStep
          }
          onClick={(event) => {
            // Adding a step is not selecting the node it comes from.
            event.stopPropagation();
            onAddAfter?.(nodeId, port.id);
          }}
          className="workflow-plus nodrag absolute top-0 flex size-6 -translate-y-1/2 items-center justify-center rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: lineLength }}
        >
          <span className="flex size-5 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <IconPlus className="size-3" stroke={2} aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}

/** The ring around a tile: an arc that turns round the outline, or stays still under reduced motion. */
function TileRing({
  trigger,
  className,
}: {
  trigger: boolean;
  className: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -inset-[5px] border-2 border-transparent",
        trigger ? "rounded-l-[41px] rounded-r-[21px]" : "rounded-[21px]",
        className,
      )}
    />
  );
}

function WorkflowNodeCardImpl({
  id,
  data,
  selected,
}: NodeProps<WorkflowFlowNode>) {
  // React Flow re-measures a node when its size changes, not when an output
  // moves inside it (a lookup gaining a loop's limit output keeps its height),
  // so the handle layout is reported here.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleLayout = `${data.size.height}:${data.ports.map((port) => port.id).join("\n")}`;
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleLayout, updateNodeInternals]);

  const s = useWorkflowCanvasStrings();
  const parkedCounts = useContext(ParkedCountsContext);
  const {
    node,
    title,
    subtitle,
    size,
    ports,
    showPortRows,
    issues,
    unconnected,
    step,
    state,
    current,
    readOnly,
    onAddAfter,
  } = data;
  const KindIcon = NODE_KIND_ICONS[node.kind];
  const provider = nodeProvider(node);
  const identity = provider ? providerIdentity(provider) : null;
  const BrandIcon = identity?.icon ?? null;
  const trigger = node.kind === "trigger";
  const running = step?.status === "running";
  const failing = step?.status === "failed" || step?.status === "needs_check";
  const passed = step?.status === "succeeded";
  // Read for the whole workflow, not for the shown run: items wait at a Wait between runs too.
  const waiting = node.kind === "wait" ? (parkedCounts?.get(id) ?? 0) : 0;
  const tile = (provider && providerTile(provider)) || kindTile(node.kind);
  const ring =
    state === "lit"
      ? "ring-2 ring-primary"
      : selected
        ? "ring-[6px] ring-foreground/10"
        : undefined;
  const glyph = identity ? (
    BrandIcon ? (
      <BrandIcon className="size-12" />
    ) : (
      <span className="text-5xl leading-none font-semibold">
        {identity.letter}
      </span>
    )
  ) : (
    <KindIcon className="size-10" />
  );
  return (
    <div
      style={{ width: size.width, height: size.height }}
      data-node-kind={node.kind}
      data-selected={selected}
      className={cn(
        "relative flex items-center justify-center border-[1.5px] border-border shadow-sm transition-opacity",
        trigger ? "rounded-l-[36px] rounded-r-[16px]" : "rounded-[16px]",
        tile,
        failing && "border-2 border-destructive",
        passed && "border-2 border-success",
        running && "border-transparent",
        ring,
        state === "dimmed" && "opacity-40",
      )}
    >
      {trigger ? (
        <span
          aria-hidden
          className="absolute top-0 right-full flex h-full w-14 items-center justify-center text-primary"
        >
          <IconBolt className="size-6" fill="currentColor" />
        </span>
      ) : (
        <Handle
          type="target"
          position={Position.Left}
          id={TARGET_HANDLE}
          isConnectableStart={false}
          className="workflow-handle"
        />
      )}
      <span aria-hidden className="flex items-center justify-center">
        {glyph}
      </span>
      {/* One ring at a time: the run's ring wins over a Wait's. */}
      {current ? (
        <TileRing
          trigger={trigger}
          className="border-t-primary motion-safe:animate-[spin_1.5s_linear_infinite]"
        />
      ) : (
        waiting > 0 && (
          <TileRing
            trigger={trigger}
            className="border-t-muted-foreground motion-safe:animate-[spin_4.5s_linear_infinite]"
          />
        )
      )}
      {cornerMark({ step, issues, ports, unconnected })}
      {ports.map((port, index) => (
        <OutputPort
          key={port.id}
          nodeId={node.id}
          port={port}
          y={((index + 1) / (ports.length + 1)) * size.height}
          labelled={showPortRows}
          editable={!readOnly}
          onAddAfter={onAddAfter}
        />
      ))}
      <div className="pointer-events-none absolute top-full left-1/2 mt-2 w-48 -translate-x-1/2 text-center">
        <div className="line-clamp-2 text-sm leading-5 font-medium break-words">
          {title}
        </div>
        {subtitle && (
          <div className="mt-1 truncate text-xs leading-4 text-muted-foreground">
            {subtitle}
          </div>
        )}
        {waiting > 0 && (
          <span className="mt-1 inline-block rounded-full bg-muted px-2 text-xs leading-5 tabular-nums text-muted-foreground">
            {s.waiting(waiting)}
          </span>
        )}
      </div>
    </div>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
