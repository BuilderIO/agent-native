import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router";
import { IconMenu2 } from "@tabler/icons-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HeaderActionsProvider } from "./HeaderActions";
import {
  AgentSidebar,
  isEmbedAuthActive,
  getBrowserTabId,
} from "@agent-native/core/client";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

const MobileSidebarContext = createContext<(() => void) | null>(null);

export function useOpenMobileSidebar() {
  return useContext(MobileSidebarContext);
}

/** Routes that render with no app shell at all (no sidebar, no header). */
const BARE_PREFIXES = ["/present/"];

/**
 * Routes where the page renders its own toolbar instead of the global Header.
 * The Sidebar + AgentSidebar still render. The Header is hidden so the page
 * can supply a richer custom toolbar (e.g. DesignEditor mode/zoom/device,
 * shared ExtensionViewer / ExtensionsListPage chrome).
 */
const EDITOR_PREFIXES = ["/design/", "/extensions"];

export function Layout({ children }: LayoutProps) {
  useNavigationState();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);

  // Bind chat to the currently-open design. Same pattern as slides — the
  // route is `/design/:id` for the editor and `/present/:id` for preview
  // (which we already short-circuit as BARE). Anywhere else (list,
  // design-systems, settings, templates) leaves scope null so general
  // chats keep working.
  const designScope = useMemo(() => {
    const match = location.pathname.match(/^\/design\/([^/]+)/);
    const designId = match?.[1];
    if (!designId) return null;
    return { type: "design" as const, id: designId };
  }, [location.pathname]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const isBare = BARE_PREFIXES.some((p) => location.pathname.startsWith(p));
  if (isBare) {
    return <>{children}</>;
  }

  const hideHeader = EDITOR_PREFIXES.some((p) =>
    location.pathname.startsWith(p),
  );
  const isDesignEditor = location.pathname.startsWith("/design/");
  const showMobileTopBar = !isDesignEditor;
  const embedded = isEmbedAuthActive();

  if (embedded) {
    return (
      <HeaderActionsProvider>
        <MobileSidebarContext.Provider value={null}>
          <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
            <main
              className={cn(
                "min-w-0 flex-1",
                isDesignEditor ? "overflow-hidden" : "overflow-y-auto",
              )}
            >
              {children}
            </main>
          </div>
        </MobileSidebarContext.Provider>
      </HeaderActionsProvider>
    );
  }

  return (
    <HeaderActionsProvider>
      <MobileSidebarContext.Provider value={openMobileSidebar}>
        <AgentSidebar
          position="right"
          emptyStateText="Describe a design to create"
          suggestions={[
            "Design a landing page for my startup",
            "Make this match our brand",
            "Add a mobile version of this",
          ]}
          scope={designScope}
          browserTabId={getBrowserTabId()}
        >
          <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
            {mobileSidebarOpen && (
              <div
                className="fixed inset-0 z-40 bg-black/50 md:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />
            )}
            <div
              className={cn(
                "fixed inset-y-0 left-0 z-50 md:static md:z-auto",
                mobileSidebarOpen
                  ? "translate-x-0"
                  : "-translate-x-full md:translate-x-0",
              )}
            >
              <Sidebar />
            </div>
            <div className="flex h-full flex-1 flex-col overflow-hidden">
              {/* Mobile-only top bar with hamburger */}
              {showMobileTopBar && (
                <div className="flex h-12 shrink-0 items-center border-b border-border bg-sidebar px-4 md:hidden">
                  <button
                    onClick={openMobileSidebar}
                    className="-ml-1 mr-3 cursor-pointer rounded-md p-2.5 hover:bg-sidebar-accent/50"
                    aria-label="Open navigation"
                  >
                    <IconMenu2 className="h-5 w-5 text-foreground" />
                  </button>
                  <span className="text-base font-bold tracking-tight">
                    Design
                  </span>
                </div>
              )}
              {!hideHeader && <Header />}
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </div>
        </AgentSidebar>
      </MobileSidebarContext.Provider>
    </HeaderActionsProvider>
  );
}
