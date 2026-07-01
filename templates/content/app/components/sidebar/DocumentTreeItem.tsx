import { useT } from "@agent-native/core/client";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DocumentTreeNode } from "@shared/api";
import {
  IconChevronRight,
  IconDatabase,
  IconFolder,
  IconFileText,
  IconPlus,
  IconStar,
  IconTrash,
  IconDots,
} from "@tabler/icons-react";
import { useState } from "react";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DocumentTreeItemProps {
  node: DocumentTreeNode;
  depth: number;
  sidebarWidth?: number;
  activeId: string | null;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onSelect: (id: string) => void;
  onCreateChildPage: (parentId: string) => void;
  onCreateChildDatabase: (parentId: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
}

export function getDocumentSidebarIconKind(
  document: Pick<DocumentTreeNode, "icon" | "database" | "source">,
) {
  if (
    document.source?.mode === "local-files" &&
    document.source.kind === "folder"
  ) {
    return "folder";
  }
  if (document.icon?.trim()) return "custom";
  if (document.database) return "database";
  return "page";
}

export function DocumentSidebarIcon({
  document,
}: {
  document: Pick<DocumentTreeNode, "icon" | "database" | "source">;
}) {
  const iconKind = getDocumentSidebarIconKind(document);

  if (iconKind === "custom") return <>{document.icon}</>;
  if (iconKind === "database") {
    return <IconDatabase size={14} className="text-muted-foreground" />;
  }
  if (iconKind === "folder") {
    return <IconFolder size={14} className="text-muted-foreground" />;
  }
  return <IconFileText size={14} className="text-muted-foreground" />;
}

export function DocumentTreeItem({
  node,
  depth,
  sidebarWidth,
  activeId,
  expandedIds,
  onToggleExpanded,
  onSelect,
  onCreateChildPage,
  onCreateChildDatabase,
  onDelete,
  onToggleFavorite,
}: DocumentTreeItemProps) {
  const t = useT();
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = node.id === activeId;
  const isLocalFileNode = node.source?.mode === "local-files";
  const isLocalFolder = isLocalFileNode && node.source?.kind === "folder";
  const canEdit = node.canEdit !== false;
  const canManage =
    node.canManage === true ||
    node.accessRole === "owner" ||
    node.accessRole === "admin";
  const hasMenuActions = canEdit || canManage;
  const canCreateChild = canEdit && !isLocalFileNode;
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
    disabled: !canEdit || isLocalFileNode,
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
        {...(isLocalFileNode ? {} : attributes)}
        {...(isLocalFileNode ? {} : listeners)}
        aria-label={node.title || "Untitled"}
        className={cn(
          "group relative flex min-w-56 items-center gap-1.5 rounded-md border-l-2 py-[5px] pe-2 text-sm cursor-pointer select-none",
          canEdit && !isLocalFileNode && "cursor-grab active:cursor-grabbing",
          isDragging && "bg-accent/70 text-accent-foreground shadow-sm",
          isActive
            ? "border-primary bg-accent text-accent-foreground font-medium shadow-sm"
            : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        style={{
          paddingInlineStart: `${indent}px`,
          width: rowWidth === undefined ? undefined : `${rowWidth}px`,
        }}
        onClick={() => {
          if (isLocalFolder && hasChildren) {
            onToggleExpanded(node.id);
            return;
          }
          onSelect(node.id);
        }}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <span className="relative flex-shrink-0 w-5 h-5">
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center text-center",
              hasChildren && "group-hover:opacity-0",
              hasChildren && (expanded || isActive) && "opacity-0",
            )}
          >
            <DocumentSidebarIcon document={node} />
          </span>
          {hasChildren && (
            <button
              type="button"
              aria-label={
                expanded
                  ? `Collapse ${node.title || "Untitled"}`
                  : `Expand ${node.title || "Untitled"}`
              }
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded hover:bg-accent opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
                (expanded || isActive) && "opacity-100 pointer-events-auto",
              )}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded(node.id);
              }}
            >
              <IconChevronRight
                size={14}
                className={cn(
                  "transition-transform",
                  expanded && "rotate-90",
                  "rtl:-scale-x-100",
                )}
              />
            </button>
          )}
        </span>

        <span className="min-w-0 flex-1 truncate">
          {node.title || "Untitled"}
        </span>

        <div
          className={cn(
            "pointer-events-none absolute right-1 top-1/2 flex flex-shrink-0 -translate-y-1/2 items-center gap-0.5 rounded-md pl-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
            "bg-accent text-foreground",
            isActive && "text-accent-foreground",
          )}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {hasMenuActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-current hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`More actions for ${node.title || "Untitled"}`}
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
                      className={cn("me-2", node.isFavorite && "fill-current")}
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
                    <IconTrash size={14} className="me-2" />
                    {t("database.delete")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {canCreateChild && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded text-current hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("sidebar.addChildTo", {
                        title: node.title || t("sidebar.untitled"),
                      })}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconPlus size={14} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("sidebar.addChild")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateChildPage(node.id);
                  }}
                >
                  <IconFileText className="me-2 size-4" />
                  {t("sidebar.page")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateChildDatabase(node.id);
                  }}
                >
                  <IconDatabase className="me-2 size-4" />
                  {t("sidebar.database")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              onCreateChildPage={onCreateChildPage}
              onCreateChildDatabase={onCreateChildDatabase}
              onDelete={onDelete}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </SortableContext>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sidebar.deletePageQuestion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.deletePageDescription", {
                title: node.title || t("sidebar.untitled"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("comments.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDelete(node.id)}
            >
              {t("database.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
