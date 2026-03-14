import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  useProjects,
  useDeleteProject,
  useCreateProjectGroup,
  useFileTree,
  SHARED_SLUG,
  workspaceSharedSlug,
} from "@/hooks/use-projects";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FolderOpen,
  Plus,
  Menu,
  X,
  ChevronLeft,
  ChevronDown,
  ImageIcon,
  PanelLeft,
  Compass,
  Film,
  MoreHorizontal,
  ArrowDownAZ,
  Clock,
  FileText,
  Newspaper,
  Lock,
  Search,
  Settings,
} from "lucide-react";
import { ProjectList } from "./ProjectList";
import { ProjectFileTree } from "./ProjectFileTree";
import { toast } from "sonner";
import { SharedResourceTree } from "./SharedResourceTree";
import { WorkspaceResourceTree } from "./WorkspaceResourceTree";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewFileDialog } from "./NewFileDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FeedbackButton } from "@/components/FeedbackButton";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

interface ActiveFile {
  projectSlug: string;
  filePath: string;
}

interface ProjectSidebarProps {
  activeFile: ActiveFile | null;
  activeProjectSlug: string | null;
  onSelectProject: (slug: string) => void;
  onSelectFile: (projectSlug: string, filePath: string) => void;
  onDeleteFile: (projectSlug: string, filePath: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  collapsed?: boolean;
  onExpandCollapsed?: () => void;
  onCollapse?: () => void;
  selectedOwner: string | null;
  onSelectOwner: (owner: string) => void;
  onOpenGlobalImages: () => void;
  isGlobalImagesActive: boolean;
  onOpenSearchResearch: () => void;
  isSearchResearchActive: boolean;
  onOpenProjectMedia: () => void;
  isProjectMediaActive: boolean;
  onOpenAllContent: () => void;
  isAllContentActive: boolean;
  onOpenSearch?: () => void;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 260;

export function ProjectSidebar({
  activeFile,
  activeProjectSlug,
  onSelectProject,
  onSelectFile,
  onDeleteFile,
  isOpen,
  onToggle,
  collapsed,
  onExpandCollapsed,
  onCollapse,
  selectedOwner,
  onSelectOwner,
  onOpenGlobalImages,
  isGlobalImagesActive,
  onOpenSearchResearch,
  isSearchResearchActive,
  onOpenProjectMedia,
  isProjectMediaActive,
  onOpenAllContent,
  isAllContentActive,
  onOpenSearch,
}: ProjectSidebarProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const { data: projectsData } = useProjects();
  const deleteProject = useDeleteProject();
  const pendingDeleteSlug = deleteProject.isPending
    ? deleteProject.variables?.slug ?? null
    : null;
  const [overrideShowAll, setOverrideShowAll] = useState(false);

  useEffect(() => {
    if (activeProjectSlug) {
      setOverrideShowAll(false);
    }
  }, [activeProjectSlug]);

  const activeProject = projectsData?.projects.find(
    (p) => p.slug === activeProjectSlug
  );
  const groups = projectsData?.groups ?? [];

  const handleBackToProjects = () => {
    setOverrideShowAll(true);
    onSelectProject("");
  };

  const handleSelectProject = (slug: string) => {
    setOverrideShowAll(false);
    onSelectProject(slug);
  };

  const handleDeleteProject = (slug: string) => {
    deleteProject.mutate(
      { slug },
      {
        onSuccess: () => {
          if (activeProjectSlug === slug) {
            onSelectProject("");
          }
        },
        onError: (error) => {
          toast.error(error.message || "Failed to delete project");
        },
      }
    );
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 sm:hidden"
          onClick={onToggle}
        />
      )}

      {/* Mobile open toggle (only when sidebar is closed) */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed top-3 left-3 z-50 sm:hidden p-2 rounded-lg bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Floating controls when collapsed */}
      {collapsed && (
        <div className="fixed bottom-4 left-4 z-50 hidden sm:flex items-center gap-1">
          <button
            onClick={onExpandCollapsed}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar shadow-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all"
            title="Expand sidebar"
          >
            <PanelLeft size={16} />
          </button>
        </div>
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed sm:relative z-40 flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-200 overflow-hidden",
          isOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0",
          collapsed && "sm:!w-0 sm:border-r-0"
        )}
        style={{ width: collapsed ? 0 : width }}
      >
        <div
          className="h-full overflow-hidden flex flex-col"
          style={{ width: Math.max(width, DEFAULT_WIDTH) }}
        >
          {/* Mobile close button - top right of drawer */}
          <button
          onClick={onToggle}
          className="absolute top-3 right-3 z-50 sm:hidden p-1.5 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <X size={18} />
        </button>

        {/* Workspace picker */}
        {!isAllContentActive && (
          <div className="px-3 py-2 shrink-0">
            <WorkspaceSwitcher
              workspaces={groups}
              selected={selectedOwner}
              onSelect={onSelectOwner}
            />
          </div>
        )}

        {/* Back to all content — only shown when NOT in a project drill-down */}
        {!isAllContentActive && !(activeProjectSlug && activeProjectSlug !== SHARED_SLUG && activeProject && !overrideShowAll) && (
          <div className="px-3 pt-1.5 pb-3 border-b border-sidebar-border shrink-0">
            <button
              onClick={onOpenAllContent}
              className="flex items-center gap-1.5 text-xs text-sidebar-muted hover:text-sidebar-foreground transition-colors"
            >
              <ChevronLeft size={12} />
              <span>All workspaces</span>
            </button>
          </div>
        )}

        <ScrollArea className="flex-1 scrollbar-thin scrollbar-dark">
          {activeProjectSlug && activeProjectSlug !== SHARED_SLUG && activeProject && !overrideShowAll ? (
            <ProjectDrillDown
              project={activeProject}
              activeFile={activeFile}
              onBack={handleBackToProjects}
              onSelectFile={(fp) => {
                onSelectFile(activeProjectSlug, fp);
                if (window.innerWidth < 640) onToggle();
              }}
              onDeleteFile={(fp) => onDeleteFile(activeProjectSlug, fp)}
              onOpenGlobalImages={() => {
                onOpenGlobalImages();
                if (window.innerWidth < 640) onToggle();
              }}
              isGlobalImagesActive={isGlobalImagesActive}
              onOpenSearchResearch={() => {
                onOpenSearchResearch();
                if (window.innerWidth < 640) onToggle();
              }}
              isSearchResearchActive={isSearchResearchActive}
              onOpenProjectMedia={() => {
                onOpenProjectMedia();
                if (window.innerWidth < 640) onToggle();
              }}
              isProjectMediaActive={isProjectMediaActive}
              onOpenAllContent={() => {
                onOpenAllContent();
                if (window.innerWidth < 640) onToggle();
              }}
              isAllContentActive={isAllContentActive}
            />
          ) : (
            <TopLevelNav
              activeFile={activeFile}
              activeProjectSlug={activeProjectSlug}
              onSelectProject={handleSelectProject}
              onDeleteProject={handleDeleteProject}
              pendingDeleteSlug={pendingDeleteSlug}
              onSelectSharedFile={(fp) => {
                onSelectFile(SHARED_SLUG, fp);
                if (window.innerWidth < 640) onToggle();
              }}
              onDeleteSharedFile={(fp) => onDeleteFile(SHARED_SLUG, fp)}
              onSelectWorkspaceFile={(workspace, fp) => {
                onSelectFile(workspaceSharedSlug(workspace), fp);
                if (window.innerWidth < 640) onToggle();
              }}
              onDeleteWorkspaceFile={(workspace, fp) => onDeleteFile(workspaceSharedSlug(workspace), fp)}
              onNewProject={() => setShowNewProject(true)}
              selectedOwner={selectedOwner}
              groups={groups}
              onSelectOwner={onSelectOwner}
              onOpenGlobalImages={() => {
                onOpenGlobalImages();
                if (window.innerWidth < 640) onToggle();
              }}
              isGlobalImagesActive={isGlobalImagesActive}
              onOpenSearchResearch={() => {
                onOpenSearchResearch();
                if (window.innerWidth < 640) onToggle();
              }}
              isSearchResearchActive={isSearchResearchActive}
              onOpenAllContent={() => {
                onOpenAllContent();
                if (window.innerWidth < 640) onToggle();
              }}
              isAllContentActive={isAllContentActive}
              overrideShowAll={overrideShowAll}
            />
          )}
        </ScrollArea>

        {/* Feedback button — prominent, above footer */}
        <div className="px-3 pt-2 pb-1 shrink-0">
          <FeedbackButton variant="prominent" />
        </div>

        {/* Footer */}
        <div className="border-t border-sidebar-border shrink-0">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-0.5">
              <ThemeToggle />
              <a
                href="/settings"
                className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                title="API Key Settings"
              >
                <Settings size={16} />
              </a>
            </div>
            <div className="flex items-center gap-0.5">
              {onOpenSearch && (
                <button
                  onClick={onOpenSearch}
                  className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                  title="Search (⌘P)"
                >
                  <Search size={16} />
                </button>
              )}
              <button
                onClick={onCollapse}
                className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors hidden sm:flex"
                title="Collapse sidebar"
              >
                <PanelLeft size={16} />
              </button>
            </div>
          </div>
        </div>

        <NewProjectDialog
          open={showNewProject}
          onOpenChange={setShowNewProject}
          onCreated={(slug) => {
            setShowNewProject(false);
            handleSelectProject(slug);
          }}
          defaultGroup={selectedOwner}
        />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-sidebar-primary/30 transition-colors hidden sm:block"
        />
      </aside>
    </>
  );
}

