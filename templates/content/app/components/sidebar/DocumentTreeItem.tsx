import { useState } from "react";
import {
  IconChevronRight,
  IconFileText,
  IconPlus,
  IconStar,
  IconTrash,
  IconDots,
} from "@tabler/icons-react";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { DocumentTreeNode } from "@shared/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DocumentTreeItemProps {
  node: DocumentTreeNode;
  depth: number;
  sidebarWidth?: number;
  activeId: string | null;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
}

export function DocumentTreeItem({
  node,
  depth,
  sidebarWidth,
  activeId,
  expandedIds,
  onToggleExpanded,
  onSelect,
  onCreateChild,
  onDelete,
  onToggleFavorite,
}: DocumentTreeItemProps) {
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = node.id === activeId;
  const canEdit = node.canEdit !== false;
  const canManage =
    node.canManage === true ||
    node.accessRole === "owner" ||
    node.accessRole === "admin";
  const hasMenuActions = canEdit || canManage;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const indent = depth * 12 + 12;
  const rowWidth =
    sidebarWidth === undefined
      ? undefined
      : Math.max(224, sidebarWidth - 8 + depth * 12);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn("relative", isDragging && "z-10")}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div
        {...attributes}
        {...listeners}
        aria-label={node.title || "Untitled"}
        className={cn(
          "group relative flex min-w-56 items-center gap-1.5 rounded-md py-[5px] pr-2 text-sm cursor-pointer select-none",
          canEdit && "cursor-grab active:cursor-grabbing",
          isDragging && "bg-accent/70 text-accent-foreground shadow-sm",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        style={{
          paddingLeft: `${indent}px`,
          width: rowWidth === undefined ? undefined : `${rowWidth}px`,
        }}
        onClick={() => onSelect(node.id)}
      >
        <span className="relative flex-shrink-0 w-5 h-5">
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center text-center",
              hasChildren && "group-hover:opacity-0",
            )}
          >
            {node.icon || (
              <IconFileText size={14} className="text-muted-foreground" />
            )}
          </span>
          {hasChildren && (
            <button
              className="absolute inset-0 flex items-center justify-center rounded hover:bg-accent opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded(node.id);
              }}
            >
              <IconChevronRight
                size={14}
                className={cn("transition-transform", expanded && "rotate-90")}
              />
            </button>
          )}
        </span>

        <span className="min-w-0 flex-1 truncate">
          {node.title || "Untitled"}
        </span>

        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 bg-inherit"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {hasMenuActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent"
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconDots size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {canEdit && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(node.id, !node.isFavorite);
                    }}
                  >
                    <IconStar
                      size={14}
                      className={cn("mr-2", node.isFavorite && "fill-current")}
                    />
                    {node.isFavorite
                      ? "Remove from favorites"
                      : "Add to favorites"}
                  </DropdownMenuItem>
                )}
                {canEdit && canManage && <DropdownMenuSeparator />}
                {canManage && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <IconTrash size={14} className="mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {canEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateChild(node.id);
                  }}
                >
                  <IconPlus size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add sub-page</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <SortableContext
          items={node.children.map((child) => child.id)}
          strategy={verticalListSortingStrategy}
        >
          {node.children.map((child) => (
            <DocumentTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              sidebarWidth={sidebarWidth}
              activeId={activeId}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </SortableContext>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{node.title || "Untitled"}&rdquo; and all its sub-pages
              will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDelete(node.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
