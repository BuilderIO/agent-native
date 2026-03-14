import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FolderOpen,
  Folder,
  Trash2,
  MoreHorizontal,
  Lock,
  LockOpen,
  ArrowRightLeft,
  ChevronDown,
  FileText,
} from "lucide-react";
import { useProjects, useUpdateProjectMeta } from "@/hooks/use-projects";
import { MoveProjectDialog } from "./MoveProjectDialog";
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
import { Button } from "@/components/ui/button";
import type { Project } from "@shared/api";

interface ProjectListProps {
  onSelectProject: (slug: string) => void;
  onDeleteProject: (slug: string) => void;
  pendingDeleteSlug?: string | null;
  activeProjectSlug: string | null;
  selectedOwner: string | null;
  sortMode?: "recent" | "alpha";
}

const getProjectOwner = (project: Project) =>
  project.group ||
  (project.slug.includes("/") ? project.slug.split("/")[0] : undefined);

interface FolderNode {
  name: string;
  path: string; // relative to workspace, e.g. "blog" or "social/campaigns"
  children: FolderNode[];
  projects: Project[];
}

function buildFolderTree(
  folders: string[],
  projects: Project[],
  sortMode: "recent" | "alpha",
): { rootProjects: Project[]; folderNodes: FolderNode[] } {
  // Projects without a folder go at root
  const rootProjects = projects.filter((p) => !p.folder);

  // Build folder hierarchy
  const nodeMap = new Map<string, FolderNode>();

  for (const folderPath of folders) {
    const segments = folderPath.split("/");
    let currentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const prevPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i];
      if (!nodeMap.has(currentPath)) {
        const node: FolderNode = {
          name: segments[i],
          path: currentPath,
          children: [],
          projects: [],
        };
        nodeMap.set(currentPath, node);
        // Attach to parent
        if (prevPath && nodeMap.has(prevPath)) {
          nodeMap.get(prevPath)!.children.push(node);
        }
      }
    }
  }

  // Assign projects to folders
  for (const project of projects) {
    if (project.folder && nodeMap.has(project.folder)) {
      nodeMap.get(project.folder)!.projects.push(project);
    }
  }

  // Sort projects within each folder
  const sortProjects = (list: Project[]) =>
    [...list].sort((a, b) => {
      if (sortMode === "alpha") return a.name.localeCompare(b.name);
      return (
        new Date(b.updatedAt || 0).getTime() -
        new Date(a.updatedAt || 0).getTime()
      );
    });

  for (const node of nodeMap.values()) {
    node.projects = sortProjects(node.projects);
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Get top-level folder nodes (no "/" in path)
  const topLevelFolders = Array.from(nodeMap.values()).filter(
    (n) => !n.path.includes("/"),
  );
  topLevelFolders.sort((a, b) => a.name.localeCompare(b.name));

  return {
    rootProjects: sortProjects(rootProjects),
    folderNodes: topLevelFolders,
  };
}

export function ProjectList({
  onSelectProject,
  onDeleteProject,
  pendingDeleteSlug,
  activeProjectSlug,
  selectedOwner,
  sortMode = "recent",
}: ProjectListProps) {
  const { data, isLoading } = useProjects();

  const { rootProjects, folderNodes } = useMemo(() => {
    const allProjects = data?.projects ?? [];
    const filtered = selectedOwner
      ? allProjects.filter((p) => getProjectOwner(p) === selectedOwner)
      : allProjects;

    const folders = (selectedOwner && data?.folders?.[selectedOwner]) || [];

    if (folders.length === 0) {
      // No folders - just sort and return all as root
      const sorted = [...filtered].sort((a, b) => {
        if (sortMode === "alpha") return a.name.localeCompare(b.name);
        return (
          new Date(b.updatedAt || 0).getTime() -
          new Date(a.updatedAt || 0).getTime()
        );
      });
      return { rootProjects: sorted, folderNodes: [] };
    }

    return buildFolderTree(folders, filtered, sortMode);
  }, [data?.projects, data?.folders, selectedOwner, sortMode]);

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-sidebar-muted">
        Loading projects...
      </div>
    );
  }

  if (!rootProjects.length && !folderNodes.length) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-sidebar-muted">No projects yet.</p>
      </div>
    );
  }

  return (
    <div className="px-2 space-y-0.5">
      {/* Folder nodes first */}
      {folderNodes.map((folder) => (
        <FolderTreeNode
          key={folder.path}
          node={folder}
          depth={0}
          activeProjectSlug={activeProjectSlug}
          onSelectProject={onSelectProject}
          onDeleteProject={onDeleteProject}
          pendingDeleteSlug={pendingDeleteSlug}
        />
      ))}
      {/* Root-level projects */}
      {rootProjects.map((project) => (
        <ProjectItem
          key={project.slug}
          project={project}
          isActive={activeProjectSlug === project.slug}
          onSelectProject={onSelectProject}
          onDeleteProject={onDeleteProject}
          pendingDeleteSlug={pendingDeleteSlug}
        />
      ))}
    </div>
  );
}

