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
  resolveChatFirstAppTarget,
  resolveChatFirstBrowserTarget,
  subscribeChatFirstOpenBrowser,
  subscribeChatFirstOpenApp,
  useChatFirstSessionWatch,
  useChatFirstSurfaceResize,
  useChatFirstSurfacePanel,
  useChatFirstSurfaceTabs,
  type ChatFirstAppRegistration,
  type ChatFirstAppResolution,
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
  defaultChatFirstCopy,
  type ChatFirstAppItem,
  type ChatFirstEmbedTarget,
} from "@agent-native/core/client/chat-first";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@agent-native/toolkit/ui/select";
import { toAppDefinition, type AppConfig } from "@shared/app-registry";
import { IconArrowUpRight, IconPlus, IconSettings } from "@tabler/icons-react";
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
import AppWebview from "./AppWebview.js";
import CodeAgentsAppIcon from "./CodeAgentsAppIcon.js";
import CreateAppPromptPopover from "./CreateAppPromptPopover.js";
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

const agentNativeIconUrl = new URL(
  "../assets/agent-native-icon-dark.svg",
  import.meta.url,
).href;
const codeAgentsQueryClient = createAgentNativeQueryClient();
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
): ChatFirstSurfaceTab {
  const target = [app.id, path ?? "/", view ?? ""].join(":");
  return {
    id: chatFirstSurfaceTabId("app", target),
    kind: "app",
    title: app.name,
    appId: app.id,
    ...(path ? { path } : {}),
    ...(view ? { view } : {}),
  };
}

