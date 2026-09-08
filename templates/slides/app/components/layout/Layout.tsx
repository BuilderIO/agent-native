import {
  AgentSidebar,
  focusAgentChat,
  isAgentChatHomeHandoffActive,
  isAssistantChatHistoryVersion,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  type AssistantChatHistoryConfig,
  type AssistantChatHistoryVersion,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { InvitationBanner } from "@agent-native/core/client/org";
import { CreativeContextComposerChip } from "@agent-native/creative-context/client";
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { extractGoogleSlidesUrls } from "@shared/google-docs";
import { IconMenu2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import {
  hasCurrentSlideSelection,
  readPublishedSlidesSelection,
  SLIDES_SELECTION_CHANGED_EVENT,
  type SlidesAgentSelection,
} from "@/lib/slide-agent-context";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { GoogleDriveConnectionCta } from "../editor/GoogleDriveConnectionCta";
import { AgentWorkIndicator } from "./AgentWorkIndicator";
import { Header } from "./Header";
import {
  getEffectiveSlidesSidebarCollapsed,
  isSlidesEditorRoute,
  shouldShowSlidesAppSidebar,
} from "./layout-route-policy";
import { Sidebar } from "./Sidebar";

interface LayoutProps {
  children: React.ReactNode;
}

interface EditorSidebarOverride {
  locationKey: string;
  collapsed: boolean;
}

/** Routes whose pages render their own toolbar — Layout still renders chrome
 * (sidebar + AgentSidebar wrapper) but skips its own Header. */
function pageHasOwnToolbar(pathname: string): boolean {
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return true;
  if (pathname.startsWith("/deck/")) return true;
  // /extensions (list) and /extensions/<id> (viewer) both render their own headers
  // from @agent-native/core/client/extensions.
  if (pathname === "/extensions" || pathname.startsWith("/extensions/"))
    return true;
  return false;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const isChatRoute =
    location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "slides",
    activePath: location.pathname,
    enabled: !isChatRoute,
  });
  const chatHomeHandoffPending = isAgentChatHomeHandoffActive("slides");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [slidesSelection, setSlidesSelection] =
    useState<SlidesAgentSelection | null>(() => readPublishedSlidesSelection());
  const [editorSidebarOverride, setEditorSidebarOverride] =
    useState<EditorSidebarOverride | null>(null);
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } =
    useSidebarCollapsed();
  useEffect(() => {
    const onSelectionChanged = (event: Event) => {
      setSlidesSelection(
        (event as CustomEvent<SlidesAgentSelection | null>).detail ?? null,
      );
    };
    window.addEventListener(SLIDES_SELECTION_CHANGED_EVENT, onSelectionChanged);
    return () =>
      window.removeEventListener(
        SLIDES_SELECTION_CHANGED_EVENT,
        onSelectionChanged,
      );
  }, []);

  // Scope new chats to the deck the user is currently editing. The route
  // is `/deck/:id`; everywhere else (list, presentation) leaves
  // scope null so chats stay in the general pool. Keep the visible label
  // semantic so an imported deck id never leaks into the composer chip.
  const deckScope = useMemo(() => {
    const match = location.pathname.match(/^\/deck\/([^/]+)/);
    const deckId = match?.[1];
    if (!deckId) return null;
    const hasSelection = hasCurrentSlideSelection(slidesSelection, deckId);
    return {
      type: "deck" as const,
      id: deckId,
      label: t(hasSelection ? "agent.currentSelection" : "agent.thisSlide"),
      contextKey: "slides-current-context",
    };
  }, [location.pathname, slidesSelection, t]);
  const deckChatHistory = useMemo<
    AssistantChatHistoryConfig | undefined
  >(() => {
    if (!deckScope) return undefined;
    const deckId = deckScope.id;
    return {
      list: {
        action: "list-deck-versions",
        args: { deckId, limit: 100 },
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
        action: "restore-deck-version",
        args: (version: AssistantChatHistoryVersion) => ({
          deckId,
          versionId: version.id,
        }),
      },
    };
  }, [deckScope]);

  useAgentChatHomeHandoffLinks({
    storageKey: "slides",
    isChatPath: (pathname) =>
      pathname === "/chat" || pathname.startsWith("/chat/"),
    requireActiveHandoff: true,
  });

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const ownToolbar = pageHasOwnToolbar(location.pathname);
  const showAppSidebar = shouldShowSlidesAppSidebar(location.pathname);
  const editorSidebarOverrideForLocation =
    editorSidebarOverride?.locationKey === location.key
      ? editorSidebarOverride.collapsed
      : undefined;
  const effectiveSidebarCollapsed = getEffectiveSlidesSidebarCollapsed({
    pathname: location.pathname,
    persistedCollapsed: sidebarCollapsed,
    editorOverride: editorSidebarOverrideForLocation,
  });
  const toggleSidebarCollapsed = () => {
    if (isSlidesEditorRoute(location.pathname)) {
      setEditorSidebarOverride({
        locationKey: location.key,
        collapsed: !effectiveSidebarCollapsed,
      });
      return;
    }
    void setSidebarCollapsed((prev) => !prev);
  };

  function openAgentChatFullscreen() {
    focusAgentChat();
    const deckQuery = deckScope
      ? `?deckId=${encodeURIComponent(deckScope.id)}`
      : "";
    navigateWithAgentChatViewTransition(navigate, `/chat${deckQuery}`);
  }

  const showMobileNavigation = isChatRoute || !ownToolbar;
  const shell = (
    <div className="agent-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
      {showAppSidebar && (
        <>
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-foreground/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={cn(
              "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 transition-transform duration-200 ease-out md:static md:z-auto md:transition-none",
              sidebarOpen
                ? "translate-x-0"
                : "-translate-x-full rtl:translate-x-full md:translate-x-0 md:rtl:translate-x-0",
            )}
          >
            <Sidebar
              collapsed={effectiveSidebarCollapsed && !sidebarOpen}
              // In the mobile drawer the sidebar is forced expanded, so the
              // desktop collapse toggle would be a silent no-op (worse: it'd
              // mutate the desktop preference). Hide it while the drawer is
              // open.
              onToggleCollapsed={
                sidebarOpen ? undefined : toggleSidebarCollapsed
              }
            />
          </div>
        </>
      )}
      <div className="agent-layout-main-surface flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile-only nav strip with hamburger — only when there's no page toolbar */}
        {showMobileNavigation && (
          <div className="flex h-12 items-center border-b border-border px-4 md:hidden shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label={t("sidebar.openNavigation")}
            >
              <IconMenu2 className="h-4 w-4" />
            </button>
          </div>
        )}
        {!ownToolbar && !isChatRoute && <Header />}
        <InvitationBanner />
        <main
          className={cn(
            "agent-native-app-main min-h-0 flex-1",
            ownToolbar ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
      {!isChatRoute && <AgentWorkIndicator />}
    </div>
  );

  return (
    <HeaderActionsProvider>
      {isChatRoute ? (
        shell
      ) : (
        <AgentSidebar
          position="right"
          defaultOpen={false}
          chatViewTransition
          chatViewTransitionHandoff={chatHomeHandoffPending}
          openOnChatRunning={chatHomeHandoffActive}
          onFullscreenRequest={openAgentChatFullscreen}
          emptyStateText={t("agent.emptyState")}
          suggestions={[
            t("agent.suggestionPitch"),
            t("agent.suggestionBrand"),
            t("agent.suggestionHero"),
          ]}
          scope={deckScope}
          chatHistory={deckChatHistory}
          browserTabId={TAB_ID}
          agentPageHref="/settings/agent"
          suppressFirstRunOnboarding={isSlidesEditorRoute(location.pathname)}
          onComposerTextChange={setComposerText}
          composerSlot={
            <>
              <GoogleDriveConnectionCta
                active={extractGoogleSlidesUrls(composerText).length > 0}
              />
              <CreativeContextComposerChip />
            </>
          }
        >
          {shell}
        </AgentSidebar>
      )}
    </HeaderActionsProvider>
  );
}