function FolderTreeNode({
  node,
  depth,
  activeProjectSlug,
  onSelectProject,
  onDeleteProject,
  pendingDeleteSlug,
}: {
  node: FolderNode;
  depth: number;
  activeProjectSlug: string | null;
  onSelectProject: (slug: string) => void;
  onDeleteProject: (slug: string) => void;
  pendingDeleteSlug?: string | null;
}) {
  // Auto-expand if active project is inside this folder
  const hasActiveChild = useMemo(() => {
    if (!activeProjectSlug) return false;
    const check = (n: FolderNode): boolean => {
      if (n.projects.some((p) => p.slug === activeProjectSlug)) return true;
      return n.children.some(check);
    };
    return check(node);
  }, [node, activeProjectSlug]);

  const [expanded, setExpanded] = useState(hasActiveChild);
  const paddingLeft = 8 + depth * 16;
  const formatName = (name: string) =>
    name
      .split("-")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full py-1 rounded-[4px] text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
        style={{ paddingLeft }}
      >
        <ChevronDown
          size={12}
          className={cn(
            "shrink-0 transition-transform duration-150",
            !expanded && "-rotate-90",
          )}
        />
        {expanded ? (
          <FolderOpen size={14} className="text-sidebar-primary shrink-0" />
        ) : (
          <Folder size={14} className="text-sidebar-primary shrink-0" />
        )}
        <span className="text-[13px] truncate">{formatName(node.name)}</span>
      </button>
      {expanded && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeProjectSlug={activeProjectSlug}
              onSelectProject={onSelectProject}
              onDeleteProject={onDeleteProject}
              pendingDeleteSlug={pendingDeleteSlug}
            />
          ))}
          {node.projects.map((project) => (
            <ProjectItem
              key={project.slug}
              project={project}
              isActive={activeProjectSlug === project.slug}
              onSelectProject={onSelectProject}
              onDeleteProject={onDeleteProject}
              pendingDeleteSlug={pendingDeleteSlug}
              depth={depth + 1}
            />
          ))}
          {node.children.length === 0 && node.projects.length === 0 && (
            <div
              className="text-xs text-sidebar-muted py-1"
              style={{ paddingLeft: paddingLeft + 28 }}
            >
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectItem({
  project,
  isActive,
  onSelectProject,
  onDeleteProject,
  pendingDeleteSlug,
  depth = 0,
}: {
  project: Project;
  isActive: boolean;
  onSelectProject: (slug: string) => void;
  onDeleteProject: (slug: string) => void;
  pendingDeleteSlug?: string | null;
  depth?: number;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const updateMeta = useUpdateProjectMeta();
  const isOwner = true;
  const isDeletePending = pendingDeleteSlug === project.slug;
  const paddingLeft = 8 + depth * 16;

  const handleTogglePrivacy = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateMeta.mutate({
      slug: project.slug,
      isPrivate: !project.isPrivate,
      ownerId: "local",
    });
    setMenuOpen(false);
  };

  return (
    <div
      onClick={() => onSelectProject(project.slug)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectProject(project.slug);
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(
        "w-full flex items-center justify-between py-1 rounded-[4px] text-left group transition-colors cursor-pointer pr-2",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60",
      )}
      style={{ paddingLeft: paddingLeft + 14 }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <FileText size={14} className="text-sidebar-muted shrink-0" />
        <span className="text-[13px] truncate">{project.name}</span>
        {project.isPrivate && (
          <span title="Private project">
            <Lock size={11} className="text-sidebar-muted shrink-0" />
          </span>
        )}
      </div>

      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0 ml-1"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(true);
              }}
              className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
              title="Project options"
            >
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
            onClick={(e) => e.stopPropagation()}
          >
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
            {isOwner && (
              <DropdownMenuItem
                onClick={handleTogglePrivacy}
                disabled={updateMeta.isPending}
                className="gap-2"
              >
                {project.isPrivate ? (
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
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-destructive focus:text-destructive"
              disabled={isDeletePending}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
            >
              <Trash2 size={13} className="shrink-0" />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{project.name}" and all its
              contents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteProject(project.slug);
                }}
                disabled={isDeletePending}
              >
                {isDeletePending ? "Deleting..." : "Delete"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MoveProjectDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        project={project}
        onMoved={(newSlug) => onSelectProject(newSlug)}
      />
    </div>
  );
}
