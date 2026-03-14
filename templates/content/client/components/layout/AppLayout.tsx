import { useEffect, useState, useCallback, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ProjectSidebar } from "@/components/sidebar/ProjectSidebar";
import { QuickSearch } from "@/components/QuickSearch";
import {
  useProjects,
  SHARED_SLUG,
  findProjectByRouteSlug,
  getProjectRouteSlug,
  workspaceUrl,
} from "@/hooks/use-projects";
import { useBuilderAuth } from "@/components/builder/BuilderAuthContext";
import { ConnectScreen } from "@/components/builder/ConnectScreen";
import { ImagePreview, isImagePath } from "@/components/shared/ImagePreview";
import { ImageFolderGrid } from "@/components/shared/ImageFolderGrid";
import type { Page } from "@shared/api";

type View =
  | "editor"
  | "global-images"
  | "research-search"
  | "project-media"
  | "project-history";

interface ActiveFile {
  projectSlug: string;
  filePath: string;
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: projectsData } = useProjects();
  const { isConnected } = useBuilderAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sharedFile, setSharedFile] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // --- Parse URL segments ---
  const segments = location.pathname.split("/").filter(Boolean);
  const searchParams = new URLSearchParams(location.search);

  // Check top-level routes
  const isImageGenRoute = segments[0] === "image-gen";
  const isResearchRoute = segments[0] === "research-search";
  const isTopLevel = isImageGenRoute || isResearchRoute;

  // Detect /workspace/ prefix for new workspaces
  const hasWorkspacePrefix = segments[0] === "workspace";
  const offset = hasWorkspacePrefix ? 1 : 0;

  const urlWorkspace = isTopLevel ? null : segments[offset] || null;
  const urlFile = searchParams.get("file");

  const selectedOwner = urlWorkspace;

  // Parse multi-segment project path
  const KNOWN_SUBVIEWS = ["media", "history"];
  let urlSubView: string | null = null;
  let routeProjectSlug: string | null = null;

  if (!isTopLevel && urlWorkspace) {
    const remainder = segments.slice(offset + 1);
    if (
      remainder.length > 0 &&
      KNOWN_SUBVIEWS.includes(remainder[remainder.length - 1])
    ) {
      urlSubView = remainder.pop()!;
    }
    routeProjectSlug =
      remainder.length > 0 ? `${urlWorkspace}/${remainder.join("/")}` : null;
  }

  const activeProjectData = findProjectByRouteSlug(
    projectsData?.projects,
    routeProjectSlug,
  );
  const activeProjectSlug = activeProjectData?.slug || null;

  const isProjectMediaRoute = urlSubView === "media";
  const isProjectHistoryRoute = urlSubView === "history";

  const view: View = isImageGenRoute
    ? "global-images"
    : isResearchRoute
      ? "research-search"
      : isProjectMediaRoute
        ? "project-media"
        : isProjectHistoryRoute
          ? "project-history"
          : "editor";

  const effectiveProjectSlug = isTopLevel ? null : activeProjectSlug;
  const lastFilePath = urlFile || activeProjectData?.activeDraft || "draft.md";

  // Derive active page ID for sidebar highlighting
  const activePageId = effectiveProjectSlug
    ? urlFile
      ? `${effectiveProjectSlug}::${urlFile}`
      : effectiveProjectSlug
    : null;

  // Helper to check if a workspace is prefixed
  const isWorkspacePrefixed = useCallback(
    (ws: string) => !!projectsData?.groupMeta?.[ws]?.prefixed,
    [projectsData?.groupMeta],
  );

  // --- Navigation handlers ---
  const handleSelectOwner = useCallback(
    (owner: string) => {
      setSharedFile(null);
      navigate(workspaceUrl(owner, isWorkspacePrefixed(owner)));
    },
    [navigate, isWorkspacePrefixed],
  );

  const handleSelectPage = useCallback(
    (page: Page) => {
      setSharedFile(null);
      const projectSlug = page._projectSlug;
      if (!projectSlug) return;

      const project = projectsData?.projects.find(
        (p) => p.slug === projectSlug,
      );
      const routeSlug = project ? getProjectRouteSlug(project) : projectSlug;
      const ws = routeSlug.includes("/") ? routeSlug.split("/")[0] : routeSlug;
      const base = workspaceUrl(routeSlug, isWorkspacePrefixed(ws));

      if (page._filePath === null) {
        // Navigate to project root (active draft)
        navigate(base);
      } else {
        // Navigate to specific file
        const proj = project;
        const projActiveDraft = proj?.activeDraft || "draft.md";
        if (page._filePath === projActiveDraft) {
          navigate(base);
        } else {
          navigate(`${base}?file=${encodeURIComponent(page._filePath)}`);
        }
      }
    },
    [isWorkspacePrefixed, navigate, projectsData?.projects],
  );

  // Legacy handlers for QuickSearch compatibility
  const handleSelectFile = useCallback(
    (projectSlug: string, filePath: string) => {
      handleSelectPage({
        id: `${projectSlug}::${filePath}`,
        title: "",
        parentId: null,
        type: "page",
        updatedAt: "",
        hasChildren: false,
        _projectSlug: projectSlug,
        _filePath: filePath,
      });
    },
    [handleSelectPage],
  );

  const handleSelectProject = useCallback(
    (slug: string) => {
      if (!slug) {
        navigate(
          urlWorkspace
            ? workspaceUrl(
                urlWorkspace,
                hasWorkspacePrefix || isWorkspacePrefixed(urlWorkspace),
              )
            : "/",
        );
        return;
      }
      handleSelectPage({
        id: slug,
        title: "",
        parentId: null,
        type: "page",
        updatedAt: "",
        hasChildren: false,
        _projectSlug: slug,
        _filePath: null,
      });
    },
    [
      handleSelectPage,
      hasWorkspacePrefix,
      isWorkspacePrefixed,
      navigate,
      urlWorkspace,
    ],
  );

  const handleOpenGlobalImages = useCallback(() => {
    setSharedFile(null);
    navigate("/image-gen");
  }, [navigate]);

  const handleOpenSearchResearch = useCallback(() => {
    setSharedFile(null);
    navigate("/research-search");
  }, [navigate]);

  // Persist workspace to localStorage
  useEffect(() => {
    if (urlWorkspace && projectsData?.groups?.includes(urlWorkspace)) {
      localStorage.setItem("workspaceOwner", urlWorkspace);
    }
  }, [urlWorkspace, projectsData?.groups]);

  if (
    location.pathname.startsWith("/test") ||
    location.pathname.startsWith("/builder-")
  ) {
    return <>{children}</>;
  }

  if (!isConnected) {
    return <ConnectScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ProjectSidebar
        activePageId={
          view === "editor" || view === "project-history" ? activePageId : null
        }
        onSelectPage={handleSelectPage}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        collapsed={sidebarCollapsed}
        onExpandCollapsed={() => setSidebarCollapsed(false)}
        onCollapse={() => setSidebarCollapsed(true)}
        selectedOwner={selectedOwner}
        onSelectOwner={handleSelectOwner}
        onOpenGlobalImages={handleOpenGlobalImages}
        isGlobalImagesActive={view === "global-images"}
        onOpenSearchResearch={handleOpenSearchResearch}
        isSearchResearchActive={view === "research-search"}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <QuickSearch
        onSelectFile={handleSelectFile}
        onSelectProject={handleSelectProject}
        currentWorkspace={urlWorkspace || undefined}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {sharedFile ? (
          sharedFile.startsWith("image-references/") &&
          !isImagePath(sharedFile) ? (
            <ImageFolderGrid
              key={sharedFile}
              folderPath={sharedFile}
              onBack={() => setSharedFile(null)}
            />
          ) : (
            <ImagePreview
              key={sharedFile}
              filePath={sharedFile}
              projectSlug={SHARED_SLUG}
            />
          )
        ) : (
          children
        )}
      </main>
    </div>
  );
}
