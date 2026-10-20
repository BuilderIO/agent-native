import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconLoader2,
  type Icon,
} from "@tabler/icons-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useContext, useRef } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  NODE_WIDTH,
  type StepStatus,
  type WorkflowIssue,
} from "@/lib/workflow-editor";

import {
  TARGET_HANDLE,
  type PortView,
  type WorkflowFlowNode,
} from "./flow-model";
import { ConnectionMark, IssueMark } from "./IssueMark";
import { NODE_KIND_ICONS, kindTile, nodeProvider } from "./node-kinds";
import type { StepOverlay } from "./overlay";
import { PortPickerContext } from "./port-picker";
import { ProviderIcon } from "./provider-identity";
import { useWorkflowCanvasStrings } from "./strings";

const STATUS_ICONS: Record<StepStatus, Icon> = {
  running: IconLoader2,
  succeeded: IconCheck,
  failed: IconAlertCircle,
  skipped: IconCircleDashed,
  needs_check: IconAlertTriangle,
};

const STATUS_STYLES: Record<StepStatus, string> = {
  running: "bg-muted text-foreground",
  succeeded: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
  skipped: "text-muted-foreground",
  needs_check: "text-destructive ring-1 ring-inset ring-destructive/40",
};

/** A passing step shows only its mark; anything that needs a look says so in words. */
const QUIET_STATUSES: readonly StepStatus[] = ["succeeded", "skipped"];

function StatusChip({ step }: { step: StepOverlay }) {
  const s = useWorkflowCanvasStrings();

  const { status, error } = step;
  const StatusIcon = STATUS_ICONS[status];
  const quiet = QUIET_STATUSES.includes(status);
  const chip = (
    <span
      role="img"
      aria-label={
        error
          ? `${s.status[status]}. ${error.code}: ${error.message}`
          : s.status[status]
      }
      title={error ? undefined : s.status[status]}
      tabIndex={error ? 0 : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full text-xs font-medium leading-none",
        quiet ? "size-5 justify-center" : "px-1.5 py-0.5",
        error &&
          "nodrag outline-none focus-visible:ring-2 focus-visible:ring-ring",
        STATUS_STYLES[status],
      )}
    >
      <StatusIcon
        className={cn(
          quiet ? "size-3.5" : "size-3",
          status === "running" && "motion-safe:animate-spin",
        )}
        aria-hidden
      />
      {!quiet && s.status[status]}
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

/** How far a pointer may travel and still count as a click rather than the start of a connection. */
const CLICK_SLOP_PX = 4;

/**
 * An output. Dragging from it draws a connection; clicking one nothing leaves
 * yet opens the step picker for it.
 */
function OutputHandle({
  nodeId,
  port,
  label,
}: {
  nodeId: string;
  port: PortView;
  label: string;
}) {
  const openPicker = useContext(PortPickerContext);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  const shared = {
    id: port.id,
    className: "workflow-handle",
    "data-unconnected": !port.connected,
    "data-issue": port.issues.length > 0,
  };
  if (!openPicker || port.connected) {
    return <Handle type="source" position={Position.Right} {...shared} />;
  }
  const open = (handle: HTMLElement) =>
    openPicker({ node: nodeId, port: port.id }, handle);
  return (
    <Handle
      type="source"
      position={Position.Right}
      {...shared}
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      onPointerDown={(event) => {
        pressedAt.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        const from = pressedAt.current;
        pressedAt.current = null;
        // A drag that ends on the dot it started from clicks it too.
        if (
          from &&
          Math.hypot(event.clientX - from.x, event.clientY - from.y) >
            CLICK_SLOP_PX
        ) {
          return;
        }
        // Opening the picker is not selecting the step: its panel would take room from the canvas.
        event.stopPropagation();
        open(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        open(event.currentTarget);
      }}
    />
  );
}

function PortRow({ nodeId, port }: { nodeId: string; port: PortView }) {
  const s = useWorkflowCanvasStrings();

  const hasIssue = port.issues.length > 0;
  return (
    <li className="relative flex h-6 items-center justify-end gap-1.5 pr-4 pl-3 text-xs">
      <span
        className={cn(
          "truncate",
          hasIssue ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {port.label}
      </span>
      {port.count !== undefined && (
        <span className="min-w-4 text-right tabular-nums text-foreground">
          {port.count}
        </span>
      )}
      <OutputHandle
        nodeId={nodeId}
        port={port}
        label={s.palette.addAfterPort(port.label)}
      />
    </li>
  );
}

function portLabelFor(ports: PortView[]) {
  return (issue: WorkflowIssue) =>
    ports.find((port) => port.id === issue.port)?.label;
}

function WorkflowNodeCardImpl({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const s = useWorkflowCanvasStrings();

  const {
    node,
    subtitle,
    ports,
    showPortRows,
    issues,
    unconnected,
    step,
    state,
  } = data;
  const KindIcon = NODE_KIND_ICONS[node.kind];
  const provider = nodeProvider(node);
  const lone = !showPortRows ? ports[0] : undefined;
  return (
    <div
      style={{ width: NODE_WIDTH }}
      data-node-kind={node.kind}
      data-selected={selected}
      className={cn(
        "rounded-lg bg-card text-card-foreground shadow-sm ring-1 ring-inset transition-opacity",
        selected || state === "lit" ? "ring-2 ring-primary" : "ring-border",
        state === "dimmed" && "opacity-40",
      )}
    >
      <div className="relative flex h-14 items-center gap-2.5 px-3">
        {node.kind !== "trigger" && (
          <Handle
            type="target"
            position={Position.Left}
            id={TARGET_HANDLE}
            isConnectableStart={false}
            className="workflow-handle"
          />
        )}
        {provider ? (
          <ProviderIcon provider={provider} />
        ) : (
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md",
              kindTile(node.kind),
            )}
          >
            <KindIcon className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight">
            {node.name}
          </div>
          <div
            className="truncate text-xs text-muted-foreground"
            title={subtitle}
          >
            {subtitle}
          </div>
        </div>
        {step && <StatusChip step={step} />}
        <ConnectionMark providers={unconnected} />
        <IssueMark issues={issues} portLabel={portLabelFor(ports)} />
        {lone && (
          <OutputHandle
            nodeId={node.id}
            port={lone}
            label={s.toolbar.addStep}
          />
        )}
      </div>
      {showPortRows && (
        <ul className="pb-2">
          {ports.map((port) => (
            <PortRow key={port.id} nodeId={node.id} port={port} />
          ))}
        </ul>
      )}
    </div>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
