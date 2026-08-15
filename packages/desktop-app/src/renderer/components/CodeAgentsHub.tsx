import {
  CodeAgentsApp,
  SessionWatchPanel,
  type CodeAgentComputerSetupAction,
  type CodeAgentModelListResult,
  type CodeAgentPermissionMode,
  type CodeAgentTranscriptEvent,
  type CodeAgentTranscriptRequest,
  type CodeAgentRun,
  type CodeAgentsHost,
  type CodeAgentsNewSessionExtension,
} from "@agent-native/code-agents-ui";
import {
  ChatFirstSurfacePanelToggle,
  chatFirstSurfaceTabId,
  closeChatFirstSessionWatch,
  emitChatFirstOpenApp,
  emitChatFirstSessionWatch,
  getChatFirstSurfaceTabsStore,
  orderChatFirstAppIds,
  readChatFirstAppLayout,
  resolveChatFirstAppTarget,
  resolveChatFirstBrowserTarget,
  subscribeChatFirstOpenBrowser,
  type ChatFirstAppLayoutPreference,
  writeChatFirstAppLayout,
  subscribeChatFirstOpenApp,
  useChatFirstSessionWatch,
  useChatFirstSurfaceResize,
  useChatFirstSurfacePanel,
  useChatFirstSurfaceTabs,
  type ChatFirstAppRegistration,
  type ChatFirstAppResolution,
  type ChatFirstAppSurfacePlacement,
  type ChatFirstOpenAppDetail,
  type ChatFirstOpenBrowserDetail,
  type ChatFirstAgentActivity,
  type ChatFirstSurfaceKind,
  type ChatFirstSurfaceTab,
} from "@agent-native/core/client/agent-chat";
import {
  ChatFirstAgentsPane,
  ChatFirstAppPane,
  ChatFirstAppsRail,
  ChatFirstBrowserPane,
  ChatFirstSessionWatchPane,
  ChatFirstSurfacePanel,
  ChatFirstSurfaceContent,
  ChatFirstSurfaceTabs,
  AppOpenActions,
  defaultChatFirstCopy,
  type ChatFirstAppItem,
  type ChatFirstEmbedTarget,
  type ChatFirstPrimaryTab,
} from "@agent-native/core/client/chat-first";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { cn } from "@agent-native/toolkit";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@agent-native/toolkit/ui/select";
import {
  getDesktopVisibleApps,
  isDesktopAppVisible,
  toAppDefinition,
  type AppConfig,
} from "@shared/app-registry";
import {
  IconArrowLeft,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
  IconPin,
  IconSearch,
  IconSettings,
  IconWorld,
} from "@tabler/icons-react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { DesktopCreateAppResult } from "../../../shared/ipc-channels.js";
import type {
  MultiFrontierIpcEvent,
  MultiFrontierProviderId,
  MultiFrontierRendererState,
} from "../../../shared/multi-frontier-ipc.js";
import type { SubscriptionStatus } from "../../../shared/subscription-status.js";
import {
  DESKTOP_TERMINAL_AGENT_OPTIONS,
  writeDesktopTerminalPreferences,
  useDesktopTerminalPreferences,
} from "../lib/desktop-terminal-preferences.js";
import { useRendererTheme } from "../lib/theme.js";
import AppWebview, {
  resolveAppWebviewUrl,
  type AppWebviewAuthState,
  type AppWebviewHandle,
} from "./AppWebview.js";
import CodeAgentsAppIcon from "./CodeAgentsAppIcon.js";
import CreateAppPromptPopover from "./CreateAppPromptPopover.js";
import DesktopAppChatShell from "./DesktopAppChatShell.js";
import DesktopTerminalSurface, {
  type DesktopTerminalPromptRequest,
} from "./DesktopTerminalSurface.js";
import DesktopTerminalTabs from "./DesktopTerminalTabs.js";
import {
  initialMultiFrontierRunAutoContinue,
  locksMultiFrontierMode,
  providerOperationFailureNotice,
  readNewerMultiFrontierSnapshot,
} from "./multi-frontier-renderer-state.js";
import {
  multiFrontierFailureCategory,
  trackMultiFrontierLifecycle,
} from "./multi-frontier-telemetry.js";
import {
  MultiFrontierParticipantSettings,
  MultiFrontierWorkspace,
  type MultiFrontierNotice,
  type MultiFrontierSecondaryActionInput,
} from "./MultiFrontierWorkspace.js";
import { UpdateIndicator } from "./UpdateIndicator.js";
import { CollapsedMacWindowControls } from "./WindowControls.js";

const agentNativeIconUrl = new URL(
  "../assets/agent-native-icon-dark.svg",
  import.meta.url,
).href;
const codeAgentsQueryClient = createAgentNativeQueryClient();
const CHAT_FIRST_RAIL_COLLAPSED_STORAGE_KEY =
  "agent-native:desktop-chat-first-rail-collapsed";
const MULTI_FRONTIER_PROVIDERS: readonly MultiFrontierProviderId[] = [
  "codex",
  "claude",
];
const MULTI_FRONTIER_RUN_MODES = [
  {
    value: "plan",
    label: "Plan",
    description: "Inspect and propose only",
  },
  {
    value: "auto",
    label: "Auto",
    description: "One agent plans and builds",
  },
  {
    value: "multi-frontier",
    label: "Multi-Frontier",
    description: "Codex + Claude plan, review, then one builds",
  },
] as const;

export function orderDesktopApps<T extends Pick<AppConfig, "id" | "enabled">>(
  apps: readonly T[],
  layout: ChatFirstAppLayoutPreference,
): T[] {
  const visibleApps = getDesktopVisibleApps(apps).filter(
    (app) => app.enabled && app.id !== "agent",
  );
  const orderedVisibleIds = orderChatFirstAppIds(
    visibleApps.map((app) => app.id),
    layout,
  );
  const byId = new Map(visibleApps.map((app) => [app.id, app]));
  return orderedVisibleIds
    .map((id) => byId.get(id))
    .filter((app): app is T => Boolean(app));
}

export function filterDesktopApps<
  T extends { name: string; description?: string },
>(apps: readonly T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...apps];
  return apps.filter((app) => {
    const haystack = [app.name, app.description].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });
}

function chatFirstResolutionMessage(
  reason: Exclude<ChatFirstAppResolution, { status: "ready" }>["reason"],
): string {
  switch (reason) {
    case "empty-detail":
      return "The agent did not provide an app target to open.";
    case "invalid-url":
      return "The requested app route is not registered for this app.";
    case "unknown-app":
      return "That app is not enabled in the desktop workspace.";
  }
  return "The requested app could not be opened.";
}

function chatFirstBrowserResolutionMessage(
  reason: "empty-detail" | "invalid-url",
): string {
  return reason === "empty-detail"
    ? "The agent did not provide a browser URL to open."
    : "The requested browser URL is not a safe HTTP(S) address.";
}

export function isChatFirstSurfaceTabActive(input: {
  surfaceActive: boolean;
  tabId: string;
  activeTabId?: string | null;
}): boolean {
  return input.surfaceActive && input.tabId === input.activeTabId;
}

export function chatFirstPreviewPartitionKey(
  appId: string | undefined,
): string {
  return appId?.trim()
    ? `persist:app-${appId.trim()}`
    : "persist:chat-first-browser";
}

export function chatFirstAppSurfaceTab(
  app: Pick<AppConfig, "id" | "name">,
  path?: string,
  view?: string,
  placement?: ChatFirstAppSurfacePlacement,
): ChatFirstSurfaceTab {
  const target = [app.id, path ?? "/", view ?? ""].join(":");
  return {
    id: chatFirstSurfaceTabId("app", target),
    kind: "app",
    title: app.name,
    appId: app.id,
    ...(placement ? { placement } : {}),
    ...(path ? { path } : {}),
    ...(view ? { view } : {}),
  };
}

const DISPATCH_CONTROL_PLANE_PATHS = [
  "/integrations",
  "/automations",
  "/admin/integrations",
  "/admin/automations",
] as const;