/* ---- Top-level nav: Projects list + Shared Resources ---- */

function TopLevelNav({
  activeFile,
  activeProjectSlug,
  onSelectProject,
  onDeleteProject,
  pendingDeleteSlug,
  onSelectSharedFile,
  onDeleteSharedFile,
  onSelectWorkspaceFile,
  onDeleteWorkspaceFile,
  onNewProject,
  selectedOwner,
  groups,
  onSelectOwner,
  onOpenGlobalImages,
  isGlobalImagesActive,
  onOpenSearchResearch,
  isSearchResearchActive,
  onOpenAllContent,
  isAllContentActive,
  overrideShowAll = false,
}: {
  activeFile: { projectSlug: string; filePath: string } | null;
  activeProjectSlug: string | null;
  onSelectProject: (slug: string) => void;
  onDeleteProject: (slug: string) => void;
  pendingDeleteSlug?: string | null;
  onSelectSharedFile: (filePath: string) => void;
  onDeleteSharedFile: (filePath: string) => void;
  onSelectWorkspaceFile: (workspace: string, filePath: string) => void;
  onDeleteWorkspaceFile: (workspace: string, filePath: string) => void;
  onNewProject: () => void;
  selectedOwner: string | null;
  groups: string[];
  onSelectOwner: (owner: string) => void;
  onOpenGlobalImages: () => void;
  isGlobalImagesActive: boolean;
  onOpenSearchResearch: () => void;
  isSearchResearchActive: boolean;
  onOpenAllContent: () => void;
  isAllContentActive: boolean;
  overrideShowAll?: boolean;
}) {
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const wsSlug = selectedOwner ? workspaceSharedSlug(selectedOwner) : null;
  const { data: wsTree } = useFileTree(wsSlug);
  const hasWorkspaceResources = (wsTree?.tree?.length ?? 0) > 0;
  const [workspaceSharedExpanded, setWorkspaceSharedExpanded] = useState(false);

  // Auto-expand when resources exist, collapse when empty
  useEffect(() => {
    setWorkspaceSharedExpanded(hasWorkspaceResources);
  }, [hasWorkspaceResources]);
  const formatGroupLabel = (slug: string) =>
    slug
      .split("-")
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
      .join(" ");
  const [globalSharedExpanded, setGlobalSharedExpanded] = useState(true);
  const [showWorkspaceNewFile, setShowWorkspaceNewFile] = useState(false);
  const [showSharedNewFile, setShowSharedNewFile] = useState(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const createWorkspace = useCreateProjectGroup();
  const [sortMode, setSortMode] = useState<"recent" | "alpha">(() => {
    return (localStorage.getItem("projectSortMode") as "recent" | "alpha") || "recent";
  });

  const toggleSortMode = () => {
    const newMode = sortMode === "recent" ? "alpha" : "recent";
    setSortMode(newMode);
    localStorage.setItem("projectSortMode", newMode);
  };

  // When overrideShowAll is triggered, ensure Projects section is expanded
  useEffect(() => {
    if (overrideShowAll) {
      setProjectsExpanded(true);
    }
  }, [overrideShowAll]);

  return (
    <div className={cn("py-1", isAllContentActive && "pt-3")}>
      {/* Projects / Workspaces section */}
      <div className="mb-0.5">
        <div className="flex items-center justify-between px-3 py-1">
          <button
            onClick={() => setProjectsExpanded(!projectsExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground transition-colors"
          >
            <ChevronDown
              size={10}
              className={cn(
                "transition-transform duration-150",
                !projectsExpanded && "-rotate-90"
              )}
            />
            {isAllContentActive ? "Workspaces" : "Projects"}
          </button>
          <div className="flex items-center gap-1">
            {!isAllContentActive && (
              <button
                onClick={toggleSortMode}
                className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
                title={sortMode === "recent" ? "Sort A-Z" : "Sort by recent"}
              >
                {sortMode === "recent" ? <Clock size={13} /> : <ArrowDownAZ size={13} />}
              </button>
            )}
            <button
              onClick={() => isAllContentActive ? setShowNewWorkspace(true) : onNewProject()}
              className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
              title={isAllContentActive ? "New workspace" : "New project"}
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
        {projectsExpanded &&
          (isAllContentActive ? (
            <div className="px-2 space-y-0.5">
              {/* Private first, then others */}
              {groups.filter(g => g === "private").map((group) => (
                <button
                  key={group}
                  onClick={() => onSelectOwner(group)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
                >
                  <Lock size={14} className="shrink-0 text-sidebar-muted" />
                  <span className="truncate">Private</span>
                </button>
              ))}
              {groups.filter(g => g !== "private").map((group) => (
                <button
                  key={group}
                  onClick={() => onSelectOwner(group)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
                >
                  <FolderOpen size={14} className="shrink-0" />
                  <span className="truncate">{formatGroupLabel(group)}</span>
                </button>
              ))}
            </div>
          ) : (
            <ProjectList
              onSelectProject={onSelectProject}
              onDeleteProject={onDeleteProject}
              pendingDeleteSlug={pendingDeleteSlug}
              activeProjectSlug={activeProjectSlug}
              selectedOwner={selectedOwner}
              sortMode={sortMode}
            />
          ))}
      </div>

      {/* Workspace Resources section */}
      {selectedOwner && (
        <div className="mt-2">
          <div className="flex items-center justify-between px-3 py-1">
            <button
              onClick={() => setWorkspaceSharedExpanded(!workspaceSharedExpanded)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground transition-colors"
            >
              <ChevronDown
                size={10}
                className={cn(
                  "transition-transform duration-150",
                  !workspaceSharedExpanded && "-rotate-90"
                )}
              />
              Workspace Resources
            </button>
            <button
              onClick={() => setShowWorkspaceNewFile(true)}
              className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
              title="New workspace resource"
            >
              <Plus size={13} />
            </button>
          </div>
          {workspaceSharedExpanded && (
            <WorkspaceResourceTree
              workspace={selectedOwner}
              activeFile={activeFile}
              onSelectFile={(fp) => onSelectWorkspaceFile(selectedOwner, fp)}
              onDeleteFile={(fp) => onDeleteWorkspaceFile(selectedOwner, fp)}
            />
          )}
        </div>
      )}

      {/* Global Resources section - only in global view */}
      {!selectedOwner && (<div className="mt-2">
        <div className="flex items-center justify-between px-3 py-1">
          <button
            onClick={() => setGlobalSharedExpanded(!globalSharedExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground transition-colors"
          >
            <ChevronDown
              size={10}
              className={cn(
                "transition-transform duration-150",
                !globalSharedExpanded && "-rotate-90"
              )}
            />
            Global Resources
          </button>
          <button
            onClick={() => setShowSharedNewFile(true)}
            className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
            title="New global resource"
          >
            <Plus size={13} />
          </button>
        </div>
        {globalSharedExpanded && (
          <SharedResourceTree
            activeFile={activeFile}
            onSelectFile={onSelectSharedFile}
            onDeleteFile={onDeleteSharedFile}
          />
        )}
      </div>)}

      {/* Tools section */}
      <div className="mt-2">
        <div className="px-3 py-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
            Tools
          </span>
        </div>
        <div className="px-2 space-y-0.5">
          <button
            onClick={onOpenAllContent}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] transition-colors",
              isAllContentActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            )}
          >
            <Newspaper size={14} className="shrink-0" />
            <span>Blog Content</span>
          </button>
          <button
            onClick={onOpenGlobalImages}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] transition-colors",
              isGlobalImagesActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            )}
          >
            <ImageIcon size={14} className="shrink-0" />
            <span>Image Gen</span>
          </button>
          <button
            onClick={onOpenSearchResearch}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] transition-colors",
              isSearchResearchActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            )}
          >
            <Compass size={14} className="shrink-0" />
            <span>Research</span>
          </button>
        </div>
      </div>

      {/* Workspace shared new file dialog */}
      {selectedOwner && (
        <NewFileDialog
          open={showWorkspaceNewFile}
          onOpenChange={setShowWorkspaceNewFile}
          projectSlug={workspaceSharedSlug(selectedOwner)}
          type="file"
          onCreated={(filePath) => {
            setShowWorkspaceNewFile(false);
            onSelectWorkspaceFile(selectedOwner, filePath);
          }}
        />
      )}

      {/* Global shared new file dialog */}
      <NewFileDialog
        open={showSharedNewFile}
        onOpenChange={setShowSharedNewFile}
        projectSlug={SHARED_SLUG}
        type="file"
        onCreated={(filePath) => {
          setShowSharedNewFile(false);
          onSelectSharedFile(filePath);
        }}
      />

      {/* New workspace dialog */}
      <Dialog open={showNewWorkspace} onOpenChange={setShowNewWorkspace}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
            <DialogDescription>
              A workspace groups related projects together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Input
                placeholder="e.g. Marketing Content"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const name = newWorkspaceName.trim();
                    if (!name) return;
                    createWorkspace.mutateAsync({ name }).then((result) => {
                      onSelectOwner(result.group);
                      setShowNewWorkspace(false);
                      setNewWorkspaceName("");
                    });
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewWorkspace(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const name = newWorkspaceName.trim();
                if (!name) return;
                createWorkspace.mutateAsync({ name }).then((result) => {
                  onSelectOwner(result.group);
                  setShowNewWorkspace(false);
                  setNewWorkspaceName("");
                });
              }}
              disabled={!newWorkspaceName.trim() || createWorkspace.isPending}
            >
              {createWorkspace.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}


