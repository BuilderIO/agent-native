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

type View = "editor" | "global-images" | "research-search" | "project-media" | "project-history" | "all-up";

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
  const [lastProjectSlug, setLastProjectSlug] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // --- Parse URL segments ---
  const segments = location.pathname.split("/").filter(Boolean);
  const searchParams = new URLSearchParams(location.search);

  // Check top-level routes
  const isBlog = segments[0] === "blog";
  const isDocs = segments[0] === "docs";
  const isImageGenRoute = segments[0] === "image-gen";
  const isResearchRoute = segments[0] === "research-search";
  const isTopLevel = isBlog || isDocs || isImageGenRoute || isResearchRoute;

  // Detect /workspace/ prefix for new workspaces
  const hasWorkspacePrefix = segments[0] === "workspace";
  const offset = hasWorkspacePrefix ? 1 : 0;

  const urlWorkspace = isTopLevel ? null : segments[offset] || null;
  const urlFile = searchParams.get("file");

  // Only restore workspace from localStorage when inside a workspace route (not top-level)
  const selectedOwner = urlWorkspace;

  // Parse multi-segment project path: everything after workspace, minus known subviews
  const KNOWN_SUBVIEWS = ["media", "history"];
  let urlSubView: string | null = null;
  let routeProjectSlug: string | null = null;

  if (!isTopLevel && urlWorkspace) {
    const remainder = segments.slice(offset + 1);
    if (remainder.length > 0 && KNOWN_SUBVIEWS.includes(remainder[remainder.length - 1])) {
      urlSubView = remainder.pop()!;
    }
    routeProjectSlug = remainder.length > 0 ? `${urlWorkspace}/${remainder.join("/")}` : null;
  }

  const activeProjectData = findProjectByRouteSlug(projectsData?.projects, routeProjectSlug);
  const activeProjectSlug = activeProjectData?.slug || null;

  const isProjectMediaRoute = urlSubView === "media";
  const isProjectHistoryRoute = urlSubView === "history";

  const view: View = isImageGenRoute
    ? "global-images"
    : isResearchRoute
      ? "research-search"
      : (isBlog || isDocs)
        ? "all-up"
        : isProjectMediaRoute
          ? "project-media"
          : isProjectHistoryRoute
            ? "project-history"
            : "editor";

  const effectiveProjectSlug = isTopLevel ? null : activeProjectSlug;

  const validLastProject = lastProjectSlug?.startsWith(`${urlWorkspace}/`) ? lastProjectSlug : null;
  const sidebarProjectSlug = effectiveProjectSlug || validLastProject;

  // Use activeDraft from project metadata, defaulting to draft.md
  const lastFilePath = urlFile || activeProjectData?.activeDraft || "draft.md";

  const activeFile: ActiveFile | null = sharedFile
    ? { projectSlug: SHARED_SLUG, filePath: sharedFile }
    : (view === "editor" || view === "project-history") && effectiveProjectSlug
      ? { projectSlug: effectiveProjectSlug, filePath: lastFilePath }
      : null;

  // Track last active project
  useEffect(() => {
    if (effectiveProjectSlug) {
      setLastProjectSlug(effectiveProjectSlug);
    }
  }, [effectiveProjectSlug]);

  // Persist workspace to localStorage
  useEffect(() => {
    if (urlWorkspace && projectsData?.groups?.includes(urlWorkspace)) {
      localStorage.setItem("workspaceOwner", urlWorkspace);
    }
  }, [urlWorkspace, projectsData?.groups]);

  // Helper to check if a workspace is prefixed
  const isWorkspacePrefixed = useCallback(
    (ws: string) => !!projectsData?.groupMeta?.[ws]?.prefixed,
    [projectsData?.groupMeta]
  );

  // --- Navigation handlers ---
  const handleSelectOwner = useCallback(
    (owner: string) => {
      setSharedFile(null);
      setLastProjectSlug(null);
      navigate(workspaceUrl(owner, isWorkspacePrefixed(owner)));
    },
    [navigate, isWorkspacePrefixed]
  );

  const handleSelectProject = useCallback(
    (slug: string) => {
      setSharedFile(null);
      if (!slug) {
        navigate(urlWorkspace ? workspaceUrl(urlWorkspace, hasWorkspacePrefix || isWorkspacePrefixed(urlWorkspace)) : "/");
      } else {
        const project = projectsData?.projects.find((entry) => entry.slug === slug);
        const targetSlug = project ? getProjectRouteSlug(project) : slug;
        const ws = targetSlug.includes("/") ? targetSlug.split("/")[0] : targetSlug;
        navigate(workspaceUrl(targetSlug, isWorkspacePrefixed(ws)));
      }
    },
    [hasWorkspacePrefix, isWorkspacePrefixed, navigate, projectsData?.projects, urlWorkspace]
  );

  const handleSelectFile = useCallback(
    (projectSlug: string, filePath: string) => {
      if (projectSlug === SHARED_SLUG) {
        setSharedFile(filePath);
      } else {
        setSharedFile(null);
        const project = projectsData?.projects.find((entry) => entry.slug === projectSlug);
        const routeSlug = project ? getProjectRouteSlug(project) : projectSlug;
        const ws = routeSlug.includes("/") ? routeSlug.split("/")[0] : routeSlug;
        const base = workspaceUrl(routeSlug, isWorkspacePrefixed(ws));
        // Navigate to base URL when selecting the active draft (no ?file= needed)
        const proj = project;
        const projActiveDraft = proj?.activeDraft || "draft.md";
        if (filePath === projActiveDraft) {
          navigate(base);
        } else {
          navigate(`${base}?file=${encodeURIComponent(filePath)}`);
        }
      }
    },
    [isWorkspacePrefixed, navigate, projectsData?.projects]
  );

  const handleDeleteFile = useCallback(
    (projectSlug: string, filePath: string) => {
      if (projectSlug === SHARED_SLUG && sharedFile === filePath) {
        setSharedFile(null);
        return;
      }
      if (
        activeFile?.projectSlug === projectSlug &&
        activeFile?.filePath === filePath
      ) {
        const project = projectsData?.projects.find((entry) => entry.slug === projectSlug);
        const routeSlug = project ? getProjectRouteSlug(project) : projectSlug;
        const ws = routeSlug.includes("/") ? routeSlug.split("/")[0] : routeSlug;
        navigate(workspaceUrl(routeSlug, isWorkspacePrefixed(ws)));
      }
    },
    [activeFile, isWorkspacePrefixed, navigate, projectsData?.projects, sharedFile]
  );

  const handleOpenGlobalImages = useCallback(() => {
    setSharedFile(null);
    navigate("/image-gen");
  }, [navigate]);

  const handleOpenSearchResearch = useCallback(() => {
    setSharedFile(null);
    navigate("/research-search");
  }, [navigate]);

  const handleOpenProjectMedia = useCallback(() => {
    setSharedFile(null);
    const slug = effectiveProjectSlug || validLastProject;
    if (slug) {
      const project = projectsData?.projects.find((entry) => entry.slug === slug);
      const routeSlug = project ? getProjectRouteSlug(project) : slug;
      const ws = routeSlug.includes("/") ? routeSlug.split("/")[0] : routeSlug;
      navigate(`${workspaceUrl(routeSlug, isWorkspacePrefixed(ws))}/media`);
    }
  }, [
    effectiveProjectSlug,
    isWorkspacePrefixed,
    navigate,
    projectsData?.projects,
    validLastProject,
  ]);

  const handleOpenAllContent = useCallback(() => {
    setSharedFile(null);
    navigate("/blog");
  }, [navigate]);

  if (location.pathname.startsWith('/test') || location.pathname.startsWith('/builder-')) {
    return <>{children}</>;
  }

  if (!isConnected) {
    return <ConnectScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ProjectSidebar
        activeFile={view === "editor" || view === "project-history" ? activeFile : null}
        activeProjectSlug={sidebarProjectSlug}
        onSelectProject={handleSelectProject}
        onSelectFile={handleSelectFile}
        onDeleteFile={handleDeleteFile}
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
        onOpenProjectMedia={handleOpenProjectMedia}
        isProjectMediaActive={view === "project-media"}
        onOpenAllContent={handleOpenAllContent}
        isAllContentActive={isTopLevel}
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
          sharedFile.startsWith("image-references/") && !isImagePath(sharedFile) ? (
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