export function isDispatchControlPlanePath(path?: string): boolean {
  if (!path?.trim()) return false;
  const base = "http://agent-native.invalid";
  if (!URL.canParse(path, base)) return false;
  const pathname = new URL(path, base).pathname;
  return DISPATCH_CONTROL_PLANE_PATHS.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function dispatchControlPlaneTitle(path?: string): string | null {
  if (!isDispatchControlPlanePath(path)) return null;
  const pathname = new URL(path!, "http://agent-native.invalid").pathname;
  if (
    pathname === "/integrations" ||
    pathname.startsWith("/integrations/") ||
    pathname === "/admin/integrations" ||
    pathname.startsWith("/admin/integrations/")
  ) {
    return "Integrations";
  }
  return "Automations";
}

function isVisibleChatFirstSurfaceTab(
  tab: ChatFirstSurfaceTab,
  apps: AppConfig[],
): boolean {
  if (tab.kind !== "app" || !tab.appId) return true;
  const app = apps.find(
    (candidate) => candidate.id === tab.appId && candidate.enabled,
  );
  return Boolean(
    app &&
    (isDesktopAppVisible(app) ||
      (app.id === "dispatch" && isDispatchControlPlanePath(tab.path))),
  );
}

export function dispatchControlPlaneUrlParams(
  path?: string,
): Record<string, string | null> {
  return isDispatchControlPlanePath(path)
    ? { embedded: "1", chatFirst: null, electron: "1" }
    : { embedded: "1", chatFirst: "1" };
}

function DesktopAppsGrid({
  apps,
  layout,
  onCreateApp,
  onOpenApp,
  onOpenInBrowser,
  onTogglePinned,
  fullPage = false,
  onBack,
}: {
  apps: AppConfig[];
  layout: ChatFirstAppLayoutPreference;
  onCreateApp?: () => void;
  onOpenApp: (app: AppConfig) => void;
  onOpenInBrowser: (app: AppConfig) => void;
  onTogglePinned: (appId: string) => void;
  fullPage?: boolean;
  onBack?: () => void;
}) {
  const [search, setSearch] = useState("");
  const orderedApps = orderDesktopApps(apps, layout);
  const visibleApps = filterDesktopApps(orderedApps, search);
  const hasSearch = search.trim().length > 0;

  return (
    <section
      className={cn(
        "desktop-apps-grid",
        fullPage && "desktop-apps-grid--full-page",
      )}
      aria-label={fullPage ? "All apps" : "Apps"}
    >
      <div className="desktop-apps-grid__header">
        <div className="desktop-apps-grid__heading">
          {fullPage && onBack ? (
            <button
              type="button"
              className="desktop-apps-grid__back"
              onClick={onBack}
            >
              <IconArrowLeft size={14} aria-hidden="true" />
              <span>Back to chats</span>
            </button>
          ) : null}
          <h3 className="desktop-apps-grid__title">
            {fullPage ? "All apps" : "Apps"}
          </h3>
        </div>
        <div className="desktop-apps-grid__actions">
          <label className="desktop-apps-grid__search">
            <IconSearch size={14} aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              className="desktop-apps-grid__search-input"
              placeholder="Search apps"
              aria-label="Search apps"
            />
          </label>
          {onCreateApp ? (
            <button
              type="button"
              className="desktop-apps-grid__action desktop-apps-grid__action--primary"
              onClick={onCreateApp}
            >
              <IconPlus size={14} aria-hidden="true" />
              <span>New</span>
            </button>
          ) : null}
        </div>
      </div>
      {visibleApps.length === 0 ? (
        <div className="desktop-apps-grid__empty" role="status">
          <p className="desktop-apps-grid__empty-title">
            {hasSearch ? `No apps match “${search.trim()}”.` : "No apps yet."}
          </p>
          <p className="desktop-apps-grid__empty-description">
            {hasSearch
              ? "Try a different name or description."
              : "Create or enable an app to show it here."}
          </p>
          {hasSearch ? (
            <button
              type="button"
              className="desktop-apps-grid__empty-action"
              onClick={() => setSearch("")}
            >
              Clear search
            </button>
          ) : null}
        </div>
      ) : (
        <div className="desktop-apps-grid__list">
          {visibleApps.map((app) => {
            const pinned = layout.pinnedIds.includes(app.id);
            return (
              <div key={app.id} className="desktop-app-card">
                <button
                  type="button"
                  className="desktop-app-card__body"
                  data-desktop-app-card
                  data-app-id={app.id}
                  onClick={() => onOpenApp(app)}
                  aria-label={`Open ${app.name}`}
                >
                  <span className="desktop-app-card__icon" aria-hidden="true">
                    <CodeAgentsAppIcon
                      id={app.id}
                      name={app.name}
                      icon={app.icon}
                      color={app.color}
                    />
                  </span>
                  <span className="desktop-app-card__copy">
                    <span className="desktop-app-card__name">{app.name}</span>
                    <span className="desktop-app-card__description">
                      {app.description}
                    </span>
                  </span>
                </button>
                <AppOpenActions
                  name={app.name}
                  labels={{ openApp: "Open" }}
                  onOpen={() => onOpenApp(app)}
                  className="desktop-app-card__actions"
                  menuItems={[
                    {
                      id: "browser",
                      label: "Open in browser",
                      icon: <IconWorld size={14} />,
                      onSelect: () => onOpenInBrowser(app),
                    },
                    {
                      id: "pin",
                      label: pinned ? "Unpin from top" : "Pin to top",
                      icon: (
                        <IconPin size={14} strokeWidth={pinned ? 2.2 : 1.6} />
                      ),
                      onSelect: () => onTogglePinned(app.id),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface CodeAgentsHubProps {
  apps: AppConfig[];
  isActive?: boolean;
  openRequest?: { goalId?: string; runId?: string; nonce: number };
  chatFirstAppOpenRequest?: { appId: string; path?: string; nonce: number };
  chatFirstPreviewRequest?: { appId: string; nonce: number };
  chatFirstPreviewStatus?: "starting" | "ready" | "error";
  chatFirstPreviewStatusMessage?: string;
  refreshKey?: number;
  onOpenSettings?: () => void;
  onCreateApp?: () => void;
  onChatFirstAppCreated?: (result: DesktopCreateAppResult) => void;
  onChatFirstAppRemove?: (app: ChatFirstAppItem) => void;
  onChatFirstAppSelectionChange?: (appId?: string) => void;
}

type CodeAgentTranscriptSubscriptionBatch = {
  status: "ok" | "unavailable";
  runId?: string;
  events: CodeAgentTranscriptEvent[];
  eventFile?: string;
  error?: string;
  subscriptionId?: string;
  reason?: string;
};

interface CodeAgentsHostWithTranscriptSubscription extends CodeAgentsHost {
  subscribeTranscript?(
    request: CodeAgentTranscriptRequest,
    cb: (batch: CodeAgentTranscriptSubscriptionBatch) => void,
  ): () => void;
}

export default function CodeAgentsHub({
  apps,
  isActive = true,
  openRequest,
  chatFirstAppOpenRequest,
  chatFirstPreviewRequest,
  chatFirstPreviewStatus,
  chatFirstPreviewStatusMessage,
  refreshKey = 0,
  onOpenSettings,
  onCreateApp,
  onChatFirstAppCreated,
  onChatFirstAppRemove,
  onChatFirstAppSelectionChange,
}: CodeAgentsHubProps) {
  const theme = useRendererTheme();
  const terminalPreferences = useDesktopTerminalPreferences();
  const emitChatFirstOpenAppStable = useCallback(
    (detail: ChatFirstOpenAppDetail) => emitChatFirstOpenApp(detail),
    [],
  );
  const chatFirstSurfaceTabs = useChatFirstSurfaceTabs("desktop");
  const chatFirstSurfaceTabsStore = getChatFirstSurfaceTabsStore("desktop");
  const chatFirstSurfaceResize = useChatFirstSurfaceResize("desktop");
  const chatFirstSurfacePanel = useChatFirstSurfacePanel("desktop");
  const { setOpen: setChatFirstSurfacePanelOpen } = chatFirstSurfacePanel;
  const [chatFirstAppLayout, setChatFirstAppLayout] =
    useState<ChatFirstAppLayoutPreference>(() => readChatFirstAppLayout());
  const [chatFirstAppAuthStates, setChatFirstAppAuthStates] = useState<
    Record<string, AppWebviewAuthState>
  >({});
  const chatFirstAppWebviewRefs = useRef(new Map<string, AppWebviewHandle>());
  const handleChatFirstAppAuthStateChange = useCallback(
    (appId: string, state: AppWebviewAuthState) => {
      setChatFirstAppAuthStates((current) =>
        current[appId] === state ? current : { ...current, [appId]: state },
      );
    },
    [],
  );
  const focusChatFirstApp = useCallback((tabId: string) => {
    chatFirstAppWebviewRefs.current.get(tabId)?.focus();
  }, []);
  const chatFirstSessionWatch = useChatFirstSessionWatch();
  const [chatFirstWatchedRun, setChatFirstWatchedRun] =
    useState<CodeAgentRun | null>(null);
  const [chatFirstWatchedSourceRunId, setChatFirstWatchedSourceRunId] =
    useState<string | null>(null);
  const [chatFirstAgentActivities, setChatFirstAgentActivities] = useState<
    ChatFirstAgentActivity[]
  >([]);
  const previousChatFirstSurfaceTabCountRef = useRef<number | null>(null);
  const visibleChatFirstSurfaceTabs = useMemo(
    () =>
      chatFirstSurfaceTabs.tabs.filter(
        (tab) =>
          isVisibleChatFirstSurfaceTab(tab, apps) &&
          !(terminalPreferences.enabled && tab.kind === "terminal"),
      ),
    [apps, chatFirstSurfaceTabs.tabs, terminalPreferences.enabled],
  );
  const visibleActiveChatFirstSurfaceTabId = visibleChatFirstSurfaceTabs.some(
    (tab) => tab.id === chatFirstSurfaceTabs.activeTabId,
  )
    ? chatFirstSurfaceTabs.activeTabId
    : visibleChatFirstSurfaceTabs[0]?.id;
  const activeChatFirstSurfaceTab = useMemo(
    () =>
      visibleChatFirstSurfaceTabs.find(
        (tab) => tab.id === visibleActiveChatFirstSurfaceTabId,
      ) ?? null,
    [visibleActiveChatFirstSurfaceTabId, visibleChatFirstSurfaceTabs],
  );
  const chatFirstDefaultInitializedRef = useRef(false);
  useEffect(() => {
    if (chatFirstDefaultInitializedRef.current) return;
    chatFirstDefaultInitializedRef.current = true;
    closeChatFirstSessionWatch();
    chatFirstSurfaceTabsStore.closeAll();
    setChatFirstSurfacePanelOpen(false);
  }, [chatFirstSurfaceTabsStore, setChatFirstSurfacePanelOpen]);
  const chatFirstAppTakesMain =
    activeChatFirstSurfaceTab?.kind === "app" &&
    activeChatFirstSurfaceTab.placement === "main";
  const chatFirstAppSelected = activeChatFirstSurfaceTab?.kind === "app";
  const activeChatFirstPrimaryTab = useMemo<
    ChatFirstPrimaryTab | undefined
  >(() => {
    if (
      !chatFirstAppSelected ||
      activeChatFirstSurfaceTab?.kind !== "app" ||
      activeChatFirstSurfaceTab.appId !== "dispatch"
    ) {
      return chatFirstAppSelected ? undefined : "new-chat";
    }
    if (
      activeChatFirstSurfaceTab.path === "/admin/integrations" ||
      activeChatFirstSurfaceTab.path === "/integrations"
    ) {
      return "integrations";
    }
    if (
      activeChatFirstSurfaceTab.path === "/admin/automations" ||
      activeChatFirstSurfaceTab.path === "/automations"
    ) {
      return "scheduled";
    }
    return undefined;
  }, [activeChatFirstSurfaceTab, chatFirstAppSelected]);
  const [chatFirstBrowserSelection, setChatFirstBrowserSelection] = useState<{
    url: string;
    title?: string;
  } | null>(null);
  const [chatFirstAllAppsOpen, setChatFirstAllAppsOpen] = useState(false);
  const [hasChatFirstChats, setHasChatFirstChats] = useState(false);
  const [hasChatFirstActiveChat, setHasChatFirstActiveChat] = useState(false);
  const [terminalSessionStarted, setTerminalSessionStarted] = useState(false);
  const [terminalPromptRequest, setTerminalPromptRequest] =
    useState<DesktopTerminalPromptRequest | null>(null);
  const [chatFirstNotice, setChatFirstNotice] = useState<string | null>(null);
  const [chatFirstRailCollapsed, setChatFirstRailCollapsed] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.localStorage.getItem(CHAT_FIRST_RAIL_COLLAPSED_STORAGE_KEY) ===
        "1",
  );
  const handledChatFirstAppOpenNonceRef = useRef<number | null>(null);
  const handledChatFirstPreviewNonceRef = useRef<number | null>(null);
  const terminalPromptSequence = useRef(0);
  const [multiFrontierMode, setMultiFrontierMode] = useState(false);
  const [multiFrontierState, setMultiFrontierState] =
    useState<MultiFrontierRendererState>();
  const [multiFrontierSubscriptions, setMultiFrontierSubscriptions] = useState<
    Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>
  >({});
  const [multiFrontierDefaultSettings, setMultiFrontierDefaultSettings] =
    useState<MultiFrontierSettings>({ autoContinueAfterAgreement: false });
  const [multiFrontierRunAutoContinue, setMultiFrontierRunAutoContinue] =
    useState(false);
  const [multiFrontierBusy, setMultiFrontierBusy] = useState(false);
  const [multiFrontierNotices, setMultiFrontierNotices] = useState<
    MultiFrontierNotice[]
  >([]);
  const [multiFrontierOpenDetailRequest, setMultiFrontierOpenDetailRequest] =
    useState<{ detailId: string; nonce: number }>();
  const multiFrontierSequence = useRef(-1);
  const multiFrontierSettingsHydrated = useRef(false);
  const multiFrontierDetailNonce = useRef(0);
  const multiFrontierNoticeNonce = useRef(0);
  const multiFrontierActivationTracked = useRef(false);
  const multiFrontierLastPhaseTelemetry = useRef("");
  const multiFrontierLastProviderTelemetry = useRef<
    Partial<Record<MultiFrontierProviderId, string>>
  >({});
  const activeMultiFrontierCollaborationId =
    multiFrontierState?.collaborationId;
  const multiFrontierModeLocked = locksMultiFrontierMode(multiFrontierState);

  const openChatFirstApp = useCallback(
    (
      appId: string,
      path?: string,
      view?: string,
      placement: ChatFirstAppSurfacePlacement = "main",
    ) => {
      const app = apps.find(
        (candidate) => candidate.id === appId && candidate.enabled,
      );
      if (!app) {
        setChatFirstNotice("That app is not enabled in the desktop workspace.");
        return;
      }
      const dispatchControlPlane =
        app.id === "dispatch" && isDispatchControlPlanePath(path);
      if (!isDesktopAppVisible(app) && !dispatchControlPlane) {
        setChatFirstNotice(
          "That app is not available in the desktop workspace.",
        );
        return;
      }
      setChatFirstRailCollapsed(true);
      setChatFirstAllAppsOpen(false);
      window.electronAPI?.setActiveApp?.(app.id);
      setChatFirstNotice(null);
      setChatFirstBrowserSelection(null);
      closeChatFirstSessionWatch();
      const surfaceTab = chatFirstAppSurfaceTab(app, path, view, placement);
      chatFirstSurfaceTabsStore.open(
        dispatchControlPlane
          ? {
              ...surfaceTab,
              title: dispatchControlPlaneTitle(path) ?? surfaceTab.title,
            }
          : surfaceTab,
      );
      setChatFirstSurfacePanelOpen(true);
    },
    [apps, chatFirstSurfaceTabsStore, setChatFirstSurfacePanelOpen],
  );

  useEffect(() => {
    if (
      !isActive ||
      !chatFirstAppOpenRequest ||
      handledChatFirstAppOpenNonceRef.current === chatFirstAppOpenRequest.nonce
    ) {
      return;
    }
    const app = apps.find(
      (candidate) =>
        candidate.id === chatFirstAppOpenRequest.appId && candidate.enabled,
    );
    if (!app) return;
    handledChatFirstAppOpenNonceRef.current = chatFirstAppOpenRequest.nonce;
    openChatFirstApp(app.id, chatFirstAppOpenRequest.path, undefined, "main");
  }, [apps, chatFirstAppOpenRequest, isActive, openChatFirstApp]);

  useEffect(() => {
    const appId =
      isActive && activeChatFirstSurfaceTab?.kind === "app"
        ? activeChatFirstSurfaceTab.appId
        : undefined;
    onChatFirstAppSelectionChange?.(appId);
  }, [
    activeChatFirstSurfaceTab?.appId,
    activeChatFirstSurfaceTab?.kind,
    isActive,
    onChatFirstAppSelectionChange,
  ]);

  const chatFirstAppRegistrations = useMemo<ChatFirstAppRegistration[]>(
    () =>
      apps.map((app) => ({
        id: app.id,
        name: app.name,
        url: app.url,
        devUrl: app.devUrl,
        enabled: app.enabled,
      })),
    [apps],
  );
  const chatFirstAppItems = useMemo<ChatFirstAppItem[]>(
    () =>
      getDesktopVisibleApps(apps)
        .filter((app) => app.enabled && app.id !== "agent")
        .map((app) => ({
          id: app.id,
          name: app.name,
          ...(app.icon ? { icon: app.icon } : {}),
          ...(app.color ? { color: app.color } : {}),
        })),
    [apps],
  );
  const toggleChatFirstAppPinned = useCallback((appId: string) => {
    setChatFirstAppLayout((layout) => {
      const pinnedIds = layout.pinnedIds.includes(appId)
        ? layout.pinnedIds.filter((id) => id !== appId)
        : [appId, ...layout.pinnedIds];
      const next = { ...layout, pinnedIds };
      writeChatFirstAppLayout(next);
      return next;
    });
  }, []);
  const returnToChatFirstChats = useCallback(() => {
    setChatFirstAllAppsOpen(false);
    setTerminalSessionStarted(false);
    setTerminalPromptRequest(null);
    closeChatFirstSessionWatch();
    setChatFirstBrowserSelection(null);
    chatFirstSurfaceTabsStore.closeAll();
    setChatFirstSurfacePanelOpen(false);
  }, [chatFirstSurfaceTabsStore, setChatFirstSurfacePanelOpen]);
  const handleTerminalPromptSubmit = useCallback((prompt: string) => {
    const request: DesktopTerminalPromptRequest = {
      id: ++terminalPromptSequence.current,
      text: prompt,
    };
    setTerminalPromptRequest(request);
    setTerminalSessionStarted(true);
  }, []);
  const handleTerminalPromptSubmitted = useCallback(
    (request: DesktopTerminalPromptRequest) => {
      setTerminalPromptRequest((current) =>
        current?.id === request.id ? null : current,
      );
    },
    [],
  );
  const handleTerminalModeChange = useCallback((enabled: boolean) => {
    writeDesktopTerminalPreferences({ enabled });
  }, []);
  const openChatFirstAllApps = useCallback(() => {
    setChatFirstAllAppsOpen(true);
    closeChatFirstSessionWatch();
    setChatFirstBrowserSelection(null);
    chatFirstSurfaceTabsStore.closeAll();
    setChatFirstSurfacePanelOpen(false);
  }, [chatFirstSurfaceTabsStore, setChatFirstSurfacePanelOpen]);
  const chatFirstNavigation = useMemo(
    () => ({
      activeTab: activeChatFirstPrimaryTab,
      onNewChat: returnToChatFirstChats,
      onOpenChats: returnToChatFirstChats,
      onOpenAllApps: openChatFirstAllApps,
      onOpenIntegrations: () => openChatFirstApp("dispatch", "/integrations"),
      onOpenScheduled: () => openChatFirstApp("dispatch", "/automations"),
    }),
    [
      activeChatFirstPrimaryTab,
      openChatFirstApp,
      openChatFirstAllApps,
      returnToChatFirstChats,
    ],
  );
  const openChatFirstAppFromRail = useCallback(
    (app: ChatFirstAppItem) =>
      openChatFirstApp(
        app.id,
        undefined,
        undefined,
        terminalPreferences.enabled ? "side" : "main",
      ),
    [openChatFirstApp, terminalPreferences.enabled],
  );
  const openChatFirstAppFromGrid = useCallback(
    (app: AppConfig) =>
      openChatFirstApp(
        app.id,
        undefined,
        undefined,
        terminalPreferences.enabled ? "side" : "main",
      ),
    [openChatFirstApp, terminalPreferences.enabled],
  );
  const openChatFirstAppInBrowser = useCallback((app: AppConfig) => {
    const url = resolveAppWebviewUrl(toAppDefinition(app), app);
    if (url === "about:blank") return;
    void window.electronAPI.shell.openExternal(url);
  }, []);
  const renderChatFirstAppIcon = useCallback(
    (
      app: ChatFirstAppItem,
      { isInactive }: { isInactive: boolean } = { isInactive: false },
    ) => (
      <CodeAgentsAppIcon
        id={app.id}
        name={app.name}
        icon={app.icon}
        color={app.color}
        monochrome={isInactive}
      />
    ),
    [],
  );
  const chatFirstRailWorkspaceSlot = useMemo(() => {
    return (
      <>
        {chatFirstNotice ? (
          <div
            className="flex items-start gap-1.5 border-b border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive"
            role="status"
            aria-live="polite"
            data-chat-first-notice
          >
            <span className="min-w-0 flex-1">{chatFirstNotice}</span>
            <button
              type="button"
              className="shrink-0 font-semibold underline underline-offset-2"
              onClick={() => setChatFirstNotice(null)}
            >
              {defaultChatFirstCopy("dismiss")}
            </button>
          </div>
        ) : null}
        <ChatFirstAppsRail
          apps={chatFirstAppItems}
          activeAppId={
            activeChatFirstSurfaceTab?.kind === "app"
              ? activeChatFirstSurfaceTab.appId
              : undefined
          }
          collapsed={chatFirstRailCollapsed}
          layout={chatFirstAppLayout}
          createAppTrigger={
            onChatFirstAppCreated ? (
              <CreateAppPromptPopover onCreated={onChatFirstAppCreated} />
            ) : undefined
          }
          onCreateApp={onCreateApp}
          onLayoutChange={(layout) => {
            setChatFirstAppLayout(layout);
          }}
          onRemoveApp={onChatFirstAppRemove}
          onOpenAllApps={openChatFirstAllApps}
          onOpenApp={openChatFirstAppFromRail}
          renderIcon={renderChatFirstAppIcon}
          copy={defaultChatFirstCopy}
        />
      </>
    );
  }, [
    activeChatFirstSurfaceTab?.appId,
    activeChatFirstSurfaceTab?.kind,
    chatFirstAppItems,
    chatFirstRailCollapsed,
    chatFirstNotice,
    onChatFirstAppCreated,
    onChatFirstAppRemove,
    onCreateApp,
    openChatFirstAllApps,
    openChatFirstAppFromRail,
    renderChatFirstAppIcon,
  ]);

  const resolveChatFirstOpenApp = useCallback(
    (detail: ChatFirstOpenAppDetail) => {
      const resolution = resolveChatFirstAppTarget(
        detail,
        chatFirstAppRegistrations,
      );
      if (resolution.status === "unresolved") {
        setChatFirstNotice(chatFirstResolutionMessage(resolution.reason));
        return;
      }
      openChatFirstApp(
        resolution.target.appId,
        resolution.target.path,
        resolution.target.view,
        "side",
      );
    },
    [chatFirstAppRegistrations, openChatFirstApp],
  );

  const resolveChatFirstOpenBrowser = useCallback(
    (detail: ChatFirstOpenBrowserDetail) => {
      const resolution = resolveChatFirstBrowserTarget(detail);
      if (resolution.status === "unresolved") {
        setChatFirstNotice(
          chatFirstBrowserResolutionMessage(resolution.reason),
        );
        return;
      }
      setChatFirstNotice(null);
      closeChatFirstSessionWatch();
      chatFirstSurfaceTabsStore.open({
        id: chatFirstSurfaceTabId("browser", resolution.target.url),
        kind: "browser",
        title: resolution.target.title ?? "Browser",
        url: resolution.target.url,
      });
      setChatFirstBrowserSelection(resolution.target);
    },
    [chatFirstSurfaceTabsStore],
  );

  useEffect(() => {
    const request = chatFirstPreviewRequest;
    if (!request || handledChatFirstPreviewNonceRef.current === request.nonce) {
      return;
    }
    const app = apps.find(
      (candidate) => candidate.id === request.appId && candidate.enabled,
    );
    if (!app) return;
    handledChatFirstPreviewNonceRef.current = request.nonce;
    if (!app.devUrl?.trim()) {
      setChatFirstNotice(
        `${app.name} is building locally, but it has not published a preview URL yet.`,
      );
      return;
    }
    resolveChatFirstOpenBrowser({
      url: app.devUrl,
      title: `${app.name} preview`,
    });
  }, [apps, chatFirstPreviewRequest, resolveChatFirstOpenBrowser]);

  useEffect(() => {
    window.localStorage.setItem(
      CHAT_FIRST_RAIL_COLLAPSED_STORAGE_KEY,
      chatFirstRailCollapsed ? "1" : "0",
    );
  }, [chatFirstRailCollapsed]);

  useEffect(() => {
    if (window.electronAPI?.platform !== "darwin") return;
    const setNativeTrafficLightsVisible =
      window.electronAPI.windowControls?.setNativeTrafficLightsVisible;
    if (!setNativeTrafficLightsVisible) return;
    setNativeTrafficLightsVisible(!chatFirstRailCollapsed);
  }, [chatFirstRailCollapsed]);

  useEffect(() => {
    setChatFirstBrowserSelection(null);
    setChatFirstNotice(null);
    const unsubscribeApp = subscribeChatFirstOpenApp(resolveChatFirstOpenApp);
    const unsubscribeBrowser = subscribeChatFirstOpenBrowser(
      resolveChatFirstOpenBrowser,
    );
    return () => {
      unsubscribeApp();
      unsubscribeBrowser();
    };
  }, [
    chatFirstSurfaceTabsStore,
    resolveChatFirstOpenApp,
    resolveChatFirstOpenBrowser,
  ]);

  useEffect(() => {
    const target = chatFirstSessionWatch.target;
    if (!target) return;
    setChatFirstBrowserSelection(null);
    chatFirstSurfaceTabsStore.open({
      id: chatFirstSurfaceTabId("side-chat", target.sessionId),
      kind: "side-chat",
      title: target.title ? `Watch · ${target.title}` : "Watched session",
      session: target,
    });
  }, [chatFirstSessionWatch.target, chatFirstSurfaceTabsStore]);

  useEffect(() => {
    const tabCount = visibleChatFirstSurfaceTabs.length;
    const previousTabCount = previousChatFirstSurfaceTabCountRef.current;
    if (!hasChatFirstActiveChat && !terminalPreferences.enabled) {
      setChatFirstSurfacePanelOpen(false);
    } else if (
      tabCount > 0 &&
      (previousTabCount === null || previousTabCount === 0)
    ) {
      setChatFirstSurfacePanelOpen(true);
    } else if (
      tabCount === 0 &&
      previousTabCount !== null &&
      previousTabCount > 0
    ) {
      setChatFirstSurfacePanelOpen(false);
    }
    previousChatFirstSurfaceTabCountRef.current = tabCount;
  }, [
    hasChatFirstActiveChat,
    setChatFirstSurfacePanelOpen,
    terminalPreferences.enabled,
    visibleChatFirstSurfaceTabs.length,
  ]);

  useEffect(() => {
    if (!terminalPreferences.enabled) return;
    for (const tab of chatFirstSurfaceTabs.tabs) {
      if (tab.kind === "terminal") chatFirstSurfaceTabsStore.close(tab.id);
    }
  }, [
    chatFirstSurfaceTabs.tabs,
    chatFirstSurfaceTabsStore,
    terminalPreferences.enabled,
  ]);

  useEffect(() => {
    if (terminalPreferences.enabled) return;
    setTerminalSessionStarted(false);
    setTerminalPromptRequest(null);
  }, [terminalPreferences.enabled]);

  useEffect(() => {
    const activeTab = activeChatFirstSurfaceTab;
    if (
      activeTab?.kind !== "side-chat" ||
      !activeTab.session ||
      chatFirstSessionWatch.target
    ) {
      return;
    }
    emitChatFirstSessionWatch(activeTab.session);
  }, [activeChatFirstSurfaceTab, chatFirstSessionWatch.target]);

  const activateChatFirstSurfaceTab = useCallback(
    (tab: ChatFirstSurfaceTab) => {
      chatFirstSurfaceTabsStore.activate(tab.id);
      if (tab.kind === "app" && tab.appId) {
        closeChatFirstSessionWatch();
        setChatFirstBrowserSelection(null);
        return;
      }
      if (tab.kind === "browser" && tab.url) {
        closeChatFirstSessionWatch();
        setChatFirstBrowserSelection({ url: tab.url, title: tab.title });
        return;
      }
      if (tab.kind === "side-chat" && tab.session) {
        setChatFirstBrowserSelection(null);
        emitChatFirstSessionWatch(tab.session);
      }
    },
    [chatFirstSurfaceTabsStore],
  );

  const closeChatFirstSurfaceTab = useCallback(
    (tab: ChatFirstSurfaceTab) => {
      const isActive = chatFirstSurfaceTabs.activeTabId === tab.id;
      if (tab.kind === "browser") setChatFirstBrowserSelection(null);
      if (tab.kind === "side-chat" && isActive) {
        closeChatFirstSessionWatch();
      }
      chatFirstSurfaceTabsStore.close(tab.id);
    },
    [chatFirstSurfaceTabs, chatFirstSurfaceTabsStore],
  );

  const closeAllChatFirstSurfaceTabs = useCallback(() => {
    setChatFirstBrowserSelection(null);
    closeChatFirstSessionWatch();
    chatFirstSurfaceTabsStore.closeAll();
  }, [chatFirstSurfaceTabsStore]);

  useEffect(() => {
    for (const tab of chatFirstSurfaceTabs.tabs) {
      if (tab.kind !== "app" || !tab.appId) continue;
      const app = apps.find(
        (candidate) => candidate.id === tab.appId && candidate.enabled,
      );
      const dispatchControlPlane =
        app?.id === "dispatch" && isDispatchControlPlanePath(tab.path);
      if (!app || (!isDesktopAppVisible(app) && !dispatchControlPlane)) {
        chatFirstSurfaceTabsStore.close(tab.id);
      }
    }
  }, [apps, chatFirstSurfaceTabs.tabs, chatFirstSurfaceTabsStore]);

  const openChatFirstSurface = useCallback(
    (kind: ChatFirstSurfaceKind) => {
      if (kind === "browser") {
        setChatFirstBrowserSelection({
          url: "https://www.google.com/",
          title: "Browser",
        });
        chatFirstSurfaceTabsStore.open({
          id: chatFirstSurfaceTabId("browser", "homepage"),
          kind: "browser",
          title: "Browser",
          url: "https://www.google.com/",
        });
        return;
      }
      if (kind === "terminal") {
        if (terminalPreferences.enabled) return;
        closeChatFirstSessionWatch();
        chatFirstSurfaceTabsStore.open({
          id: chatFirstSurfaceTabId("terminal", "desktop"),
          kind: "terminal",
          title: "Terminal",
        });
        setChatFirstSurfacePanelOpen(true);
        return;
      }
      if (kind !== "agents") return;
      closeChatFirstSessionWatch();
      chatFirstSurfaceTabsStore.open({
        id: chatFirstSurfaceTabId(kind, "activity"),
        kind,
        title: "Agents",
      });
    },
    [
      chatFirstSurfaceTabsStore,
      setChatFirstSurfacePanelOpen,
      terminalPreferences.enabled,
    ],
  );

  const watchChatFirstAgent = useCallback(
    (activity: ChatFirstAgentActivity) => {
      emitChatFirstSessionWatch({
        sessionId: activity.sessionId,
        title: activity.title,
        kind: "code-agent",
        ...(activity.goalId ? { goalId: activity.goalId } : {}),
      });
    },
    [],
  );

  const handleChatFirstRunsChange = useCallback((runs: CodeAgentRun[]) => {
    setHasChatFirstChats(runs.length > 0);
    const nextActivities = runs.map((run) => ({
      sessionId: run.id,
      title: run.title || "Untitled agent session",
      subtitle: run.subtitle || run.phase,
      status: run.status,
      updatedAt: run.updatedAt,
      progressPercent: run.progress?.percent,
      goalId: run.goalId,
    }));
    setChatFirstAgentActivities((current) =>
      areChatFirstAgentActivitiesEqual(current, nextActivities)
        ? current
        : nextActivities,
    );
  }, []);

  const handleChatFirstWatchedRunChange = useCallback(
    (run: CodeAgentRun | null, sourceRunId?: string | null) => {
      setChatFirstWatchedRun(run);
      setChatFirstWatchedSourceRunId(sourceRunId ?? null);
    },
    [],
  );

  const appendMultiFrontierNotice = useCallback(
    (notice: MultiFrontierNotice) => {
      setMultiFrontierNotices((current) =>
        [
          ...current.filter((currentNotice) => currentNotice.id !== notice.id),
          notice,
        ].slice(-8),
      );
    },
    [],
  );

  const appendProviderOperationFailure = useCallback(
    (
      providerId: MultiFrontierProviderId,
      operation: "connect" | "refresh" | "load",
    ) => {
      multiFrontierNoticeNonce.current += 1;
      appendMultiFrontierNotice(
        providerOperationFailureNotice(
          providerId,
          operation,
          `subscription:${providerId}:${operation}:${multiFrontierNoticeNonce.current}`,
        ),
      );
      trackMultiFrontierLifecycle({
        kind: "failure",
        category: operation === "connect" ? "auth" : "provider",
      });
    },
    [appendMultiFrontierNotice],
  );

  const applyMultiFrontierSnapshot = useCallback(
    (snapshot: MultiFrontierRendererState | undefined) => {
      if (!snapshot) return;
      setMultiFrontierState(snapshot);
      setMultiFrontierSubscriptions((current) => ({
        ...current,
        ...snapshot.subscriptions,
      }));
    },
    [],
  );

  const applyMultiFrontierEvent = useCallback(
    (event: MultiFrontierIpcEvent) => {
      const collaborationId = activeMultiFrontierCollaborationId;
      if (!collaborationId) return;
      const next = readNewerMultiFrontierSnapshot(
        collaborationId,
        multiFrontierSequence.current,
        event,
      );
      if (!next) return;
      multiFrontierSequence.current = next.sequence;
      applyMultiFrontierSnapshot(next.snapshot);
      if (next.notice) {
        appendMultiFrontierNotice(next.notice);
      }
    },
    [
      appendMultiFrontierNotice,
      applyMultiFrontierSnapshot,
      activeMultiFrontierCollaborationId,
    ],
  );

  useEffect(() => {
    if (!multiFrontierMode) {
      multiFrontierActivationTracked.current = false;
      return;
    }
    if (multiFrontierActivationTracked.current) return;
    multiFrontierActivationTracked.current = true;
    trackMultiFrontierLifecycle({
      kind: "mode_activation",
      autoContinueAfterAgreement: multiFrontierRunAutoContinue,
    });
  }, [multiFrontierMode, multiFrontierRunAutoContinue]);

  useEffect(() => {
    if (!multiFrontierState) return;
    const checkpointCount = multiFrontierState.artifacts.filter(
      (artifact) => artifact.kind === "checkpoint",
    ).length;
    const reviewCount = multiFrontierState.artifacts.filter(
      (artifact) => artifact.kind === "review",
    ).length;
    const key = [
      multiFrontierState.phase,
      multiFrontierState.round,
      multiFrontierState.approvalState,
      checkpointCount,
      reviewCount,
      multiFrontierState.requiresPlanningPrompt === true,
    ].join(":");
    if (multiFrontierLastPhaseTelemetry.current === key) return;
    multiFrontierLastPhaseTelemetry.current = key;
    trackMultiFrontierLifecycle({
      kind: "phase",
      phase: multiFrontierState.phase,
      round: multiFrontierState.round,
      approvalState: multiFrontierState.approvalState,
      autoContinueAfterAgreement:
        multiFrontierState.autoContinueAfterAgreement ?? false,
      checkpointCount,
      reviewCount,
      requiresPlanningPrompt:
        multiFrontierState.requiresPlanningPrompt === true,
    });
  }, [multiFrontierState]);

  useEffect(() => {
    for (const providerId of MULTI_FRONTIER_PROVIDERS) {
      const status = multiFrontierSubscriptions[providerId];
      if (!status) continue;
      const key = [
        status.connectionState,
        status.telemetry.state,
        status.telemetry.capabilities.rateLimits,
        status.telemetry.capabilities.liveUpdates,
      ].join(":");
      if (multiFrontierLastProviderTelemetry.current[providerId] === key) {
        continue;
      }
      multiFrontierLastProviderTelemetry.current[providerId] = key;
      trackMultiFrontierLifecycle({
        kind: "provider_status",
        providerId,
        connectionState: status.connectionState,
        telemetryState: status.telemetry.state,
        hasRateLimits: status.telemetry.capabilities.rateLimits,
        hasLiveUpdates: status.telemetry.capabilities.liveUpdates,
      });
    }
  }, [multiFrontierSubscriptions]);

  useEffect(() => {
    if (!isActive) return;
    const api = window.electronAPI?.multiFrontier;
    if (!api) return;
    let disposed = false;
    const unsubscribeProviderStatus = api.subscribeProviderStatus((event) => {
      if (disposed) return;
      setMultiFrontierSubscriptions((current) => ({
        ...current,
        [event.providerId]: event.status,
      }));
    });
    void api
      .getSettings()
      .then((settings) => {
        if (disposed) return;
        setMultiFrontierDefaultSettings(settings);
        if (!multiFrontierSettingsHydrated.current) {
          multiFrontierSettingsHydrated.current = true;
          setMultiFrontierRunAutoContinue(
            initialMultiFrontierRunAutoContinue(settings),
          );
        }
      })
      .catch(() => undefined);
    for (const providerId of MULTI_FRONTIER_PROVIDERS) {
      void api
        .getProviderStatus(providerId)
        .then((result) => {
          if (disposed) return;
          if (result.error || !result.status) {
            appendProviderOperationFailure(providerId, "load");
            return;
          }
          setMultiFrontierSubscriptions((current) => ({
            ...current,
            [providerId]: result.status!,
          }));
        })
        .catch(() => {
          if (!disposed) appendProviderOperationFailure(providerId, "load");
        });
    }
    void api
      .list()
      .then((snapshots) => {
        if (disposed) return;
        const recovered = snapshots.find(
          (snapshot) => snapshot.phase === "paused",
        );
        if (!recovered) return;
        applyMultiFrontierSnapshot(recovered);
        multiFrontierSettingsHydrated.current = true;
        setMultiFrontierRunAutoContinue(
          recovered.autoContinueAfterAgreement ?? false,
        );
        setMultiFrontierMode(true);
        multiFrontierDetailNonce.current += 1;
        setMultiFrontierOpenDetailRequest({
          detailId: recovered.collaborationId,
          nonce: multiFrontierDetailNonce.current,
        });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribeProviderStatus();
    };
  }, [appendProviderOperationFailure, applyMultiFrontierSnapshot, isActive]);

  useEffect(() => {
    if (!isActive || !activeMultiFrontierCollaborationId) return;
    const api = window.electronAPI?.multiFrontier;
    if (!api) return;
    multiFrontierSequence.current = -1;
    setMultiFrontierNotices([]);
    return api.subscribe(
      activeMultiFrontierCollaborationId,
      applyMultiFrontierEvent,
    );
  }, [activeMultiFrontierCollaborationId, applyMultiFrontierEvent, isActive]);

  const refreshMultiFrontierSubscription = useCallback(
    async (providerId: MultiFrontierProviderId) => {
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      setMultiFrontierBusy(true);
      try {
        const result = await api.refreshProviderStatus(providerId);
        if (result.error || !result.status) {
          appendProviderOperationFailure(providerId, "refresh");
          return;
        }
        setMultiFrontierSubscriptions((current) => ({
          ...current,
          [providerId]: result.status!,
        }));
      } catch {
        appendProviderOperationFailure(providerId, "refresh");
      } finally {
        setMultiFrontierBusy(false);
      }
    },
    [appendProviderOperationFailure],
  );

  const connectMultiFrontierSubscription = useCallback(
    async (providerId: MultiFrontierProviderId) => {
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      setMultiFrontierBusy(true);
      try {
        const result = await api.beginProviderLogin(providerId);
        if (result.status) {
          setMultiFrontierSubscriptions((current) => ({
            ...current,
            [providerId]: result.status!,
          }));
        }
        if (result.error || !result.status) {
          appendProviderOperationFailure(providerId, "connect");
        }
      } catch {
        appendProviderOperationFailure(providerId, "connect");
      } finally {
        setMultiFrontierBusy(false);
      }
    },
    [appendProviderOperationFailure],
  );

  const updateMultiFrontierDefaultSettings = useCallback(
    async (autoContinueAfterAgreement: boolean) => {
      const previous = multiFrontierDefaultSettings;
      const next = { autoContinueAfterAgreement };
      setMultiFrontierDefaultSettings(next);
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      try {
        setMultiFrontierDefaultSettings(await api.updateSettings(next));
      } catch {
        setMultiFrontierDefaultSettings(previous);
      }
    },
    [multiFrontierDefaultSettings],
  );

  const runMultiFrontierAction = useCallback(
    async (
      action:
        | "start"
        | "go"
        | "pause"
        | "resume"
        | "cancel"
        | "re-review"
        | "role-swap",
      collaborationId: string,
      input: {
        nextDriverParticipantId?: string;
        reviewArtifactId?: string;
        prompt?: string;
      } = {},
    ) => {
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      trackMultiFrontierLifecycle({ kind: "action", action });
      setMultiFrontierBusy(true);
      try {
        const result =
          action === "role-swap"
            ? await api.roleSwap(
                collaborationId,
                input.nextDriverParticipantId ?? "",
              )
            : action === "re-review"
              ? await api.reReview(collaborationId, {
                  reviewArtifactId: input.reviewArtifactId ?? "",
                })
              : action === "resume"
                ? await api.resume(collaborationId, input.prompt)
                : await api[action](collaborationId);
        applyMultiFrontierSnapshot(result.snapshot);
        if (result.error) {
          trackMultiFrontierLifecycle({
            kind: "failure",
            category: multiFrontierFailureCategory(result.error.message),
          });
          multiFrontierNoticeNonce.current += 1;
          appendMultiFrontierNotice({
            id: `action:${action}:${multiFrontierNoticeNonce.current}`,
            kind: "failure",
            message: result.error.message,
          });
        }
      } catch {
        trackMultiFrontierLifecycle({
          kind: "failure",
          category: "unknown",
        });
        multiFrontierNoticeNonce.current += 1;
        appendMultiFrontierNotice({
          id: `action:${action}:${multiFrontierNoticeNonce.current}`,
          kind: "failure",
          message:
            "The collaboration could not continue. Check both subscriptions, then retry recovery.",
        });
      } finally {
        setMultiFrontierBusy(false);
      }
    },
    [appendMultiFrontierNotice, applyMultiFrontierSnapshot],
  );

  const multiFrontierExtension = useMemo<CodeAgentsNewSessionExtension>(
    () => ({
      active: multiFrontierMode,
      disabled: multiFrontierBusy,
      renderModeControl({ permissionMode, onPermissionModeChange }) {
        return (
          <MultiFrontierModeControl
            active={multiFrontierMode}
            permissionMode={permissionMode}
            subscriptions={multiFrontierSubscriptions}
            busy={multiFrontierBusy}
            modeLocked={multiFrontierModeLocked}
            autoContinueAfterAgreement={multiFrontierRunAutoContinue}
            defaultAutoContinueAfterAgreement={
              multiFrontierDefaultSettings.autoContinueAfterAgreement
            }
            onModeChange={(mode) => {
              if (mode === "multi-frontier") {
                if (!multiFrontierMode) {
                  setMultiFrontierRunAutoContinue(
                    initialMultiFrontierRunAutoContinue(
                      multiFrontierDefaultSettings,
                    ),
                  );
                }
                setMultiFrontierMode(true);
                return;
              }
              if (multiFrontierModeLocked) return;
              setMultiFrontierMode(false);
              onPermissionModeChange(
                mode === "plan" ? "read-only" : "full-auto",
              );
            }}
            onConnectSubscription={(providerId) =>
              void connectMultiFrontierSubscription(providerId)
            }
            onRefreshSubscription={(providerId) =>
              void refreshMultiFrontierSubscription(providerId)
            }
            onAutoContinueAfterAgreementChange={(value) =>
              setMultiFrontierRunAutoContinue(value)
            }
            onDefaultAutoContinueAfterAgreementChange={(value) =>
              void updateMultiFrontierDefaultSettings(value)
            }
          />
        );
      },
      async submit({ prompt, cwd, attachments }) {
        if (attachments.length > 0) {
          return {
            ok: false,
            message: "Multi-Frontier does not accept attachments yet.",
          };
        }
        const api = window.electronAPI?.multiFrontier;
        if (!api) {
          return {
            ok: false,
            message: "Multi-Frontier is not available in this desktop build.",
          };
        }
        const allConnected = MULTI_FRONTIER_PROVIDERS.every(
          (providerId) =>
            multiFrontierSubscriptions[providerId]?.connectionState ===
            "connected",
        );
        if (!allConnected) {
          return {
            ok: false,
            message: "Connect both subscription participants before starting.",
          };
        }
        setMultiFrontierBusy(true);
        try {
          const result = await api.create({
            prompt,
            ...(cwd ? { cwd } : {}),
            autoContinueAfterAgreement: multiFrontierRunAutoContinue,
          });
          applyMultiFrontierSnapshot(result.snapshot);
          if (!result.snapshot) {
            return {
              ok: false,
              message:
                result.error?.message ?? "Could not start collaboration.",
            };
          }
          return { ok: true, detailId: result.snapshot.collaborationId };
        } finally {
          setMultiFrontierBusy(false);
        }
      },
      renderDetail({ detailId }: { detailId: string }) {
        const state =
          multiFrontierState?.collaborationId === detailId
            ? multiFrontierState
            : undefined;
        return (
          <MultiFrontierWorkspace
            state={state}
            subscriptions={multiFrontierSubscriptions}
            notices={multiFrontierNotices}
            busy={multiFrontierBusy}
            autoContinueAfterAgreement={multiFrontierRunAutoContinue}
            defaultAutoContinueAfterAgreement={
              multiFrontierDefaultSettings.autoContinueAfterAgreement
            }
            onConnectSubscription={(providerId) =>
              void connectMultiFrontierSubscription(providerId)
            }
            onRefreshSubscription={(providerId) =>
              void refreshMultiFrontierSubscription(providerId)
            }
            onAutoContinueAfterAgreementChange={
              state
                ? undefined
                : (value) => setMultiFrontierRunAutoContinue(value)
            }
            onDefaultAutoContinueAfterAgreementChange={(value) =>
              void updateMultiFrontierDefaultSettings(value)
            }
            onStart={(collaborationId) =>
              void runMultiFrontierAction("start", collaborationId)
            }
            onGo={(collaborationId) =>
              void runMultiFrontierAction("go", collaborationId)
            }
            onSecondaryAction={(input: MultiFrontierSecondaryActionInput) =>
              void runMultiFrontierAction(input.action, input.collaborationId, {
                ...(input.nextDriverParticipantId
                  ? { nextDriverParticipantId: input.nextDriverParticipantId }
                  : {}),
                ...(input.reviewArtifactId
                  ? { reviewArtifactId: input.reviewArtifactId }
                  : {}),
                ...(input.prompt ? { prompt: input.prompt } : {}),
              })
            }
          />
        );
      },
    }),
    [
      applyMultiFrontierSnapshot,
      connectMultiFrontierSubscription,
      multiFrontierBusy,
      multiFrontierDefaultSettings.autoContinueAfterAgreement,
      multiFrontierModeLocked,
      multiFrontierMode,
      multiFrontierNotices,
      multiFrontierRunAutoContinue,
      multiFrontierState,
      multiFrontierSubscriptions,
      refreshMultiFrontierSubscription,
      runMultiFrontierAction,
      updateMultiFrontierDefaultSettings,
    ],
  );

  const host = useMemo<CodeAgentsHostWithTranscriptSubscription>(
    () => ({
      async listRuns(goalId?: string) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listRuns) {
          return {
            status: "unavailable",
            goalId,
            runs: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listRuns(goalId);
      },
      async createRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.createRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.createRun(request);
      },
      async submitRemoteWaitlist(request: {
        email: string;
        pageUrl?: string;
        source?: string;
        useCase?: string;
      }) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.submitRemoteWaitlist) {
          return {
            ok: false,
            error: "Desktop bridge is not available.",
          };
        }
        return api.submitRemoteWaitlist(request);
      },
      async listModels() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listModels) {
          return {
            status: "unavailable",
            models: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listModels() as Promise<CodeAgentModelListResult>;
      },
      async getHostMetadata() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.getHostMetadata) {
          return {
            status: "unavailable",
            llmProvider: { configured: false },
            error: "Desktop bridge is not available.",
          };
        }
        return api.getHostMetadata();
      },
      async runComputerSetupAction(action: CodeAgentComputerSetupAction) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.runComputerSetupAction) {
          return {
            ok: false,
            action,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.runComputerSetupAction(action);
      },
      async listCodePacks(cwd?: string) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listCodePacks) {
          return {
            status: "unavailable",
            error: "Desktop bridge is not available.",
          };
        }
        return api.listCodePacks(cwd);
      },
      async listProjects() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listProjects) {
          return {
            status: "unavailable",
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listProjects();
      },
      async selectProject(cwd) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.selectProject) {
          return {
            ok: false,
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.selectProject(cwd);
      },
      async chooseProject() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.chooseProject) {
          return {
            ok: false,
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.chooseProject();
      },
      async readTranscript(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.readTranscript) {
          return {
            status: "unavailable",
            runId: request.runId,
            events: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.readTranscript(request);
      },
      subscribeTranscript(request, callback) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.subscribeTranscript) return () => {};
        return api.subscribeTranscript(request, callback);
      },
      async appendFollowUp(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.appendFollowUp) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.appendFollowUp(request);
      },
      async updateRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.updateRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.updateRun(request);
      },
      async retryRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.retryRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.retryRun(request);
      },
      async rerunRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.rerunRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.rerunRun(request);
      },
      async controlRun(goalId, runId, command, permissionMode) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.controlRun) {
          return {
            ok: false,
            command,
            action: "none",
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.controlRun(goalId, runId, command, permissionMode);
      },
      async openTerminal(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.openTerminal) {
          return {
            ok: false,
            cwd:
              request?.cwd ?? request?.outputRoot ?? request?.sourceRoot ?? "",
            error: "Desktop bridge is not available.",
          };
        }
        return api.openTerminal(request);
      },
      async openCodexLogin() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.openCodexLogin) {
          return {
            ok: false,
            cwd: "",
            error: "Desktop bridge is not available.",
          };
        }
        return api.openCodexLogin();
      },
      async openClaudeLogin() {
        const api = window.electronAPI?.multiFrontier;
        if (!api) {
          return {
            ok: false,
            cwd: "",
            error: "Desktop bridge is not available.",
          };
        }
        const result = await api.beginProviderLogin("claude");
        return result.error
          ? { ok: false, cwd: "", error: result.error.message }
          : { ok: true, cwd: "" };
      },
      async getRemoteConnectorStatus() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.getRemoteConnectorStatus) {
          return {
            state: "error",
            enabled: false,
            configured: false,
            configPath: "",
            restartCount: 0,
            error: "Desktop bridge is not available.",
          };
        }
        return api.getRemoteConnectorStatus();
      },
      async setRemoteConnectorEnabled(enabled) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.setRemoteConnectorEnabled) {
          return {
            ok: false,
            status: {
              state: "error",
              enabled: false,
              configured: false,
              configPath: "",
              restartCount: 0,
              error: "Desktop bridge is not available.",
            },
            error: "Desktop bridge is not available.",
          };
        }
        return api.setRemoteConnectorEnabled(enabled);
      },
      async pairRemoteConnector(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.pairRemoteConnector) {
          return {
            ok: false,
            status: {
              state: "error",
              enabled: false,
              configured: false,
              configPath: "",
              restartCount: 0,
              error: "Desktop bridge is not available.",
            },
            error: "Desktop bridge is not available.",
          };
        }
        return api.pairRemoteConnector(request);
      },
      async connectBuilderProvider() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.connectBuilderProvider) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.connectBuilderProvider();
      },
    }),
    [],
  );

  const chatFirstPreviewApp = chatFirstPreviewRequest
    ? getDesktopVisibleApps(apps).find(
        (app) => app.id === chatFirstPreviewRequest.appId && app.enabled,
      )
    : undefined;
  const chatFirstPreviewUrl = chatFirstPreviewApp?.devUrl?.trim();
  const renderChatFirstSurfaceTab = useCallback(
    (tab: ChatFirstSurfaceTab) => {
      if (tab.kind === "side-chat") {
        const target =
          tab.session ??
          (tab.id === chatFirstSurfaceTabs.activeTabId
            ? chatFirstSessionWatch.target
            : null);
        if (!target) return null;
        const watchedRunForTab =
          chatFirstWatchedRun?.id === target.sessionId
            ? chatFirstWatchedRun
            : null;
        return (
          <ChatFirstSessionWatchPane
            target={target}
            onClose={() => closeChatFirstSurfaceTab(tab)}
            renderChat={(session) =>
              watchedRunForTab ? (
                <SessionWatchPanel
                  host={host}
                  run={watchedRunForTab}
                  sourceRunId={chatFirstWatchedSourceRunId}
                  onClose={closeChatFirstSessionWatch}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                  {session.kind === "agent-chat"
                    ? "Agent chat sessions are available in Dispatch."
                    : session.kind === "external"
                      ? "This session is only available in its source app."
                      : session.title || "Selected session is unavailable."}
                </div>
              )
            }
            copy={defaultChatFirstCopy}
          />
        );
      }
      if (tab.kind === "browser" && tab.url) {
        const isPreviewTab = tab.url === chatFirstPreviewUrl;
        const isTabActive = isChatFirstSurfaceTabActive({
          surfaceActive: isActive,
          tabId: tab.id,
          activeTabId: activeChatFirstSurfaceTab?.id,
        });
        return (
          <ChatFirstBrowserPane
            url={tab.url}
            title={tab.title}
            status={
              isPreviewTab && tab.id === activeChatFirstSurfaceTab?.id
                ? chatFirstPreviewStatus
                : undefined
            }
            statusMessage={
              isPreviewTab && tab.id === activeChatFirstSurfaceTab?.id
                ? chatFirstPreviewStatusMessage
                : undefined
            }
            onClose={() => closeChatFirstSurfaceTab(tab)}
            renderEmbed={({ url, key }: ChatFirstEmbedTarget) => (
              <AppWebview
                key={key}
                app={{
                  id: "chat-first-browser",
                  name: "Browser",
                  icon: "Globe",
                  description: "Browser surface",
                  devPort: 0,
                }}
                sourceUrl={url}
                isActive={isTabActive}
                partitionKey={
                  isPreviewTab
                    ? chatFirstPreviewPartitionKey(chatFirstPreviewApp?.id)
                    : undefined
                }
                refreshKey={isPreviewTab ? refreshKey : 0}
                syncTheme={isPreviewTab}
                theme={theme}
              />
            )}
            copy={defaultChatFirstCopy}
          />
        );
      }
      if (tab.kind === "terminal") {
        return (
          <DesktopTerminalTabs
            apps={apps}
            agent={terminalPreferences.agent}
            theme={theme}
            className="desktop-terminal-tabs--side-surface"
          />
        );
      }
      if (tab.kind === "app" && tab.appId) {
        const app = apps.find((candidate) => candidate.id === tab.appId);
        if (!app) return null;
        const dispatchControlPlane =
          tab.appId === "dispatch" && isDispatchControlPlanePath(tab.path);
        const surfaceApp = dispatchControlPlane
          ? { ...app, name: dispatchControlPlaneTitle(tab.path) ?? app.name }
          : app;
        const isTabActive = isChatFirstSurfaceTabActive({
          surfaceActive: isActive,
          tabId: tab.id,
          activeTabId: activeChatFirstSurfaceTab?.id,
        });
        return (
          <ChatFirstAppPane
            app={surfaceApp}
            status="ready"
            embedUrl={tab.path ?? "/"}
            renderEmbed={() => (
              <DesktopAppChatShell
                appId={surfaceApp.id}
                appName={surfaceApp.name}
                authState={chatFirstAppAuthStates[surfaceApp.id] ?? "unknown"}
                onSignInRequest={() => focusChatFirstApp(tab.id)}
              >
                <AppWebview
                  ref={(instance) => {
                    if (instance) {
                      chatFirstAppWebviewRefs.current.set(tab.id, instance);
                    } else {
                      chatFirstAppWebviewRefs.current.delete(tab.id);
                    }
                  }}
                  app={toAppDefinition(surfaceApp)}
                  appConfig={surfaceApp}
                  isActive={isTabActive}
                  theme={theme}
                  urlPath={tab.path}
                  urlParams={
                    dispatchControlPlane
                      ? dispatchControlPlaneUrlParams(tab.path)
                      : { embedded: "1", chatFirst: "1" }
                  }
                  onAuthStateChange={(state) => {
                    if (isTabActive) {
                      handleChatFirstAppAuthStateChange(surfaceApp.id, state);
                    }
                  }}
                />
              </DesktopAppChatShell>
            )}
            copy={defaultChatFirstCopy}
          />
        );
      }
      if (tab.kind === "agents") {
        return (
          <ChatFirstAgentsPane
            activities={chatFirstAgentActivities}
            onWatch={watchChatFirstAgent}
            copy={defaultChatFirstCopy}
          />
        );
      }
      return null;
    },
    [
      activeChatFirstSurfaceTab?.id,
      apps,
      chatFirstAgentActivities,
      chatFirstPreviewStatus,
      chatFirstPreviewStatusMessage,
      chatFirstPreviewUrl,
      chatFirstSessionWatch.target,
      chatFirstSurfaceTabs.activeTabId,
      chatFirstWatchedRun,
      chatFirstWatchedSourceRunId,
      closeChatFirstSurfaceTab,
      focusChatFirstApp,
      handleChatFirstAppAuthStateChange,
      host,
      isActive,
      chatFirstAppAuthStates,
      refreshKey,
      terminalPreferences.agent,
      theme,
      watchChatFirstAgent,
    ],
  );
  const showTerminalSurface =
    terminalPreferences.enabled &&
    (terminalSessionStarted || hasChatFirstActiveChat || chatFirstAppSelected);
  return (
    <QueryClientProvider client={codeAgentsQueryClient}>
      <div
        style={
          {
            "--chat-first-surface-width": `${chatFirstSurfaceResize.width}px`,
          } as CSSProperties
        }
        className={[
          "desktop-chat-first-hub",
          !hasChatFirstChats ? "desktop-chat-first-hub--no-chats" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <CodeAgentsApp
          apps={apps}
          host={host}
          isActive={isActive}
          openRequest={openRequest}
          refreshKey={refreshKey}
          brandIconUrl={agentNativeIconUrl}
          onOpenSettings={onOpenSettings}
          mainToolbarSlot={
            hasChatFirstActiveChat && !chatFirstAppTakesMain ? (
              <ChatFirstSurfacePanelToggle
                open={chatFirstSurfacePanel.open}
                onToggle={chatFirstSurfacePanel.toggle}
                className="static"
              />
            ) : undefined
          }
          activeChatFirstSurfaceKind={activeChatFirstSurfaceTab?.kind}
          railCollapsed={chatFirstRailCollapsed}
          chatFirstMainKind={
            chatFirstAllAppsOpen || chatFirstAppTakesMain ? "agent" : "code"
          }
          renderChatFirstMainSurface={
            chatFirstAllAppsOpen ? (
              <DesktopAppsGrid
                apps={apps}
                layout={chatFirstAppLayout}
                fullPage
                onBack={returnToChatFirstChats}
                onCreateApp={onCreateApp}
                onOpenApp={openChatFirstAppFromGrid}
                onOpenInBrowser={openChatFirstAppInBrowser}
                onTogglePinned={toggleChatFirstAppPinned}
              />
            ) : chatFirstAppTakesMain && activeChatFirstSurfaceTab ? (
              <ChatFirstSurfaceContent
                tabs={visibleChatFirstSurfaceTabs}
                activeTabId={visibleActiveChatFirstSurfaceTabId}
                renderTab={renderChatFirstSurfaceTab}
              />
            ) : undefined
          }
          renderChatFirstChatSurface={
            showTerminalSurface ? (
              <DesktopTerminalSurface
                apps={apps}
                agent={terminalPreferences.agent}
                theme={theme}
                submitRequest={terminalPromptRequest ?? undefined}
                onPromptSubmitted={handleTerminalPromptSubmitted}
              />
            ) : undefined
          }
          terminalMode={
            terminalPreferences.enabled
              ? {
                  agentId: terminalPreferences.agent,
                  agentLabel:
                    DESKTOP_TERMINAL_AGENT_OPTIONS.find(
                      (option) => option.id === terminalPreferences.agent,
                    )?.label ?? terminalPreferences.agent,
                  onSubmit: handleTerminalPromptSubmit,
                }
              : undefined
          }
          terminalModeControl={{
            enabled: terminalPreferences.enabled,
            onChange: handleTerminalModeChange,
          }}
          suppressChatFirstUnavailableNotice
          onRunsChange={handleChatFirstRunsChange}
          onSelectedRunChange={(runId) =>
            setHasChatFirstActiveChat(Boolean(runId))
          }
          onWatchedRunChange={handleChatFirstWatchedRunChange}
          chatFirstNavigation={chatFirstNavigation}
          onChatFirstOpenApp={emitChatFirstOpenAppStable}
          railWindowControlsSlot={
            chatFirstRailCollapsed &&
            window.electronAPI?.platform === "darwin" ? (
              <CollapsedMacWindowControls />
            ) : undefined
          }
          railWorkspaceSlot={chatFirstRailWorkspaceSlot}
          overviewFooterSlot={
            <DesktopAppsGrid
              apps={apps}
              layout={chatFirstAppLayout}
              onCreateApp={onCreateApp}
              onOpenApp={openChatFirstAppFromGrid}
              onOpenInBrowser={openChatFirstAppInBrowser}
              onTogglePinned={toggleChatFirstAppPinned}
            />
          }
          railFooterSlot={
            <>
              <UpdateIndicator />
              <div className="desktop-chat-first-rail-footer-actions">
                {onOpenSettings ? (
                  <button
                    type="button"
                    className="code-agents-nav-link desktop-chat-first-rail-settings"
                    onClick={onOpenSettings}
                    aria-label="Settings"
                    title="Settings"
                  >
                    <IconSettings
                      size={15}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                    <span>Settings</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="code-agents-nav-link desktop-chat-first-rail-collapse"
                  onClick={() =>
                    setChatFirstRailCollapsed((collapsed) => !collapsed)
                  }
                  aria-label={
                    chatFirstRailCollapsed ? "Expand rail" : "Collapse rail"
                  }
                  title={
                    chatFirstRailCollapsed ? "Expand rail" : "Collapse rail"
                  }
                >
                  {chatFirstRailCollapsed ? (
                    <IconLayoutSidebarLeftExpand
                      size={15}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  ) : (
                    <IconLayoutSidebarLeftCollapse
                      size={15}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
            </>
          }
          newSessionExtension={multiFrontierExtension}
          openDetailRequest={multiFrontierOpenDetailRequest}
          renderAppSurface={({ app, urlParams, refreshKey: appRefreshKey }) => (
            <div className="code-agents-embedded-app-surface">
              <AppWebview
                app={toAppDefinition(app)}
                appConfig={app}
                isActive={isActive}
                theme={theme}
                urlParams={urlParams}
                refreshKey={appRefreshKey}
              />
            </div>
          )}
        />
        {(hasChatFirstActiveChat || terminalPreferences.enabled) &&
        chatFirstSurfacePanel.open &&
        !chatFirstAppTakesMain ? (
          <ChatFirstSurfacePanel
            width={chatFirstSurfaceResize.width}
            onResizePointerDown={chatFirstSurfaceResize.onPointerDown}
            copy={defaultChatFirstCopy}
          >
            {activeChatFirstSurfaceTab?.kind !== "app" ? (
              <ChatFirstSurfaceTabs
                tabs={visibleChatFirstSurfaceTabs}
                activeTabId={visibleActiveChatFirstSurfaceTabId}
                onActivate={activateChatFirstSurfaceTab}
                onClose={closeChatFirstSurfaceTab}
                onCloseOthers={(tab) => {
                  activateChatFirstSurfaceTab(tab);
                  chatFirstSurfaceTabsStore.closeOthers(tab.id);
                }}
                onCloseToRight={(tab) => {
                  const targetIndex = visibleChatFirstSurfaceTabs.findIndex(
                    (candidate) => candidate.id === tab.id,
                  );
                  const activeIndex = visibleChatFirstSurfaceTabs.findIndex(
                    (candidate) =>
                      candidate.id === visibleActiveChatFirstSurfaceTabId,
                  );
                  if (activeIndex > targetIndex) {
                    activateChatFirstSurfaceTab(tab);
                  }
                  chatFirstSurfaceTabsStore.closeToRight(tab.id);
                }}
                onCloseAll={closeAllChatFirstSurfaceTabs}
                onOpenSurface={openChatFirstSurface}
                hiddenSurfaceKinds={
                  terminalPreferences.enabled ? ["terminal"] : undefined
                }
                apps={chatFirstAppItems}
                onOpenApp={(app) =>
                  openChatFirstApp(app.id, undefined, undefined, "side")
                }
                renderAppIcon={renderChatFirstAppIcon}
                copy={defaultChatFirstCopy}
              />
            ) : null}
            {visibleChatFirstSurfaceTabs.length > 0 ? (
              <ChatFirstSurfaceContent
                tabs={visibleChatFirstSurfaceTabs}
                activeTabId={visibleActiveChatFirstSurfaceTabId}
                renderTab={renderChatFirstSurfaceTab}
              />
            ) : null}
          </ChatFirstSurfacePanel>
        ) : null}
      </div>
    </QueryClientProvider>
  );
}

function areChatFirstAgentActivitiesEqual(
  current: ChatFirstAgentActivity[],
  next: ChatFirstAgentActivity[],
): boolean {
  return (
    current.length === next.length &&
    current.every((activity, index) => {
      const candidate = next[index];
      if (!candidate) return false;
      return (
        activity.sessionId === candidate.sessionId &&
        activity.title === candidate.title &&
        activity.subtitle === candidate.subtitle &&
        activity.status === candidate.status &&
        activity.updatedAt === candidate.updatedAt &&
        activity.progressPercent === candidate.progressPercent &&
        activity.goalId === candidate.goalId
      );
    })
  );
}

export function MultiFrontierModeControl({
  active,
  permissionMode,
  subscriptions,
  busy,
  modeLocked,
  autoContinueAfterAgreement,
  defaultAutoContinueAfterAgreement,
  onModeChange,
  onConnectSubscription,
  onRefreshSubscription,
  onAutoContinueAfterAgreementChange,
  onDefaultAutoContinueAfterAgreementChange,
}: {
  active: boolean;
  permissionMode: CodeAgentPermissionMode;
  subscriptions: Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>;
  busy: boolean;
  modeLocked: boolean;
  autoContinueAfterAgreement: boolean;
  defaultAutoContinueAfterAgreement: boolean;
  onModeChange: (mode: "plan" | "auto" | "multi-frontier") => void;
  onConnectSubscription: (providerId: MultiFrontierProviderId) => void;
  onRefreshSubscription: (providerId: MultiFrontierProviderId) => void;
  onAutoContinueAfterAgreementChange: (value: boolean) => void;
  onDefaultAutoContinueAfterAgreementChange: (value: boolean) => void;
}) {
  const value = active
    ? "multi-frontier"
    : permissionMode === "read-only"
      ? "plan"
      : "auto";
  return (
    <div className="code-agents-multi-frontier-control">
      <Select
        value={value}
        disabled={busy || modeLocked}
        onValueChange={onModeChange}
      >
        <SelectTrigger
          className="desktop-select-trigger code-agents-mode-select code-agents-multi-frontier-mode-select"
          aria-label="Run mode"
        >
          <span>
            {
              MULTI_FRONTIER_RUN_MODES.find((mode) => mode.value === value)
                ?.label
            }
          </span>
        </SelectTrigger>
        <SelectContent className="code-agents-select-content code-agents-mode-menu code-agents-multi-frontier-mode-menu">
          {MULTI_FRONTIER_RUN_MODES.map((mode) => (
            <SelectItem
              key={mode.value}
              className="code-agents-multi-frontier-mode-menu-item"
              value={mode.value}
            >
              <span className="code-agents-multi-frontier-mode-option">
                <span className="code-agents-multi-frontier-mode-option__label">
                  {mode.label}
                </span>
                <span className="code-agents-multi-frontier-mode-option__description">
                  {mode.description}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active ? (
        <MultiFrontierParticipantSettings
          statuses={subscriptions}
          busy={busy}
          autoContinueAfterAgreement={autoContinueAfterAgreement}
          defaultAutoContinueAfterAgreement={defaultAutoContinueAfterAgreement}
          onConnect={onConnectSubscription}
          onRefresh={onRefreshSubscription}
          onAutoContinueAfterAgreementChange={
            onAutoContinueAfterAgreementChange
          }
          onDefaultAutoContinueAfterAgreementChange={
            onDefaultAutoContinueAfterAgreementChange
          }
        />
      ) : null}
    </div>
  );
}
