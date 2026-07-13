import {
  AgentSidebar,
  isEmbedAuthActive,
  getBrowserTabId,
  useGuidedQuestionFlow,
  useSession,
  useT,
} from "@agent-native/core/client";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { IconMenu2 } from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router";

import { useNavigationState } from "@/hooks/use-navigation-state";
import { DESIGN_CHAT_STORAGE_KEY } from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

import {
  FigmaLinkComposerBubble,
  useDetectedFigmaComposerLink,
} from "../editor/FigmaLinkComposerBubble";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

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
 * The Header is hidden so the page can supply richer custom chrome (e.g.
 * DesignEditor mode/zoom/device, shared ExtensionViewer / ExtensionsListPage
 * chrome). The editor owns its agent surface inside its Figma-style left rail.
 */
const EDITOR_PREFIXES = ["/design/", "/extensions"];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const t = useT();
  const { session } = useSession();
  const hasSession = Boolean(session?.email);
  const embedded = isEmbedAuthActive();
  useNavigationState(hasSession);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const isDesignEditor = location.pathname.startsWith("/design/");
  const showMobileTopBar = !isDesignEditor;
  const browserTabId = getBrowserTabId();
  const {
    link: detectedFigmaComposerLink,
    onComposerTextChange: handleComposerTextChange,
  } = useDetectedFigmaComposerLink();

  // Bind chat to the currently-open design. Same pattern as slides — the
  // route is `/design/:id` for the editor and `/present/:id` for preview
  // (which we already short-circuit as BARE). Anywhere else (list,
  // design-systems, settings) leaves scope null so general chats keep working.
  const designScope = useMemo(() => {
    const match = location.pathname.match(/^\/design\/([^/]+)/);
    const designId = match?.[1];
    if (!designId) return null;
    return { type: "design" as const, id: designId };
  }, [location.pathname]);
  const designQuestionStateKey = designScope
    ? `show-questions:${designScope.id}`
    : "show-questions";
  const { questions: pendingDesignQuestions } = useGuidedQuestionFlow({
    stateKey: designQuestionStateKey,
    queryKey: [designQuestionStateKey],
    browserTabId,
    refetchInterval: embedded || !isDesignEditor || !hasSession ? false : 2000,
  });
  const designQuestionsWaitingSlot =
    isDesignEditor && pendingDesignQuestions?.length ? (
      <div className="px-4 pb-2 pt-1 text-xs text-muted-foreground">
        {"Waiting for your answers in the canvas." /* i18n-ignore */}
      </div>
    ) : null;

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

  if (embedded || (isDesignEditor && !hasSession)) {
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

  if (isDesignEditor) {
    return (
      <HeaderActionsProvider>
        <MobileSidebarContext.Provider value={null}>
          <div className="agent-layout-shell flex h-dvh w-full overflow-hidden bg-background text-foreground">
            <div className="agent-layout-main-surface design-editor-main-surface flex h-full flex-1 flex-col overflow-hidden">
              <main className="agent-native-app-main flex-1 overflow-hidden">
                {children}
              </main>
            </div>
          </div>
        </MobileSidebarContext.Provider>
      </HeaderActionsProvider>
    );
  }

  return (
    <HeaderActionsProvider>
      <MobileSidebarContext.Provider
        value={isDesignEditor ? null : openMobileSidebar}
      >
        <AgentSidebar
          position="right"
          storageKey={DESIGN_CHAT_STORAGE_KEY}
          agentPageHref="/agent"
          emptyStateText={t("chat.emptyState")}
          suggestions={[
            t("chat.suggestionLandingPage"),
            t("chat.suggestionBrandMatch"),
            t("chat.suggestionMobile"),
          ]}
          scope={designScope}
          showScopeBadge={false}
          browserTabId={browserTabId}
          threadFooterSlot={designQuestionsWaitingSlot}
          onComposerTextChange={handleComposerTextChange}
          composerSlot={
            detectedFigmaComposerLink ? (
              <FigmaLinkComposerBubble link={detectedFigmaComposerLink} />
            ) : null
          }
        >
          <div className="agent-layout-shell flex h-dvh w-full overflow-hidden bg-background text-foreground">
            {!isDesignEditor && mobileSidebarOpen && (
              <div
                className="fixed inset-0 z-40 bg-black/50 md:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />
            )}
            {!isDesignEditor && (
              <div
                className={cn(
                  "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 transition-transform duration-200 ease-out md:static md:z-auto md:transition-none motion-reduce:transition-none",
                  mobileSidebarOpen
                    ? "translate-x-0"
                    : "-translate-x-full rtl:translate-x-full md:translate-x-0 md:rtl:translate-x-0",
                )}
              >
                <Sidebar />
              </div>
            )}
            <div className="agent-layout-main-surface flex h-full flex-1 flex-col overflow-hidden">
              {/* Mobile-only top bar with hamburger */}
              {showMobileTopBar && (
                <div className="flex h-12 shrink-0 items-center border-b border-border bg-sidebar px-4 md:hidden">
                  <button
                    onClick={openMobileSidebar}
                    className="-ms-1 me-3 cursor-pointer rounded-md p-2.5 hover:bg-sidebar-accent/50"
                    aria-label={t("navigation.openNavigation")}
                  >
                    <IconMenu2 className="h-5 w-5 text-foreground" />
                  </button>
                  <span className="text-base font-bold tracking-tight">
                    {t("navigation.brand")}
                  </span>
                </div>
              )}
              {!hideHeader && <Header />}
              <main
                className={cn(
                  "agent-native-app-main flex-1",
                  isDesignEditor ? "overflow-hidden" : "overflow-y-auto",
                )}
              >
                {children}
              </main>
            </div>
          </div>
        </AgentSidebar>
      </MobileSidebarContext.Provider>
    </HeaderActionsProvider>
  );
}