/* ---- Project drill-down view ---- */

function ProjectDrillDown({
  project,
  activeFile,
  onBack,
  onSelectFile,
  onDeleteFile,
  onOpenGlobalImages,
  isGlobalImagesActive,
  onOpenSearchResearch,
  isSearchResearchActive,
  onOpenProjectMedia,
  isProjectMediaActive,
  onOpenAllContent,
  isAllContentActive,
}: {
  project: { slug: string; name: string };
  activeFile: { projectSlug: string; filePath: string } | null;
  onBack: () => void;
  onSelectFile: (filePath: string) => void;
  onDeleteFile: (filePath: string) => void;
  onOpenGlobalImages: () => void;
  isGlobalImagesActive: boolean;
  onOpenSearchResearch: () => void;
  isSearchResearchActive: boolean;
  onOpenProjectMedia: () => void;
  isProjectMediaActive: boolean;
  onOpenAllContent: () => void;
  isAllContentActive: boolean;
}) {
  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-2 text-xs text-sidebar-muted hover:text-sidebar-foreground transition-colors w-full"
      >
        <ChevronLeft size={14} />
        <span className="font-medium">All projects</span>
      </button>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="text-sidebar-primary shrink-0" />
          <span className="text-sm font-medium text-sidebar-accent-foreground truncate">
            {project.name}
          </span>
        </div>
      </div>

      {/* Files */}
      <ProjectFileTree
        projectSlug={project.slug}
        activeFile={activeFile}
        onSelectFile={onSelectFile}
        onDeleteFile={onDeleteFile}
      />

      {/* Media section */}
      <div className="mt-2">
        <div className="px-3 py-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
            Media
          </span>
        </div>
        <div className="px-2 space-y-0.5">
          <button
            onClick={onOpenProjectMedia}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] transition-colors",
              isProjectMediaActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            )}
          >
            <Film size={14} className="shrink-0" />
            <span>Browse Media</span>
          </button>
        </div>
      </div>
    </div>
  );
}
