import {
  IconChevronDown,
  IconChevronRight,
  IconGripVertical,
  IconLayersSubtract,
  IconX,
} from "@tabler/icons-react";
import { useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface SlidesLayerNode {
  id: string;
  label: string;
  children?: SlidesLayerNode[];
}

export type SlidesLayerPlacement = "before" | "after" | "inside";

export interface SlidesLayersPanelLabels {
  title: string;
  close: string;
  expand: string;
  collapse: string;
}

export interface SlidesLayersPanelProps {
  layers: SlidesLayerNode[];
  selectedIds: string[] | ReadonlySet<string>;
  onSelectLayer: (id: string, additive: boolean) => void;
  onMoveLayer: (
    sourceId: string,
    targetId: string,
    placement: SlidesLayerPlacement,
  ) => void;
  onClose: () => void;
  labels: SlidesLayersPanelLabels;
}

function dropPlacement(event: DragEvent<HTMLElement>): SlidesLayerPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  const position = (event.clientY - bounds.top) / bounds.height;
  return position < 0.3 ? "before" : position > 0.7 ? "after" : "inside";
}

function LayerRow({
  node,
  depth,
  selectedIds,
  labels,
  onSelectLayer,
  onMoveLayer,
}: {
  node: SlidesLayerNode;
  depth: number;
  selectedIds: string[] | ReadonlySet<string>;
  labels: SlidesLayersPanelLabels;
  onSelectLayer: SlidesLayersPanelProps["onSelectLayer"];
  onMoveLayer: SlidesLayersPanelProps["onMoveLayer"];
}) {
  const [expanded, setExpanded] = useState(true);
  const [dragging, setDragging] = useState(false);
  const children = node.children ?? [];
  const selected = Array.isArray(selectedIds)
    ? selectedIds.includes(node.id)
    : selectedIds.has(node.id);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain");
    if (sourceId && sourceId !== node.id) {
      onMoveLayer(sourceId, node.id, dropPlacement(event));
    }
    setDragging(false);
  };

  return (
    <div
      role="treeitem"
      aria-expanded={children.length ? expanded : undefined}
      aria-selected={selected}
    >
      <div
        className={`group flex min-h-9 items-center gap-1 rounded-md px-2 text-sm transition-colors ${selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"} ${dragging ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onDragOver={(event) => event.preventDefault()}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {children.length ? (
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={expanded ? labels.collapse : labels.expand}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <IconChevronDown size={15} />
            ) : (
              <IconChevronRight size={15} />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
          type="button"
          draggable
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", node.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragging(false)}
          onClick={(event) =>
            onSelectLayer(
              node.id,
              event.metaKey || event.ctrlKey || event.shiftKey,
            )
          }
        >
          <IconGripVertical
            size={15}
            className="shrink-0 text-muted-foreground/60"
            aria-hidden="true"
          />
          <span className="truncate">{node.label}</span>
        </button>
      </div>
      {expanded && children.length ? (
        <div role="group">
          {children.map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              labels={labels}
              onSelectLayer={onSelectLayer}
              onMoveLayer={onMoveLayer}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SlidesLayersPanel({
  layers,
  selectedIds,
  onSelectLayer,
  onMoveLayer,
  onClose,
  labels,
}: SlidesLayersPanelProps) {
  return (
    <aside
      className="flex h-full w-64 flex-col border-l border-border bg-background"
      aria-label={labels.title}
    >
      <header className="flex h-11 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <IconLayersSubtract size={16} aria-hidden="true" />
          {labels.title}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onClose}
              aria-label={labels.close}
            >
              <IconX size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{labels.close}</TooltipContent>
        </Tooltip>
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        role="tree"
        aria-label={labels.title}
      >
        {layers.map((node) => (
          <LayerRow
            key={node.id}
            node={node}
            depth={0}
            selectedIds={selectedIds}
            labels={labels}
            onSelectLayer={onSelectLayer}
            onMoveLayer={onMoveLayer}
          />
        ))}
      </div>
    </aside>
  );
}

export default SlidesLayersPanel;