function DesktopAppsGrid({
  apps,
  onCreateApp,
  onOpenAllApps,
  onOpenApp,
}: {
  apps: AppConfig[];
  onCreateApp?: () => void;
  onOpenAllApps: () => void;
  onOpenApp: (app: AppConfig) => void;
}) {
  const visibleApps = apps.filter((app) => app.enabled && app.id !== "agent");
  if (visibleApps.length === 0) return null;

  return (
    <section className="desktop-apps-grid" aria-label="Apps">
      <div className="desktop-apps-grid__header">
        <h3 className="desktop-apps-grid__title">Apps</h3>
        <div className="desktop-apps-grid__actions">
          <button
            type="button"
            className="desktop-apps-grid__action"
            onClick={onOpenAllApps}
          >
            <span>View all</span>
            <IconArrowUpRight size={14} aria-hidden="true" />
          </button>
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
      <div className="desktop-apps-grid__list">
        {visibleApps.map((app) => (
          <button
            key={app.id}
            type="button"
            className="desktop-app-card"
            data-desktop-app-card
            data-app-id={app.id}
            onClick={() => onOpenApp(app)}
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
            <IconArrowUpRight
              className="desktop-app-card__arrow"
              size={15}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </section>
  );
}

interface CodeAgentsHubProps {
  apps: AppConfig[];
  isActive?: boolean;
  openRequest?: { goalId?: string; runId?: string; nonce: number };
  chatFirstPreviewRequest?: { appId: string; nonce: number };
  chatFirstPreviewStatus?: "starting" | "ready" | "error";
  chatFirstPreviewStatusMessage?: string;
  refreshKey?: number;
  onOpenSettings?: () => void;
  onCreateApp?: () => void;
  onChatFirstAppCreated?: (result: DesktopCreateAppResult) => void;
  chatFirstMode?: boolean;
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
  chatFirstPreviewRequest,
  chatFirstPreviewStatus,
  chatFirstPreviewStatusMessage,
  refreshKey = 0,
  onOpenSettings,
  onCreateApp,
  onChatFirstAppCreated,
  chatFirstMode = false,
}: CodeAgentsHubProps) {
  const emitChatFirstOpenAppStable = useCallback(
    (detail: ChatFirstOpenAppDetail) => emitChatFirstOpenApp(detail),
    [],
  );
  const chatFirstSurfaceTabs = useChatFirstSurfaceTabs("desktop");
  const chatFirstSurfaceTabsStore = getChatFirstSurfaceTabsStore("desktop");
  const chatFirstSurfaceResize = useChatFirstSurfaceResize("desktop");
  const chatFirstSurfacePanel = useChatFirstSurfacePanel("desktop");
  const { setOpen: setChatFirstSurfacePanelOpen } = chatFirstSurfacePanel;
  const chatFirstSessionWatch = useChatFirstSessionWatch();
  const [chatFirstWatchedRun, setChatFirstWatchedRun] =
    useState<CodeAgentRun | null>(null);
  const [chatFirstWatchedSourceRunId, setChatFirstWatchedSourceRunId] =
    useState<string | null>(null);
  const [chatFirstAgentActivities, setChatFirstAgentActivities] = useState<
    ChatFirstAgentActivity[]
  >([]);
  const previousChatFirstSurfaceTabCountRef = useRef<number | null>(null);
  const activeChatFirstSurfaceTab = useMemo(
    () =>
      chatFirstSurfaceTabs.tabs.find(
        (tab) => tab.id === chatFirstSurfaceTabs.activeTabId,
      ) ?? null,
    [chatFirstSurfaceTabs],
  );
  const [chatFirstBrowserSelection, setChatFirstBrowserSelection] = useState<{
    url: string;
    title?: string;
  } | null>(null);
  const [hasChatFirstChats, setHasChatFirstChats] = useState(false);
  const [chatFirstNotice, setChatFirstNotice] = useState<string | null>(null);
  const handledChatFirstPreviewNonceRef = useRef<number | null>(null);
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
    (appId: string, path?: string, view?: string) => {
      const app = apps.find(
        (candidate) => candidate.id === appId && candidate.enabled,
      );
      if (!app) {
        setChatFirstNotice("That app is not enabled in the desktop workspace.");
        return;
      }
      window.electronAPI?.setActiveApp?.(app.id);
      setChatFirstNotice(null);
      setChatFirstBrowserSelection(null);
      closeChatFirstSessionWatch();
      chatFirstSurfaceTabsStore.open(chatFirstAppSurfaceTab(app, path, view));
      setChatFirstSurfacePanelOpen(true);
    },
    [apps, chatFirstSurfaceTabsStore, setChatFirstSurfacePanelOpen],
  );

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
      apps
        .filter((app) => app.enabled && app.id !== "agent")
        .map((app) => ({
          id: app.id,
          name: app.name,
          ...(app.icon ? { icon: app.icon } : {}),
          ...(app.color ? { color: app.color } : {}),
        })),
    [apps],
  );

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
    if (
      !chatFirstMode ||
      !request ||
      handledChatFirstPreviewNonceRef.current === request.nonce
    ) {
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
  }, [
    apps,
    chatFirstMode,
    chatFirstPreviewRequest,
    resolveChatFirstOpenBrowser,
  ]);

  useEffect(() => {
    if (!chatFirstMode) {
      setChatFirstBrowserSelection(null);
      setChatFirstNotice(null);
      chatFirstSurfaceTabsStore.closeAll();
      return;
    }
    const unsubscribeApp = subscribeChatFirstOpenApp(resolveChatFirstOpenApp);
    const unsubscribeBrowser = subscribeChatFirstOpenBrowser(
      resolveChatFirstOpenBrowser,
    );
    return () => {
      unsubscribeApp();
      unsubscribeBrowser();
    };
  }, [
    chatFirstMode,
    chatFirstSurfaceTabsStore,
    resolveChatFirstOpenApp,
    resolveChatFirstOpenBrowser,
  ]);

  useEffect(() => {
    const target = chatFirstSessionWatch.target;
    if (!chatFirstMode || !target) return;
    setChatFirstBrowserSelection(null);
    chatFirstSurfaceTabsStore.open({
      id: chatFirstSurfaceTabId("side-chat", target.sessionId),
      kind: "side-chat",
      title: target.title ? `Watch · ${target.title}` : "Watched session",
      session: target,
    });
  }, [chatFirstMode, chatFirstSessionWatch.target, chatFirstSurfaceTabsStore]);

  useEffect(() => {
    const tabCount = chatFirstSurfaceTabs.tabs.length;
    const previousTabCount = previousChatFirstSurfaceTabCountRef.current;
    if (!chatFirstMode) {
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
    chatFirstMode,
    setChatFirstSurfacePanelOpen,
    chatFirstSurfaceTabs.tabs.length,
  ]);

  useEffect(() => {
    const activeTab = activeChatFirstSurfaceTab;
    if (
      !chatFirstMode ||
      activeTab?.kind !== "side-chat" ||
      !activeTab.session ||
      chatFirstSessionWatch.target
    ) {
      return;
    }
    emitChatFirstSessionWatch(activeTab.session);
  }, [activeChatFirstSurfaceTab, chatFirstMode, chatFirstSessionWatch.target]);

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

  const openChatFirstSurface = useCallback(
    (kind: ChatFirstSurfaceKind) => {
      if (kind !== "agents") return;
      closeChatFirstSessionWatch();
      chatFirstSurfaceTabsStore.open({
        id: chatFirstSurfaceTabId(kind, "activity"),
        kind,
        title: "Agents",
      });
    },
    [chatFirstSurfaceTabsStore],
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
    setChatFirstAgentActivities(
      runs.map((run) => ({
        sessionId: run.id,
        title: run.title || "Untitled agent session",
        subtitle: run.subtitle || run.phase,
        status: run.status,
        updatedAt: run.updatedAt,
        progressPercent: run.progress?.percent,
        goalId: run.goalId,
      })),
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
    ? apps.find(
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
              />
            )}
            copy={defaultChatFirstCopy}
          />
        );
      }
      if (tab.kind === "app" && tab.appId) {
        const app = apps.find((candidate) => candidate.id === tab.appId);
        if (!app) return null;
        const isTabActive = isChatFirstSurfaceTabActive({
          surfaceActive: isActive,
          tabId: tab.id,
          activeTabId: activeChatFirstSurfaceTab?.id,
        });
        return (
          <ChatFirstAppPane
            app={app}
            status="ready"
            embedUrl={tab.path ?? "/"}
            renderEmbed={() => (
              <AppWebview
                app={toAppDefinition(app)}
                appConfig={app}
                isActive={isTabActive}
                urlPath={tab.path}
                urlParams={{ embedded: "1", chatFirst: "1" }}
              />
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
      host,
      isActive,
      refreshKey,
      watchChatFirstAgent,
    ],
  );
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
          chatFirstMode ? "desktop-chat-first-hub--enabled" : "",
          chatFirstMode && !hasChatFirstChats
            ? "desktop-chat-first-hub--no-chats"
            : "",
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
            chatFirstMode ? (
              <ChatFirstSurfacePanelToggle
                open={chatFirstSurfacePanel.open}
                onToggle={chatFirstSurfacePanel.toggle}
                className="static"
              />
            ) : undefined
          }
          activeChatFirstSurfaceKind={
            chatFirstMode ? activeChatFirstSurfaceTab?.kind : undefined
          }
          chatFirstMode={chatFirstMode}
          suppressChatFirstUnavailableNotice={chatFirstMode}
          onRunsChange={handleChatFirstRunsChange}
          onWatchedRunChange={handleChatFirstWatchedRunChange}
          chatFirstNavigation={
            chatFirstMode
              ? {
                  onOpenIntegrations: () =>
                    openChatFirstApp("dispatch", "/admin/integrations"),
                  onOpenScheduled: () =>
                    openChatFirstApp("dispatch", "/admin/automations"),
                }
              : undefined
          }
          onChatFirstOpenApp={
            chatFirstMode ? emitChatFirstOpenAppStable : undefined
          }
          railWorkspaceSlot={
            chatFirstMode ? (
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
                  createAppTrigger={
                    onChatFirstAppCreated ? (
                      <CreateAppPromptPopover
                        onCreated={onChatFirstAppCreated}
                      />
                    ) : undefined
                  }
                  onCreateApp={onCreateApp}
                  onOpenApp={(app) => openChatFirstApp(app.id)}
                  onOpenAllApps={() => openChatFirstApp("dispatch", "/apps")}
                  renderIcon={(app) => (
                    <CodeAgentsAppIcon
                      id={app.id}
                      name={app.name}
                      icon={app.icon}
                      color={app.color}
                    />
                  )}
                  copy={defaultChatFirstCopy}
                />
              </>
            ) : undefined
          }
          overviewFooterSlot={
            chatFirstMode ? (
              <DesktopAppsGrid
                apps={apps}
                onCreateApp={onCreateApp}
                onOpenAllApps={() => openChatFirstApp("dispatch", "/apps")}
                onOpenApp={(app) => openChatFirstApp(app.id)}
              />
            ) : undefined
          }
          railFooterSlot={
            chatFirstMode && onOpenSettings ? (
              <button
                type="button"
                className="code-agents-nav-link"
                onClick={onOpenSettings}
              >
                <IconSettings size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>Settings</span>
              </button>
            ) : undefined
          }
          newSessionExtension={multiFrontierExtension}
          openDetailRequest={multiFrontierOpenDetailRequest}
          renderAppSurface={({ app, urlParams, refreshKey: appRefreshKey }) => (
            <div className="code-agents-embedded-app-surface">
              <AppWebview
                app={toAppDefinition(app)}
                appConfig={app}
                isActive={isActive}
                urlParams={urlParams}
                refreshKey={appRefreshKey}
              />
            </div>
          )}
        />
        {chatFirstMode && chatFirstSurfacePanel.open ? (
          <ChatFirstSurfacePanel
            width={chatFirstSurfaceResize.width}
            onResizePointerDown={chatFirstSurfaceResize.onPointerDown}
            copy={defaultChatFirstCopy}
          >
            {activeChatFirstSurfaceTab?.kind !== "app" ? (
              <ChatFirstSurfaceTabs
                tabs={chatFirstSurfaceTabs.tabs}
                activeTabId={chatFirstSurfaceTabs.activeTabId}
                onActivate={activateChatFirstSurfaceTab}
                onClose={closeChatFirstSurfaceTab}
                onCloseOthers={(tab) => {
                  activateChatFirstSurfaceTab(tab);
                  chatFirstSurfaceTabsStore.closeOthers(tab.id);
                }}
                onCloseToRight={(tab) => {
                  const targetIndex = chatFirstSurfaceTabs.tabs.findIndex(
                    (candidate) => candidate.id === tab.id,
                  );
                  const activeIndex = chatFirstSurfaceTabs.tabs.findIndex(
                    (candidate) =>
                      candidate.id === chatFirstSurfaceTabs.activeTabId,
                  );
                  if (activeIndex > targetIndex) {
                    activateChatFirstSurfaceTab(tab);
                  }
                  chatFirstSurfaceTabsStore.closeToRight(tab.id);
                }}
                onCloseAll={closeAllChatFirstSurfaceTabs}
                onOpenSurface={openChatFirstSurface}
                copy={defaultChatFirstCopy}
              />
            ) : null}
            {chatFirstSurfaceTabs.tabs.length > 0 ? (
              <ChatFirstSurfaceContent
                tabs={chatFirstSurfaceTabs.tabs}
                activeTabId={chatFirstSurfaceTabs.activeTabId}
                renderTab={renderChatFirstSurfaceTab}
              />
            ) : null}
          </ChatFirstSurfacePanel>
        ) : null}
      </div>
    </QueryClientProvider>
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
