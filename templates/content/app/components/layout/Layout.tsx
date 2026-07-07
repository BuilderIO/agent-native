import { AgentSidebar, getBrowserTabId, useT } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { IconMenu2 } from "@tabler/icons-react";
import {
  type CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation, useNavigation } from "react-router";

import { DocumentEditorSkeleton } from "@/components/editor/DocumentEditorSkeleton";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useCreatePage } from "@/hooks/use-create-page";
import { useIsMobile } from "@/hooks/use-mobile";

import { Header } from "./Header";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 480;

// Routes whose page renders its own custom toolbar (with AgentToggleButton).
// Layout still mounts Sidebar + AgentSidebar, but skips its own Header so
// there's no double-header.
const NO_HEADER_PREFIXES = ["/page/", "/extensions"];

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const w = Number(stored);
      if (w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) return w;
    }
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH;
}

export function documentPageIdFromPathname(pathname: string) {
  return pathname.match(/^\/page\/(.+)/)?.[1] ?? null;
}

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigation = useNavigation();
  const pendingPathname = navigation.location?.pathname ?? null;
  const chromePathname = pendingPathname ?? location.pathname;
  const t = useT();
  const currentDocumentId = documentPageIdFromPathname(location.pathname);
  const pendingDocumentId = pendingPathname
    ? documentPageIdFromPathname(pendingPathname)
    : null;
  const activeDocumentId = pendingDocumentId ?? currentDocumentId;
  const showPendingDocumentSkeleton =
    !!pendingDocumentId && pendingDocumentId !== currentDocumentId;
  // Bind chat to the currently-open document. Everywhere else (list view,
  // settings) leaves scope null so general chats stay available.
  const documentScope = useMemo(
    () =>
      activeDocumentId
        ? { type: "document" as const, id: activeDocumentId }
        : null,
    [activeDocumentId],
  );
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);

  const handleSidebarResize = useCallback((width: number) => {
    const clamped = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, width),
    );
    setSidebarWidth(clamped);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
  }, []);

  const showHeader = !NO_HEADER_PREFIXES.some((prefix) =>
    chromePathname.startsWith(prefix),
  );

  const createPage = useCreatePage({ awaitPersist: false });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "n" && e.key !== "N") return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      void createPage();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createPage]);

  const mobileSidebarTrigger = isMobile ? (
    <button
      type="button"
      aria-label={t("navigation.openSidebar")}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
      onClick={() => setMobileSidebarOpen(true)}
    >
      <IconMenu2 size={18} />
    </button>
  ) : null;
  const contentSidebarWidth = isMobile
    ? 0
    : sidebarCollapsed
      ? 48
      : sidebarWidth;

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell flex h-screen overflow-hidden bg-background">
        {isMobile ? (
          <>
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetContent
                side="left"
                showClose={false}
                className="w-[85vw] max-w-[85vw] sm:max-w-[85vw] p-0"
              >
                <DocumentSidebar
                  activeDocumentId={activeDocumentId}
                  collapsed={false}
                  onToggleCollapsed={() => setMobileSidebarOpen(false)}
                  onNavigate={() => setMobileSidebarOpen(false)}
                />
              </SheetContent>
            </Sheet>
            {showHeader ? null : (
              <button
                type="button"
                aria-label={t("navigation.openSidebar")}
                className="fixed start-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground md:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <IconMenu2 size={18} />
              </button>
            )}
          </>
        ) : (
          <div className="agent-layout-left-drawer flex shrink-0">
            <DocumentSidebar
              activeDocumentId={activeDocumentId}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
              width={sidebarWidth}
              onResize={handleSidebarResize}
            />
          </div>
        )}
        <AgentSidebar
          position="right"
          defaultOpen={!isMobile}
          emptyStateText={t("chat.emptyState")}
          suggestions={[
            t("chat.suggestionPrd"),
            t("chat.suggestionSummary"),
            t("chat.suggestionNotion"),
          ]}
          scope={documentScope}
          browserTabId={getBrowserTabId()}
        >
          <main
            className="agent-native-app-main relative flex min-w-0 min-h-0 flex-1 flex-col overflow-x-hidden"
            style={
              {
                "--content-sidebar-width": `${contentSidebarWidth}px`,
              } as CSSProperties
            }
          >
            {showHeader ? (
              <Header sidebarTrigger={mobileSidebarTrigger} />
            ) : null}
            <InvitationBanner
              className={`${showHeader ? "ps-4" : "ps-16"} sm:ps-4 [&>div]:flex-wrap [&>div]:items-start [&>div>span]:min-w-0 [&>div>span]:flex-1`}
            />
            {showPendingDocumentSkeleton ? (
              <DocumentEditorSkeleton />
            ) : (
              children
            )}
          </main>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
