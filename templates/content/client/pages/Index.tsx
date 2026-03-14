import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { EditorView } from "@/components/editor/EditorView";
import { EmptyState } from "@/components/EmptyState";
import { ResearchSearchPanel } from "@/components/research-search/ResearchSearchPanel";
import { ImageGenPanel } from "@/components/image-gen/ImageGenPanel";
import { ProjectMediaGrid } from "@/components/media/ProjectMediaGrid";
import { ProjectHistoryView } from "@/components/editor/ProjectHistoryView";
import {
  findProjectByRouteSlug,
  getProjectRouteSlug,
  useProjects,
  workspaceUrl,
} from "@/hooks/use-projects";

export default function Index() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: projectsData } = useProjects();

  // --- Parse URL segments ---
  const segments = location.pathname.split("/").filter(Boolean);
  const searchParams = new URLSearchParams(location.search);

  // Top-level tool routes
  const isImageGenRoute = segments[0] === "image-gen";
  const isResearchRoute = segments[0] === "research-search";
  const isBlog = segments[0] === "blog";
  const isDocs = segments[0] === "docs";
  const isTopLevel = isBlog || isDocs || isImageGenRoute || isResearchRoute;

  // Detect /workspace/ prefix for new workspaces
  const hasWorkspacePrefix = segments[0] === "workspace";
  const offset = hasWorkspacePrefix ? 1 : 0;

  const urlWorkspace = isTopLevel ? null : segments[offset] || null;
  const urlFile = searchParams.get("file");

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

  const activeProject = findProjectByRouteSlug(projectsData?.projects, routeProjectSlug);
  const activeProjectSlug = activeProject?.slug || null;
  const activeProjectRouteSlug = activeProject ? getProjectRouteSlug(activeProject) : routeProjectSlug;

  const isProjectMediaRoute = urlSubView === "media";
  const isProjectHistoryRoute = urlSubView === "history";

  const view = isImageGenRoute
    ? "global-images"
    : isResearchRoute
      ? "research-search"
      : isProjectMediaRoute
        ? "project-media"
        : isProjectHistoryRoute
          ? "project-history"
          : "editor";

  const effectiveProjectSlug = isTopLevel ? null : activeProjectSlug;

  // Use activeDraft from project metadata, defaulting to draft.md
  const lastFilePath = urlFile || activeProject?.activeDraft || "draft.md";

  // --- Redirect / workspace validation ---
  useEffect(() => {
    // Don't redirect test or utility routes
    if (location.pathname.startsWith('/test/') || location.pathname.startsWith('/builder-')) {
      return;
    }

    // Top-level tool routes (/image-gen, /research-search) are valid — no redirect
    if (isImageGenRoute || isResearchRoute) {
      return;
    }

    const groups = projectsData?.groups ?? [];
    if (!groups.length) return;

    if (!urlWorkspace) {
      // Root / or unknown - redirect to blog
      navigate(`/blog`, { replace: true });
    } else if (urlWorkspace !== "workspace" && !groups.includes(urlWorkspace)) {
      const stored = localStorage.getItem("workspaceOwner");
      // If stored is invalid, pick the first group
      const target = stored && groups.includes(stored) ? stored : groups[0];
      const prefixed = !!projectsData?.groupMeta?.[target]?.prefixed;
      navigate(workspaceUrl(target, prefixed), { replace: true });
    } else if (
      routeProjectSlug &&
      activeProjectRouteSlug &&
      routeProjectSlug !== activeProjectRouteSlug
    ) {
      const ws = activeProjectRouteSlug.split("/")[0];
      const prefixed = !!projectsData?.groupMeta?.[ws]?.prefixed;
      const base = workspaceUrl(activeProjectRouteSlug, prefixed);
      const target = isProjectMediaRoute
        ? `${base}/media`
        : isProjectHistoryRoute
          ? `${base}/history`
          : urlFile && urlFile !== (activeProject?.activeDraft || "draft.md")
            ? `${base}?file=${encodeURIComponent(urlFile)}`
            : base;
      navigate(target, { replace: true });
    }
  }, [
    activeProject?.activeDraft,
    activeProjectRouteSlug,
    isImageGenRoute,
    isProjectHistoryRoute,
    isProjectMediaRoute,
    isResearchRoute,
    location.pathname,
    navigate,
    projectsData?.groupMeta,
    projectsData?.groups,
    routeProjectSlug,
    urlFile,
    urlWorkspace,
  ]);

  if (location.pathname.startsWith('/test') || location.pathname.startsWith('/builder-')) {
    return null;
  }

  // NOTE: sidebarCollapsed state is now in AppLayout. ResearchSearchPanel needs it.
  // We will just pass false since it's hard to sync, or we accept that ResearchSearchPanel might not toggle it perfectly without Context.
  // Actually, ResearchSearchPanel only uses onPreviewChange to collapse the sidebar. We can just ignore it for now or rely on AppLayout.

  return (
    <AppLayout>
      {view === "project-media" && activeProjectSlug ? (
        <ProjectMediaGrid
          projectSlug={activeProjectSlug}
          onBack={() => {
            const routeSlug = activeProject ? getProjectRouteSlug(activeProject) : activeProjectSlug;
            const ws = routeSlug.split("/")[0];
            const prefixed = !!projectsData?.groupMeta?.[ws]?.prefixed;
            navigate(workspaceUrl(routeSlug, prefixed));
          }}
        />
      ) : view === "project-history" && activeProjectSlug ? (
        <ProjectHistoryView
          projectSlug={activeProjectSlug}
          filePath={lastFilePath}
        />
      ) : view === "research-search" ? (
        <ResearchSearchPanel
          onPreviewChange={() => {}}
          activeProjectSlug={effectiveProjectSlug}
          currentWorkspace={urlWorkspace ?? undefined}
          sidebarCollapsed={false}
        />
      ) : view === "global-images" ? (
        <ImageGenPanel />
      ) : activeProjectSlug ? (
        <EditorView
          key={`${activeProjectSlug}-${lastFilePath}`}
          projectSlug={activeProjectSlug}
          filePath={lastFilePath}
        />
      ) : (
        <EmptyState hasProject={!!activeProjectSlug} />
      )}
    </AppLayout>
  );
}
