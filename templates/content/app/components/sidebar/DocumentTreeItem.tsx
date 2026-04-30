import { useState } from "react";
import {
  IconChevronRight,
  IconFileText,
  IconPlus,
  IconStar,
  IconTrash,
  IconDots,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { DocumentTreeNode } from "@shared/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

interface DocumentTreeItemProps {
  node: DocumentTreeNode;
  depth: number;
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <div>
      <div
        className={cn(
          "group relative flex items-center gap-1 px-2 py-[5px] rounded-md cursor-pointer text-sm",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          className={cn(
            "flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-accent",
            !hasChildren && "invisible",
          )}
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

        <span className="flex-shrink-0 w-5 text-center">
          {node.icon || (
            <IconFileText size={14} className="text-muted-foreground" />
          )}
        </span>

        <span className="flex-1 truncate group-hover:mr-[60px]">
          {node.title || "Untitled"}
        </span>

        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 bg-inherit">
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
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateChild(node.id);
                }}
              >
                <IconPlus size={14} className="mr-2" />
                Add sub-page
              </DropdownMenuItem>
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
                {node.isFavorite ? "Remove from favorites" : "Add to favorites"}
              </DropdownMenuItem>
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
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onCreateChild(node.id);
            }}
            title="Add sub-page"
          >
            <IconPlus size={14} />
          </button>
        </div>
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <DocumentTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
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
