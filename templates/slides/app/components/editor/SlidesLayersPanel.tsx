import {
  IconArtboard,
  IconCode,
  IconChevronDown,
  IconChevronRight,
  IconPhoto,
  IconSquare,
  IconTypography,
  IconVectorBezier2,
  IconX,
} from "@tabler/icons-react";
import { useState, type DragEvent, type ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type SlidesLayerKind =
  | "code"
  | "container"
  | "image"
  | "shape"
  | "text"
  | "vector";

export interface SlidesLayerNode {
  id: string;
  label: string;
  kind?: SlidesLayerKind;
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
  contextMenuContent?: ReactNode;
  onContextMenuLayer?: (id: string) => void;
  onContextMenuClose?: () => void;
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
  // Design shows the last DOM sibling first, so visual before/after are the
  // opposite DOM placements consumed by SlideEditor.
  return position < 0.3 ? "after" : position > 0.7 ? "before" : "inside";
}

function LayerRowIndentSlots({
  depth,
  control,
}: {
  depth: number;
  control?: ReactNode;
}) {
  return (
    <span
      data-layer-row-indents
      className="flex h-full shrink-0"
      aria-hidden={control ? undefined : true}
    >
      {Array.from({ length: depth + 1 }, (_, index) => (
        <span
          key={index}
          data-layer-row-indent
          className={`flex size-4 shrink-0 items-center justify-center ${index < depth ? "mr-2" : ""}`}
        >
          {index === depth ? control : null}
        </span>
      ))}
    </span>
  );
}

function LayerGlyph({
  kind,
  hasChildren,
}: {
  kind?: SlidesLayerKind;
  hasChildren: boolean;
}) {
  const className = "size-4";
  switch (kind) {
    case "text":
      return <IconTypography className={className} />;
    case "image":
      return <IconPhoto className={className} />;
    case "vector":
      return <IconVectorBezier2 className={className} />;
    case "code":
      return <IconCode className={className} />;
    case "shape":
      return <IconSquare className={className} />;
    case "container":
      return <IconArtboard className={className} />;
    default:
      return hasChildren ? (
        <IconArtboard className={className} />
      ) : (
        <IconSquare className={className} />
      );
  }
}

function LayerRow({
  node,
  depth,
  selectedIds,
  contextMenuContent,
  onContextMenuLayer,
  onContextMenuClose,
  labels,
  onSelectLayer,
  onMoveLayer,
}: {
  node: SlidesLayerNode;
  depth: number;
  selectedIds: string[] | ReadonlySet<string>;
  labels: SlidesLayersPanelLabels;
  onSelectLayer: SlidesLayersPanelProps["onSelectLayer"];
  contextMenuContent?: SlidesLayersPanelProps["contextMenuContent"];
  onContextMenuLayer?: SlidesLayersPanelProps["onContextMenuLayer"];
  onContextMenuClose?: SlidesLayersPanelProps["onContextMenuClose"];
  onMoveLayer: SlidesLayersPanelProps["onMoveLayer"];
}) {
  const [expanded, setExpanded] = useState(true);
  const [dragging, setDragging] = useState(false);
  const children = node.children ?? [];
  const displayChildren = [...children].reverse();
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

  const rowContent = (
    <div
      data-layer-row-content
      data-layer-depth={depth}
      data-layer-selection={selected ? "primary" : undefined}
      className={`group flex h-8 w-max min-w-full items-center pr-1 text-[12px] text-foreground/90 transition-colors ${selected ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-foreground"} ${dragging ? "opacity-50" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <LayerRowIndentSlots
        depth={depth}
        control={
          children.length ? (
            <button
              type="button"
              className="flex size-4 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={expanded ? labels.collapse : labels.expand}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <IconChevronDown className="size-4" />
              ) : (
                <IconChevronRight className="size-4" />
              )}
            </button>
          ) : undefined
        }
      />
      <button
        type="button"
        data-layer-row-button
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={(event) =>
          onSelectLayer(
            node.id,
            event.metaKey || event.ctrlKey || event.shiftKey,
          )
        }
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <LayerGlyph kind={node.kind} hasChildren={children.length > 0} />
        </span>
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </button>
    </div>
  );

  const contextMenuRowContent =
    contextMenuContent && onContextMenuLayer ? (
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          onContextMenu={(event) => {
            event.stopPropagation();
            onContextMenuLayer(node.id);
          }}
        >
          {rowContent}
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={onContextMenuClose}>
          {contextMenuContent}
        </ContextMenuContent>
      </ContextMenu>
    ) : (
      rowContent
    );

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={children.length ? expanded : undefined}
      aria-selected={selected}
      data-layer-node-id={node.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", node.id);
        event.dataTransfer.effectAllowed = "move";
        event.stopPropagation();
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      {contextMenuRowContent}
      {expanded && children.length ? (
        <div role="group">
          {displayChildren.map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              contextMenuContent={contextMenuContent}
              onContextMenuLayer={onContextMenuLayer}
              onContextMenuClose={onContextMenuClose}
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
  contextMenuContent,
  onContextMenuLayer,
  onContextMenuClose,
  onSelectLayer,
  onMoveLayer,
  onClose,
  labels,
}: SlidesLayersPanelProps) {
  return (
    <aside
      className="flex h-full w-72 min-w-0 flex-col bg-background"
      aria-label={labels.title}
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">
          {labels.title}
        </h2>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          aria-label={labels.close}
        >
          <IconX className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
        <div
          className="w-max min-w-full px-2"
          role="tree"
          aria-label={labels.title}
        >
          {[...layers].reverse().map((node) => (
            <LayerRow
              key={node.id}
              node={node}
              depth={0}
              selectedIds={selectedIds}
              contextMenuContent={contextMenuContent}
              onContextMenuLayer={onContextMenuLayer}
              onContextMenuClose={onContextMenuClose}
              labels={labels}
              onSelectLayer={onSelectLayer}
              onMoveLayer={onMoveLayer}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

export default SlidesLayersPanel;
