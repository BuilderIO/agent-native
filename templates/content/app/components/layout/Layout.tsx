import type { AssistantChatHistoryVersion } from "@agent-native/core/client/agent-chat";
import { isAssistantChatHistoryVersion } from "@agent-native/core/client/assistant-chat-history-version";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { CreativeContextComposerChip } from "@agent-native/creative-context/client";
import {
  HeaderActionsProvider,
  usePersistentSidebarCollapsed,
} from "@agent-native/toolkit/app-shell";
import { AgentSidebar } from "@agent-native/toolkit/app/chat/AgentSidebar";
import type { AssistantChatHistoryConfig } from "@agent-native/toolkit/app/chat/chat/history-types";
import { InvitationBanner } from "@agent-native/toolkit/app/org";
import type { Document } from "@shared/api";
import { IconMenu2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigation } from "react-router";
import { toast } from "sonner";

import { DocumentEditorSkeleton } from "@/components/editor/DocumentEditorSkeleton";
import { DocumentSidebar } from "@/components/sidebar/DocumentSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useCreatePage } from "@/hooks/use-create-page";
import { useCreativeContextLab } from "@/hooks/use-creative-context-lab";
import { startPageOpenDocumentReads } from "@/hooks/use-documents";
import { useOptimisticDocumentTitle } from "@/hooks/use-optimistic-document-title";
import { openContentCommandMenu } from "@/lib/content-command-menu";
import {
  applyRegisteredDocumentHistoryRestore,
  prepareRegisteredDocumentHistoryRestore,
} from "@/lib/document-history-restore-controller";
import { retirePageOpenReads } from "@/lib/page-open-reads";

import { Header } from "./Header";
import { isContentSettingsRoute } from "./settings-route-policy";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_KEY,
} from "./sidebar-preferences";
import { SidebarTriggerContext } from "./sidebar-trigger";

export const COMPACT_LAYOUT_QUERY = "(max-width: 1099.98px)";

// `/home` draws the page placeholder, with its own toolbar, until it opens the
// landing page.
const NO_HEADER_PREFIXES = ["/page/", "/extensions", "/home"];

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

