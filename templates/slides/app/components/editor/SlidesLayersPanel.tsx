import {
  IconCode,
  IconChevronDown,
  IconChevronRight,
  IconHash,
  IconPhoto,
  IconSearch,
  IconSquare,
  IconVectorBezier2,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { useState, type DragEvent, type ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";

export type SlidesLayerKind =
  | "code"
  | "container"
  | "image"
  | "shape"
  | "text"
  | "video"
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
  search: string;
  expand: string;
  collapse: string;
}

export interface SlidesLayersPanelProps {
  layers: SlidesLayerNode[];
  selectedIds: string[] | ReadonlySet<string>;
  onSelectLayer: (id: string, additive: boolean) => void;
  onHoverLayer?: (id: string) => void;
  onLeaveLayer?: (id: string) => void;
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

function filterLayers(
  nodes: SlidesLayerNode[],
  query: string,
): SlidesLayerNode[] {
  return nodes.flatMap((node) => {
    if (node.label.toLowerCase().includes(query)) return [node];
    const children = filterLayers(node.children ?? [], query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function dropPlacement(event: DragEvent<HTMLElement>): SlidesLayerPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  const position = (event.clientY - bounds.top) / bounds.height;
  return position < 0.3 ? "after" : position > 0.7 ? "before" : "inside";
}

// Tabler has no large/small "Aa" glyph; this is Lucide's a-large-small, which the Figma spec uses for text layers.
function TextLayerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16" />
      <path d="M15.697 14h5.606" />
      <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
      <path d="M3.304 13h6.392" />
    </svg>
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
      return <TextLayerIcon className={className} />;
    case "image":
      return <IconPhoto className={className} />;
    case "video":
      return <IconVideo className={className} />;
    case "vector":
      return <IconVectorBezier2 className={className} />;
    case "code":
      return <IconCode className={className} />;
    case "shape":
      return <IconSquare className={className} />;
    case "container":
      return <IconHash className={className} />;
    default:
      return hasChildren ? (
        <IconHash className={className} />
      ) : (
        <IconSquare className={className} />
      );
  }
}

function LayerRow({
  node,
  depth,
  selectedIds,
  onHoverLayer,
  onLeaveLayer,
  contextMenuContent,
  onContextMenuLayer,
  onContextMenuClose,
  labels,
  onSelectLayer,
  onMoveLayer,
  searching,
}: {
  node: SlidesLayerNode;
  depth: number;
  searching: boolean;
  selectedIds: string[] | ReadonlySet<string>;
  onHoverLayer?: SlidesLayersPanelProps["onHoverLayer"];
  onLeaveLayer?: SlidesLayersPanelProps["onLeaveLayer"];
  labels: SlidesLayersPanelLabels;
  onSelectLayer: SlidesLayersPanelProps["onSelectLayer"];
  contextMenuContent?: SlidesLayersPanelProps["contextMenuContent"];
  onContextMenuLayer?: SlidesLayersPanelProps["onContextMenuLayer"];
  onContextMenuClose?: SlidesLayersPanelProps["onContextMenuClose"];
  onMoveLayer: SlidesLayersPanelProps["onMoveLayer"];
}) {
  const [collapsedState, setExpanded] = useState(true);
  const expanded = searching || collapsedState;
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
      style={{ paddingLeft: 16 + depth * 24 }}
      data-layer-selection={selected ? "primary" : undefined}
      className={`group flex h-8 w-full items-center gap-2 pr-12 text-[11px] font-[450] leading-4 tracking-[0.055px] text-foreground ${selected ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-foreground"} ${dragging ? "opacity-50" : ""}`}
      onMouseEnter={() => onHoverLayer?.(node.id)}
      onMouseLeave={() => onLeaveLayer?.(node.id)}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {children.length ? (
        <button
          type="button"
          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={expanded ? labels.collapse : labels.expand}
          onClick={() => setExpanded(!collapsedState)}
        >
          {expanded ? (
            <IconChevronDown className="size-4" />
          ) : (
            <IconChevronRight className="size-4" />
          )}
        </button>
      ) : null}
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
              onHoverLayer={onHoverLayer}
              onLeaveLayer={onLeaveLayer}
              contextMenuContent={contextMenuContent}
              onContextMenuLayer={onContextMenuLayer}
              onContextMenuClose={onContextMenuClose}
              labels={labels}
              onSelectLayer={onSelectLayer}
              onMoveLayer={onMoveLayer}
              searching={searching}
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
  onHoverLayer,
  onLeaveLayer,
  contextMenuContent,
  onContextMenuLayer,
  onContextMenuClose,
  onSelectLayer,
  onMoveLayer,
  onClose,
  labels,
}: SlidesLayersPanelProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const needle = searching ? query.trim().toLowerCase() : "";
  const visibleLayers = needle ? filterLayers(layers, needle) : layers;

  return (
    <aside
      className="flex h-full w-full min-w-0 flex-col bg-background"
      aria-label={labels.title}
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-t border-border pl-4 pr-2">
        <h2 className="text-[11px] font-[550] leading-4 tracking-[0.055px] text-foreground">
          {labels.title}
        </h2>
        <div className="flex items-center">
          <button
            type="button"
            className={`flex size-[22px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground ${searching ? "bg-accent text-foreground" : ""}`}
            onClick={() => {
              setSearching((value) => !value);
              setQuery("");
            }}
            aria-label={labels.search}
            aria-pressed={searching}
          >
            <IconSearch className="size-3" />
          </button>
          <button
            type="button"
            className="flex size-[22px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label={labels.close}
          >
            <IconX className="size-3" />
          </button>
        </div>
      </header>
      {searching ? (
        <div className="shrink-0 px-2 pb-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className="h-7 text-[11px]"
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="w-full" role="tree" aria-label={labels.title}>
          {[...visibleLayers].reverse().map((node) => (
            <LayerRow
              key={node.id}
              node={node}
              depth={0}
              selectedIds={selectedIds}
              onHoverLayer={onHoverLayer}
              onLeaveLayer={onLeaveLayer}
              contextMenuContent={contextMenuContent}
              onContextMenuLayer={onContextMenuLayer}
              onContextMenuClose={onContextMenuClose}
              labels={labels}
              onSelectLayer={onSelectLayer}
              onMoveLayer={onMoveLayer}
              searching={needle !== ""}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

export default SlidesLayersPanel;
