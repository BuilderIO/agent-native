import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  useProjects,
  useCreateProjectGroup,
  SHARED_SLUG,
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
  Plus,
  Menu,
  X,
  PanelLeft,
  Compass,
  ImageIcon,
  Search,
  Settings,
  ChevronDown,
} from "lucide-react";
import { PageTree } from "./PageTree";
import { NewPageDialog } from "./NewPageDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FeedbackButton } from "@/components/FeedbackButton";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import type { Page } from "@shared/api";

interface ProjectSidebarProps {
  activePageId: string | null;
  onSelectPage: (page: Page) => void;
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
  onOpenSearch?: () => void;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 260;

export function ProjectSidebar({
  activePageId,
  onSelectPage,
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
  onOpenSearch,
}: ProjectSidebarProps) {
  const [showNewPage, setShowNewPage] = useState(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const { data: projectsData } = useProjects();
  const createWorkspace = useCreateProjectGroup();
  const groups = projectsData?.groups ?? [];
  const [pagesExpanded, setPagesExpanded] = useState(true);

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
          collapsed && "sm:!w-0 sm:border-r-0",
        )}
        style={{ width: collapsed ? 0 : width }}
      >
        <div
          className="h-full overflow-hidden flex flex-col"
          style={{ width: Math.max(width, DEFAULT_WIDTH) }}
        >
          {/* Mobile close button */}
          <button
            onClick={onToggle}
            className="absolute top-3 right-3 z-50 sm:hidden p-1.5 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <X size={18} />
          </button>

          {/* Workspace picker */}
          <div className="px-3 py-2 shrink-0">
            <WorkspaceSwitcher
              workspaces={groups}
              selected={selectedOwner}
              onSelect={onSelectOwner}
            />
          </div>

          <ScrollArea className="flex-1 scrollbar-thin scrollbar-dark">
            <div className="py-1">
              {/* Pages section */}
              <div className="mb-0.5">
                <div className="flex items-center justify-between px-3 py-1">
                  <button
                    onClick={() => setPagesExpanded(!pagesExpanded)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground transition-colors"
                  >
                    <ChevronDown
                      size={10}
                      className={cn(
                        "transition-transform duration-150",
                        !pagesExpanded && "-rotate-90",
                      )}
                    />
                    Pages
                  </button>
                  <button
                    onClick={() => setShowNewPage(true)}
                    className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
                    title="New page"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {pagesExpanded && selectedOwner && (
                  <PageTree
                    workspace={selectedOwner}
                    activePageId={activePageId}
                    onSelectPage={(page) => {
                      onSelectPage(page);
                      if (window.innerWidth < 640) onToggle();
                    }}
                    onNewPage={() => setShowNewPage(true)}
                  />
                )}
                {pagesExpanded && !selectedOwner && (
                  <div className="px-4 py-3 text-xs text-sidebar-muted">
                    Select a workspace to view pages.
                  </div>
                )}
              </div>

              {/* Tools section */}
              <div className="mt-2">
                <div className="px-3 py-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                    Tools
                  </span>
                </div>
                <div className="px-2 space-y-0.5">
                  <button
                    onClick={onOpenGlobalImages}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] transition-colors",
                      isGlobalImagesActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
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
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )}
                  >
                    <Compass size={14} className="shrink-0" />
                    <span>Research</span>
                  </button>
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Feedback button */}
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
                    title="Search (Cmd+P)"
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

          <NewPageDialog
            open={showNewPage}
            onOpenChange={setShowNewPage}
            onCreated={(slug) => {
              setShowNewPage(false);
              // Navigate to the newly created page
              onSelectPage({
                id: slug,
                title: "",
                parentId: null,
                type: "page",
                updatedAt: new Date().toISOString(),
                hasChildren: false,
                _projectSlug: slug,
                _filePath: null,
              });
            }}
            defaultGroup={selectedOwner}
          />

          {/* New workspace dialog */}
          <Dialog open={showNewWorkspace} onOpenChange={setShowNewWorkspace}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Workspace</DialogTitle>
                <DialogDescription>
                  A workspace groups related pages together.
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
                <Button
                  variant="outline"
                  onClick={() => setShowNewWorkspace(false)}
                >
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
                  disabled={
                    !newWorkspaceName.trim() || createWorkspace.isPending
                  }
                >
                  {createWorkspace.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