function useIsCompactLayout() {
  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(COMPACT_LAYOUT_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isNarrow;
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
  const creativeContextEnabled = useCreativeContextLab();
  const fullWidthSettings = isContentSettingsRoute(chromePathname);
  const currentDocumentId = documentPageIdFromPathname(location.pathname);
  const pendingDocumentId = pendingPathname
    ? documentPageIdFromPathname(pendingPathname)
    : null;
  const activeDocumentId = pendingDocumentId ?? currentDocumentId;
  const showPendingDocumentSkeleton =
    !!pendingDocumentId && pendingDocumentId !== currentDocumentId;
  const pendingDocumentTitle = useOptimisticDocumentTitle(pendingDocumentId, {
    enabled: !!pendingDocumentId,
  });
  const queryClient = useQueryClient();
  const pendingSearch = navigation.location?.search ?? "";
  useEffect(() => {
    if (!showPendingDocumentSkeleton || !pendingDocumentId) return;
    const search = new URLSearchParams(pendingSearch);
    startPageOpenDocumentReads(queryClient, pendingDocumentId, {
      databaseId: search.get("databaseId"),
      databaseDocumentId: search.get("databaseDocumentId"),
    });
  }, [
    pendingDocumentId,
    pendingSearch,
    queryClient,
    showPendingDocumentSkeleton,
  ]);
  useEffect(() => {
    if (currentDocumentId) retirePageOpenReads(queryClient, currentDocumentId);
  }, [currentDocumentId, location.key, queryClient]);
  const documentScope = useMemo(
    () =>
      activeDocumentId
        ? { type: "document" as const, id: activeDocumentId }
        : null,
    [activeDocumentId],
  );
  const documentChatHistory = useMemo<
    | AssistantChatHistoryConfig<unknown, AssistantChatHistoryVersion, Document>
    | undefined
  >(() => {
    if (!documentScope) return undefined;
    const documentId = documentScope.id;
    return {
      list: {
        action: "list-document-versions",
        args: (threadId) => ({
          documentId,
          includeContent: false,
          limit: 100,
          ...(threadId ? { threadId } : {}),
        }),
        getVersions: (result: unknown) => {
          const versions =
            result && typeof result === "object"
              ? (result as { versions?: unknown }).versions
              : undefined;
          return Array.isArray(versions)
            ? versions.filter(isAssistantChatHistoryVersion)
            : null;
        },
      },
      restore: {
        action: "restore-document-version",
        args: async (version: AssistantChatHistoryVersion) => ({
          documentId,
          versionId: version.id,
          expectedUpdatedAt: await prepareRegisteredDocumentHistoryRestore(
            documentId,
            t("editor.historySaveBeforeRestoreFailed"),
          ),
        }),
        onRestored: async (restored) => {
          if (restored.id !== documentId) {
            toast.error(t("editor.historyRestoreAppliedRefreshFailed"));
            return;
          }
          try {
            const applied = await applyRegisteredDocumentHistoryRestore(
              documentId,
              restored,
            );
            if (applied) return;
          } catch (error) {
            console.warn(
              "Could not apply the committed chat history restore",
              error,
            );
          }
          toast.error(t("editor.historyRestoreAppliedRefreshFailed"));
        },
      },
    };
  }, [documentScope, t]);
  const isCompactLayout = useIsCompactLayout();
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } =
    usePersistentSidebarCollapsed({
      storageKey: SIDEBAR_COLLAPSED_KEY,
      defaultCollapsed: false,
    });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const openSearchAfterSidebarCloseRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);

  const handleSidebarResize = useCallback((width: number) => {
    const clamped = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, width),
    );
    setSidebarWidth(clamped);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
  }, []);

  const showHeader =
    !fullWidthSettings &&
    !NO_HEADER_PREFIXES.some((prefix) => chromePathname.startsWith(prefix));

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

  useEffect(() => {
    if (isCompactLayout) {
      window.dispatchEvent(new Event("agent-panel:close"));
    }
  }, [isCompactLayout]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.key]);

  const mobileSidebarTrigger = isCompactLayout ? (
    <Button
      ref={sidebarTriggerRef}
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={t("navigation.openSidebar")}
      aria-expanded={mobileSidebarOpen}
      aria-haspopup="dialog"
      className="shrink-0 rounded-lg text-muted-foreground"
      onClick={() => setMobileSidebarOpen(true)}
    >
      <IconMenu2 size={18} />
    </Button>
  ) : null;
  const contentSidebarWidth = isCompactLayout
    ? 0
    : sidebarCollapsed
      ? 48
      : sidebarWidth;

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell flex h-screen overflow-hidden bg-background">
        {isCompactLayout ? (
          <>
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetContent
                side="left"
                showClose={false}
                className="w-[85vw] max-w-80 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
                onCloseAutoFocus={(event) => {
                  if (openSearchAfterSidebarCloseRef.current) {
                    event.preventDefault();
                    openSearchAfterSidebarCloseRef.current = false;
                    openContentCommandMenu(
                      sidebarTriggerRef.current ?? undefined,
                    );
                    return;
                  }
                  if (sidebarTriggerRef.current) {
                    event.preventDefault();
                    sidebarTriggerRef.current.focus();
                  }
                }}
              >
                <SheetTitle className="sr-only">
                  {t("navigation.openSidebar")}
                </SheetTitle>
                <DocumentSidebar
                  activeDocumentId={activeDocumentId}
                  collapsed={false}
                  onToggleCollapsed={() => setMobileSidebarOpen(false)}
                  onNavigate={() => setMobileSidebarOpen(false)}
                  onOpenSearch={() => {
                    openSearchAfterSidebarCloseRef.current = true;
                    setMobileSidebarOpen(false);
                  }}
                />
              </SheetContent>
            </Sheet>
            {showHeader ||
            fullWidthSettings ||
            documentPageIdFromPathname(chromePathname) ||
            chromePathname.startsWith("/home") ? null : (
              <button
                type="button"
                aria-label={t("navigation.openSidebar")}
                className="fixed start-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <IconMenu2 size={18} />
              </button>
            )}
          </>
        ) : fullWidthSettings ? null : (
          <div className="agent-layout-left-drawer flex shrink-0">
            <DocumentSidebar
              activeDocumentId={activeDocumentId}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
              width={sidebarWidth}
              minWidth={MIN_SIDEBAR_WIDTH}
              maxWidth={MAX_SIDEBAR_WIDTH}
              onResize={handleSidebarResize}
            />
          </div>
        )}
        <AgentSidebar
          position="right"
          defaultOpen={false}
          agentPageHref="/settings/agent"
          emptyStateText={t("chat.emptyState")}
          suggestions={[
            t("chat.suggestionPrd"),
            t("chat.suggestionSummary"),
            t("chat.suggestionNotion"),
          ]}
          scope={documentScope}
          chatHistory={documentChatHistory}
          browserTabId={getBrowserTabId()}
          composerSlot={
            creativeContextEnabled ? <CreativeContextComposerChip /> : undefined
          }
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
              className={`${showHeader || fullWidthSettings ? "ps-4" : "ps-16"} sm:ps-4 [&>div]:flex-wrap [&>div]:items-start [&>div>span]:min-w-0 [&>div>span]:flex-1`}
            />
            <SidebarTriggerContext.Provider value={mobileSidebarTrigger}>
              {showPendingDocumentSkeleton ? (
                <DocumentEditorSkeleton title={pendingDocumentTitle} />
              ) : (
                children
              )}
            </SidebarTriggerContext.Provider>
          </main>
        </AgentSidebar>
      </div>
    </HeaderActionsProvider>
  );
}
