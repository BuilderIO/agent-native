import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  usePageTree,
  useCreateProject,
  useCreateFile,
  useDeleteProject,
  useUpdateProjectMeta,
} from "@/hooks/use-projects";
import {
  ChevronDown,
  FileText,
  FolderOpen,
  Folder,
  Plus,
  MoreHorizontal,
  Trash2,
  Lock,
  LockOpen,
  ArrowRightLeft,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { MovePageDialog } from "./MovePageDialog";
import { toast } from "sonner";
import type { Page } from "@shared/api";

interface PageTreeProps {
  workspace: string;
  activePageId: string | null;
  onSelectPage: (page: Page) => void;
  onNewPage: () => void;
}

export function PageTree({ workspace, activePageId, onSelectPage, onNewPage }: PageTreeProps) {
  const { data, isLoading } = usePageTree(workspace);
  const pages = data?.pages ?? [];

  // Build tree from flat parentId references
  const { rootPages, childMap } = useMemo(() => {
    const childMap = new Map<string | null, Page[]>();
    for (const page of pages) {
      const key = page.parentId;
      if (!childMap.has(key)) childMap.set(key, []);
      childMap.get(key)!.push(page);
    }
    return { rootPages: childMap.get(null) ?? [], childMap };
  }, [pages]);

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-sidebar-muted">Loading pages...</div>
    );
  }

  if (rootPages.length === 0) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-sidebar-muted">No pages yet.</p>
        <button
          onClick={onNewPage}
          className="mt-2 text-xs text-sidebar-primary hover:underline"
        >
          Create your first page
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 space-y-0.5">
      {rootPages.map((page) => (
        <PageNode
          key={page.id}
          page={page}
          depth={0}
          childMap={childMap}
          activePageId={activePageId}
          onSelectPage={onSelectPage}
          workspace={workspace}
        />
      ))}
    </div>
  );
}

function PageNode({
  page,
  depth,
  childMap,
  activePageId,
  onSelectPage,
  workspace,
}: {
  page: Page;
  depth: number;
  childMap: Map<string | null, Page[]>;
  activePageId: string | null;
  onSelectPage: (page: Page) => void;
  workspace: string;
}) {
  const children = childMap.get(page.id) ?? [];
  const isActive = activePageId === page.id;
  const [expanded, setExpanded] = useState(() => {
    // Auto-expand if active page is this node or a descendant
    if (isActive) return true;
    return isDescendantActive(page.id, activePageId, childMap);
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const deleteProject = useDeleteProject();
  const createFile = useCreateFile();
  const updateMeta = useUpdateProjectMeta();
  const paddingLeft = 8 + depth * 16;
  const isFolder = page.type === "folder";
  const hasChildren = page.hasChildren || children.length > 0;

  const handleClick = () => {
    if (isFolder) {
      setExpanded(!expanded);
    } else {
      onSelectPage(page);
      if (hasChildren && !expanded) {
        setExpanded(true);
      }
    }
  };

  const handleAddSubpage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!page._projectSlug) return;

    createFile.mutate(
      {
        projectSlug: page._projectSlug,
        name: "Untitled",
        type: "file",
        parentPath: page._filePath || undefined,
      },
      {
        onSuccess: (result) => {
          setExpanded(true);
          onSelectPage({
            ...page,
            id: `${page._projectSlug}::${result.path}`,
            title: "Untitled",
            _filePath: result.path,
          });
        },
        onError: (err) => toast.error(err.message || "Failed to create subpage"),
      }
    );
  };

  const handleDelete = () => {
    if (!page._projectSlug) return;

    if (page._filePath === null) {
      // Delete the entire project
      deleteProject.mutate(
        { slug: page._projectSlug },
        {
          onError: (err) => toast.error(err.message || "Failed to delete page"),
        }
      );
    }
    setConfirmDeleteOpen(false);
  };

  const handleTogglePrivacy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!page._projectSlug || page._filePath !== null) return;
    updateMeta.mutate({
      slug: page._projectSlug,
      isPrivate: !page.isPrivate,
      ownerId: "local",
    });
    setMenuOpen(false);
  };

  return (
    <div>
      <div
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        className={cn(
          "w-full flex items-center justify-between py-1 rounded-[4px] text-left group transition-colors cursor-pointer pr-1",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60"
        )}
        style={{ paddingLeft }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="shrink-0 p-0.5"
            >
              <ChevronDown
                size={12}
                className={cn(
                  "transition-transform duration-150",
                  !expanded && "-rotate-90"
                )}
              />
            </button>
          )}
          {!hasChildren && <span className="w-[16px] shrink-0" />}

          {isFolder ? (
            expanded ? (
              <FolderOpen size={14} className="text-sidebar-primary shrink-0" />
            ) : (
              <Folder size={14} className="text-sidebar-primary shrink-0" />
            )
          ) : (
            <FileText size={14} className="text-sidebar-muted shrink-0" />
          )}
          <span className="text-[13px] truncate">{page.title}</span>
          {page.isPrivate && (
            <Lock size={11} className="text-sidebar-muted shrink-0" />
          )}
        </div>

        {/* Hover actions */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0 ml-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Add subpage (only for project-level pages) */}
          {page._projectSlug && !isFolder && (
            <button
              onClick={handleAddSubpage}
              className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
              title="Add subpage"
            >
              <Plus size={13} />
            </button>
          )}

          {/* More menu (only for project-level pages, not subfiles) */}
          {page._projectSlug && page._filePath === null && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(true);
                  }}
                  className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
                  title="Page options"
                >
                  <MoreHorizontal size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setMoveOpen(true);
                  }}
                  className="gap-2"
                >
                  <ArrowRightLeft size={13} className="shrink-0" />
                  <span>Move to...</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleTogglePrivacy}
                  disabled={updateMeta.isPending}
                  className="gap-2"
                >
                  {page.isPrivate ? (
                    <>
                      <LockOpen size={13} className="shrink-0" />
                      <span>Make Public</span>
                    </>
                  ) : (
                    <>
                      <Lock size={13} className="shrink-0" />
                      <span>Make Private</span>
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 size={13} className="shrink-0" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Children */}
      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <PageNode
              key={child.id}
              page={child}
              depth={depth + 1}
              childMap={childMap}
              activePageId={activePageId}
              onSelectPage={onSelectPage}
              workspace={workspace}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{page.title}" and all its contents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteProject.isPending}
              >
                {deleteProject.isPending ? "Deleting..." : "Delete"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move dialog */}
      {page._projectSlug && page._filePath === null && (
        <MovePageDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          page={page}
          onMoved={(newSlug) => {
            onSelectPage({ ...page, id: newSlug, _projectSlug: newSlug });
          }}
        />
      )}
    </div>
  );
}

function isDescendantActive(
  pageId: string,
  activePageId: string | null,
  childMap: Map<string | null, Page[]>
): boolean {
  if (!activePageId) return false;
  const children = childMap.get(pageId);
  if (!children) return false;
  for (const child of children) {
    if (child.id === activePageId) return true;
    if (isDescendantActive(child.id, activePageId, childMap)) return true;
  }
  return false;
}
