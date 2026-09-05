import {
  AgentSidebar,
  focusAgentChat,
  isAgentChatHomeHandoffActive,
  isAssistantChatHistoryVersion,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  useGuidedQuestionFlow,
  type AssistantChatHistoryConfig,
  type AssistantChatHistoryVersion,
} from "@agent-native/core/client/agent-chat";
import { getBrowserTabId, useSession } from "@agent-native/core/client/hooks";
import { isEmbedAuthActive } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { CreativeContextComposerChip } from "@agent-native/creative-context/client";
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
import { useLocation, useNavigate } from "react-router";

import { useNavigationState } from "@/hooks/use-navigation-state";
import { DESIGN_CHAT_STORAGE_KEY } from "@/lib/agent-chat";
import { isBuilderHostEmbed } from "@/lib/builder-host-origin";
import {
  designEditorRoute,
  isDesignEditorRoute,
} from "@/lib/design-editor-route";
import { cn } from "@/lib/utils";

import {
  FigmaLinkComposerBubble,
  useDetectedFigmaComposerLink,
} from "../editor/FigmaLinkComposerBubble";
import { Header, MobileHeaderActions } from "./Header";
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
 * Routes where the page renders its own toolbar instead of the global Header
 * on a standalone page. Embedded app surfaces keep the global shell so the
 * host-provided chat rail can still be reopened from the app header.
 */
const EDITOR_PREFIXES = ["/design/", "/visual-edit/", "/extensions"];

type DesignLayoutMode = "host-bare" | "standalone-editor" | "app-shell";

function resolveDesignLayoutMode(input: {
  builderHostEmbed: boolean;
  embedded: boolean;
  hasSession: boolean;
  isDesignEditor: boolean;
}): DesignLayoutMode {
  if (
    input.builderHostEmbed ||
    (input.isDesignEditor && !input.hasSession && !input.embedded)
  ) {
    return "host-bare";
  }
  if (input.isDesignEditor && !input.embedded) return "standalone-editor";
  return "app-shell";
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const isChatRoute =
    location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const { session } = useSession();
  const hasSession = Boolean(session?.email);
  const builderHostEmbed = isBuilderHostEmbed();
  // The shell canvas is embedded without a session, so this cannot be the token
  // check alone or it renders Design's own nav inside Builder.
  const embedded = builderHostEmbed || isEmbedAuthActive();
  useNavigationState(hasSession);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const isDesignEditor = isDesignEditorRoute(location.pathname);
  const layoutMode = resolveDesignLayoutMode({
    builderHostEmbed,
    embedded,
    hasSession,
    isDesignEditor,
  });
  const standaloneEditor = layoutMode === "standalone-editor";
  const showMobileTopBar = !standaloneEditor;
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
    const designId = designEditorRoute(location.pathname)?.designId;
    if (!designId) return null;
    return { type: "design" as const, id: designId };
  }, [location.pathname]);
  const designChatHistory = useMemo<
    AssistantChatHistoryConfig | undefined
  >(() => {
    if (!designScope) return undefined;
    const designId = designScope.id;
    return {
      list: {
        action: "list-design-versions",
        args: { designId, limit: 100 },
        getVersions: (result: unknown) => {
          const versions =
            result && typeof result === "object"
              ? (result as { versions?: unknown }).versions
              : undefined;
          return Array.isArray(versions)
            ? versions.filter(isAssistantChatHistoryVersion)
            : [];
        },
      },
      restore: {
        action: "restore-design-version",
        args: (version: AssistantChatHistoryVersion) => ({
          designId,
          versionId: version.id,
        }),
      },
    };
  }, [designScope]);
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: DESIGN_CHAT_STORAGE_KEY,
    activePath: location.pathname,
    enabled: !isChatRoute,
  });
  const chatHomeHandoffPending = isAgentChatHomeHandoffActive(
    DESIGN_CHAT_STORAGE_KEY,
  );
  useAgentChatHomeHandoffLinks({
    storageKey: DESIGN_CHAT_STORAGE_KEY,
    isChatPath: (pathname) =>
      pathname === "/chat" || pathname.startsWith("/chat/"),
    requireActiveHandoff: true,
  });
  const designQuestionStateKey = designScope
    ? `show-questions:${designScope.id}`
    : "show-questions";
  const { questions: pendingDesignQuestions } = useGuidedQuestionFlow({
    enabled: hasSession,
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

  const hideHeader =
    isChatRoute ||
    (!embedded && EDITOR_PREFIXES.some((p) => location.pathname.startsWith(p)));

  function openAgentChatFullscreen() {
    focusAgentChat();
    const designQuery = designScope
      ? `?designId=${encodeURIComponent(designScope.id)}`
      : "";
    navigateWithAgentChatViewTransition(navigate, `/chat${designQuery}`);
  }

  if (layoutMode === "host-bare") {
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

  if (layoutMode === "standalone-editor") {
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

  const shell = (
    <div className="agent-layout-shell flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {!standaloneEditor && mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      {!standaloneEditor && (
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
        {!hideHeader && (
          <>
            <MobileHeaderActions />
            <Header />
          </>
        )}
        <main
          className={cn(
            "agent-native-app-main min-h-0 flex-1",
            isDesignEditor || isChatRoute
              ? "overflow-hidden"
              : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );

  return (
    <HeaderActionsProvider>
      <MobileSidebarContext.Provider
        value={standaloneEditor ? null : openMobileSidebar}
      >
        {isChatRoute ? (
          shell
        ) : (
          <AgentSidebar
            position="right"
            chatViewTransition
            chatViewTransitionHandoff={chatHomeHandoffPending}
            openOnChatRunning={chatHomeHandoffActive}
            onFullscreenRequest={openAgentChatFullscreen}
            storageKey={DESIGN_CHAT_STORAGE_KEY}
            agentPageHref="/settings/agent"
            emptyStateText={t("chat.emptyState")}
            suggestions={[
              t("chat.suggestionLandingPage"),
              t("chat.suggestionBrandMatch"),
              t("chat.suggestionMobile"),
            ]}
            scope={designScope}
            chatHistory={designChatHistory}
            showScopeBadge={false}
            browserTabId={browserTabId}
            threadFooterSlot={designQuestionsWaitingSlot}
            onComposerTextChange={handleComposerTextChange}
            composerSlot={
              <>
                <CreativeContextComposerChip />
                {detectedFigmaComposerLink ? (
                  <FigmaLinkComposerBubble link={detectedFigmaComposerLink} />
                ) : null}
              </>
            }
          >
            {shell}
          </AgentSidebar>
        )}
      </MobileSidebarContext.Provider>
    </HeaderActionsProvider>
  );
}
