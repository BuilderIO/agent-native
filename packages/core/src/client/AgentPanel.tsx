import { Tooltip as DesignSystemTooltip } from "@agent-native/toolkit/design-system";
import {
  IconMessageCircle,
  IconMessageDots,
  IconTerminal2,
  IconLayoutSidebarRightCollapse,
  IconLayoutGrid,
  IconCheck,
  IconPlus,
  IconX,
  IconDotsVertical,
  IconHistory,
  IconArrowsHorizontal,
  IconArrowsMaximize,
  IconExternalLink,
  IconShare3,
} from "@tabler/icons-react";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
  startTransition,
} from "react";

import type { AgentRun } from "../progress/types.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { normalizeTooltipText } from "./components/ui/tooltip.js";
import { ErrorReportActions } from "./ErrorReportActions.js";
import { FeedbackButton, resolveFeedbackUrl } from "./FeedbackButton.js";
import { RunsTrayMenuItem } from "./progress/RunsTray.js";
import { ShareButton } from "./sharing/ShareButton.js";
import { ThinkingDisplayProvider } from "./thinking-display.js";
const loadMultiTabAssistantChat = () =>
  import("./MultiTabAssistantChat.js").then((m) => ({
    default: m.MultiTabAssistantChat,
  }));
const MultiTabAssistantChatLazy = lazy(loadMultiTabAssistantChat);
import { Link, useLocation, useNavigate } from "react-router";

import { withBuilderUtmTrackingParams } from "../shared/builder-link-tracking.js";
import type { AgentChatSurfaceKind } from "./agent-chat-adapter.js";
import {
  AGENT_PANEL_OPEN_SETTINGS_EVENT,
  AGENT_PANEL_SET_MODE_EVENT,
} from "./agent-sidebar-events.js";
export {
  shouldHandleAgentPanelChatShortcut,
  shouldHandleAgentSidebarToggle,
} from "./agent-sidebar-events.js";
export {
  AgentSidebar,
  AgentToggleButton,
  focusAgentChat,
  preloadAgentChatSurface,
} from "./AgentSidebar.js";
export type { AgentSidebarProps } from "./AgentSidebar.js";
import { AgentSidebarOnboardingContext } from "./agent-sidebar-context.js";
import { URLSync } from "./agent-sidebar-url-sync.js";
import { trackEvent } from "./analytics.js";
import { agentNativePath, appPath } from "./api-path.js";
import { assistantUiRecoverableRenderErrorKind } from "./assistant-ui-recovery.js";
import type { AssistantChatProps } from "./AssistantChat.js";
import {
  AGENT_CHAT_VIEW_TRANSITION_CLASS,
  getAgentChatViewTransitionStyle,
} from "./chat-view-transition.js";
import { fetchBuilderStatus } from "./client-status-requests.js";
import { getFramePostMessageTargetOrigin } from "./frame.js";
import { useT } from "./i18n.js";
import type {
  MultiTabAssistantChatHeaderProps,
  MultiTabAssistantChatProps,
} from "./MultiTabAssistantChat.js";
import { isFirstRunOnboardingEnabled } from "./onboarding/first-run-enabled.js";
import { useFirstRunOnboardingGateOwnsSurface } from "./onboarding/first-run-startup-gate.js";
import { useOnboardingPreviewMode } from "./onboarding/use-preview-mode.js";
import { recoverFromStaleChunkError } from "./route-chunk-recovery.js";
import { withBuilderConnectTrackingParams } from "./settings/useBuilderStatus.js";
import { useDevMode } from "./use-dev-mode.js";
import { cn } from "./utils.js";

function parentFrameTargetOrigin(): string {
  return getFramePostMessageTargetOrigin() ?? window.location.origin;
}

const AgentTerminal = lazy(() =>
  import("./terminal/index.js").then((m) => ({ default: m.AgentTerminal })),
);

export function settingsRouteHashForSection(
  section?: string | null,
  currentHash?: string | null,
): string {
  const raw = section?.replace(/^#/, "").trim() ?? "";
  const normalized = raw.toLowerCase();
  if (
    [
      "llm",
      "app-models",
      "limits",
      "demo-mode",
      "hosting",
      "database",
      "uploads",
      "auth",
      "email",
      "browser",
      "background",
      "usage",
    ].includes(normalized)
  ) {
    return `#${normalized}`;
  }
  if (normalized === "voice") return "#voice";
  if (normalized === "a2a") return "#agent:agents";
  if (normalized.startsWith("secrets:")) {
    return `#secrets:${raw.slice("secrets:".length)}`;
  }
  if (normalized === "secrets") {
    const existing = currentHash?.replace(/^#/, "").trim() ?? "";
    if (existing.toLowerCase().startsWith("secrets:") && existing.length > 8) {
      return `#secrets:${existing.slice("secrets:".length)}`;
    }
  }
  if (normalized === "automations") return "#agent:automations";
  if (
    normalized.startsWith("secrets") ||
    normalized.includes("api") ||
    normalized === "integrations" ||
    normalized === "connections"
  ) {
    return "#integrations";
  }
  if (
    normalized === "account" ||
    normalized === "workspace" ||
    normalized === "workspace-settings" ||
    normalized === "organization" ||
    normalized === "org"
  ) {
    return "#workspace";
  }
  return "#agent";
}

export function AgentPanelSettingsNavigation({
  onOpenSettings,
}: {
  onOpenSettings?: (section?: string) => void;
} = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleOpenSettings(event: Event) {
      const section = (event as CustomEvent<{ section?: string }>).detail
        ?.section;
      if (onOpenSettings) {
        onOpenSettings(section);
        return;
      }
      const navigation = navigate({
        pathname: appPath("/settings"),
        hash: settingsRouteHashForSection(section, window.location.hash),
      });
      const notifyLocationChange = () => {
        window.dispatchEvent(new Event("popstate"));
        window.dispatchEvent(new Event("hashchange"));
      };
      void Promise.resolve(navigation).then(
        notifyLocationChange,
        () => undefined,
      );
    }
    window.addEventListener(
      AGENT_PANEL_OPEN_SETTINGS_EVENT,
      handleOpenSettings,
    );
    return () =>
      window.removeEventListener(
        AGENT_PANEL_OPEN_SETTINGS_EVENT,
        handleOpenSettings,
      );
  }, [navigate, onOpenSettings]);

  return null;
}
const ResourcesPanel = lazy(() =>
  import("./resources/ResourcesPanel.js").then((m) => ({
    default: m.ResourcesPanel,
  })),
);

const OnboardingPanel = lazy(() =>
  import("./onboarding/OnboardingPanel.js").then((m) => ({
    default: m.OnboardingPanel,
  })),
);

const FirstRunOnboarding = lazy(() =>
  import("./onboarding/FirstRunOnboarding.js").then((m) => ({
    default: m.FirstRunOnboarding,
  })),
);

const SetupButton = lazy(() =>
  import("./onboarding/SetupButton.js").then((m) => ({
    default: m.SetupButton,
  })),
);

const SHOW_ONBOARDING = false;
const SHOW_FIRST_RUN_ONBOARDING = isFirstRunOnboardingEnabled();

const CLI_STORAGE_KEY = "agent-native-cli-command";
const CLI_DEFAULT = "claude";
const EXEC_MODE_KEY = "agent-native-exec-mode";
type ExecMode = "build" | "plan";
type PanelMode = "chat" | "cli" | "resources";
export function normalizeAgentPanelModeForSurface(
  mode: string,
  chatOnly = false,
): PanelMode {
  if (chatOnly) return "chat";
  return mode === "cli" || mode === "resources" ? mode : "chat";
}
const AGENT_PANEL_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const AGENT_PANEL_ROOT_STYLE = {
  fontFamily: AGENT_PANEL_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
} satisfies React.CSSProperties;
const AGENT_PANEL_HEADER_CLASS =
  "agent-native-shell-topbar relative z-[240] flex h-12 shrink-0 items-center justify-between gap-2";
const AGENT_PANEL_HEADER_STYLE = {
  paddingLeft: 8,
  paddingRight: 8,
} satisfies React.CSSProperties;
const AGENT_PANEL_CONTROL_STYLE = {
  fontSize: 12,
  lineHeight: 1,
} satisfies React.CSSProperties;
const ACTIVATE_KEYS = new Set(["Enter", " "]);
type AgentPanelOverlayOpenTiming = "animation-frame" | "timeout";

export function deferAgentPanelOverlayOpen(
  event: { preventDefault: () => void },
  closeMenu: () => void,
  openOverlay: () => void,
  timing: AgentPanelOverlayOpenTiming = "animation-frame",
): void {
  event.preventDefault();
  closeMenu();
  if (timing === "timeout") {
    setTimeout(openOverlay, 0);
    return;
  }
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    window.requestAnimationFrame(() => openOverlay());
  } else {
    setTimeout(openOverlay, 0);
  }
}

export function consumeAgentPanelOverlayFocusRestore(
  pendingOverlayRef: { current: boolean },
  event: { preventDefault: () => void },
): void {
  if (!pendingOverlayRef.current) return;
  pendingOverlayRef.current = false;
  event.preventDefault();
}

interface AvailableCli {
  command: string;
  label: string;
  available: boolean;
}

function useAvailableClis() {
  const [clis, setClis] = useState<AvailableCli[]>([]);
  useEffect(() => {
    fetch(agentNativePath("/_agent-native/available-clis"))
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClis(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);
  return clis;
}

function useCliSelection(keyPrefix: string) {
  const cliKey = `${CLI_STORAGE_KEY}${keyPrefix}`;
  const [selected, setSelected] = useState(CLI_DEFAULT);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(cliKey);
      if (saved) setSelected(saved);
    } catch {}
  }, [cliKey]);
  const select = (cmd: string) => {
    setSelected(cmd);
    try {
      localStorage.setItem(cliKey, cmd);
    } catch {}
  };
  return [selected, select] as const;
}

function IconTooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactElement;
}) {
  return (
    <DesignSystemTooltip
      trigger={children}
      content={normalizeTooltipText(content)}
      placement="bottom"
      delayMs={250}
      className="z-[300] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md"
    />
  );
}

type ChatHeaderRenderer = (
  props: MultiTabAssistantChatHeaderProps,
) => React.ReactNode;

function ChatLoadingSkeleton({
  renderHeader,
  centerComposerWhenEmpty = false,
  composerSlot,
  composerAreaClassName,
  composerLayoutVariant = "default",
}: {
  renderHeader?: ChatHeaderRenderer;
  centerComposerWhenEmpty?: boolean;
  composerSlot?: React.ReactNode;
  composerAreaClassName?: string;
  composerLayoutVariant?: AssistantChatProps["composerLayoutVariant"];
}) {
  const t = useT();
  const noop = useCallback(() => {}, []);
  const noopStr = useCallback((_id: string) => {}, []);
  const stubProps: MultiTabAssistantChatHeaderProps = {
    tabs: [],
    activeTabId: "",
    activeTabMessageCount: 0,
    setActiveTabId: noopStr,
    addTab: noop,
    closeTab: noopStr,
    closeOtherTabs: noopStr,
    closeAllTabs: noop,
    clearActiveTab: noop,
    showHistory: false,
    tabCount: 0,
    toggleHistory: noop,
  };
  if (centerComposerWhenEmpty) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {renderHeader ? renderHeader(stubProps) : null}
        <div
          data-agent-empty-state="centered"
          className="relative flex flex-1 flex-col h-full min-h-0 text-foreground"
        >
          <div className="agent-chat-scroll flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="agent-empty-state sr-only" aria-busy="true">
              {t("agentChat.empty.loadingChat")}
            </div>
          </div>
          {composerSlot}
          <div className="agent-composer-stack">
            <div
              className={cn(
                "agent-composer-area shrink-0 px-3 py-2",
                composerLayoutVariant !== "default" &&
                  `agent-composer-area--${composerLayoutVariant}`,
                composerAreaClassName,
              )}
            >
              <div
                className={cn(
                  "agent-composer-root flex flex-col rounded-lg border border-input bg-muted/45 transition-colors",
                  composerLayoutVariant !== "default" &&
                    `agent-composer-root--${composerLayoutVariant}`,
                )}
              >
                <div className="px-3 pt-3">
                  <div className="h-5 w-3/5 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                </div>
                <div className="mt-auto flex items-center gap-2 px-3 py-2">
                  <div className="h-5 w-5 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                  <div className="ml-auto h-4 w-28 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                  <div className="h-7 w-7 rounded-md bg-muted animate-pulse motion-reduce:animate-none" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {renderHeader ? renderHeader(stubProps) : null}
      {/* Composer-shaped placeholder keeps layout stable during chunk load */}
      <div className="mt-auto shrink-0 border-t border-border p-3">
        <div className="h-16 rounded-xl bg-muted/40 animate-pulse motion-reduce:animate-none" />
      </div>
    </div>
  );
}

export function getAgentPanelChatTabGroups(
  tabs: MultiTabAssistantChatHeaderProps["tabs"],
  activeTabId: string,
) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const focusParentId = activeTab?.parentThreadId || activeTabId;
  const childTabs = tabs.filter((t) => t.parentThreadId === focusParentId);
  const mainTabs = tabs.filter((t) => !t.parentThreadId);

  return {
    activeTab,
    childTabs,
    focusParentId,
    hasSubTabs: childTabs.length > 0,
    mainTabs,
  };
}

export function shouldShowAgentPanelChatTabBar(
  tabs: MultiTabAssistantChatHeaderProps["tabs"],
  activeTabId: string,
) {
  const { hasSubTabs, mainTabs } = getAgentPanelChatTabGroups(
    tabs,
    activeTabId,
  );
  return mainTabs.length > 1 || hasSubTabs;
}

export function shouldShowAgentPanelSidebarChatTabs(
  tabs: MultiTabAssistantChatHeaderProps["tabs"],
) {
  return tabs.some((tab) => !tab.parentThreadId);
}

export function shouldShowAgentPanelPageNewChatButton(
  tabs: MultiTabAssistantChatHeaderProps["tabs"],
  activeTabId: string,
  activeTabMessageCount: number,
) {
  return shouldShowAgentPanelPageHeader(
    tabs,
    activeTabId,
    activeTabMessageCount,
  );
}

export function shouldShowAgentPanelPageHeader(
  tabs: MultiTabAssistantChatHeaderProps["tabs"],
  activeTabId: string,
  activeTabMessageCount: number,
) {
  if (!activeTabId) return false;
  if (activeTabMessageCount > 0) return true;

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  return activeTab?.status === "running" || activeTab?.status === "completed";
}

export function shouldShowAgentPanelCliTabBar(cliTabs: string[]) {
  return cliTabs.length > 1;
}

export function shouldShowAgentPanelModeButtons(
  isSidebar: boolean,
  chatOnly = false,
) {
  return !isSidebar && !chatOnly;
}

export function shouldShowAgentPanelFullViewAction(
  agentPageHref: string | undefined,
  mode: PanelMode,
  isSidebar = false,
  currentPath?: string,
) {
  return (
    Boolean(agentPageHref) &&
    currentPath !== agentPageHref &&
    (isSidebar || mode === "resources")
  );
}

export function resolveAgentPanelFullViewAction(
  agentPageHref: string | undefined,
  onFullViewRequest: (() => void) | undefined,
  mode: PanelMode,
  isSidebar = false,
  currentPath?: string,
) {
  if (
    !agentPageHref ||
    !shouldShowAgentPanelFullViewAction(
      agentPageHref,
      mode,
      isSidebar,
      currentPath,
    )
  ) {
    return null;
  }

  return onFullViewRequest
    ? ({ kind: "callback" } as const)
    : ({ kind: "link", href: agentPageHref } as const);
}

export function getAgentPanelShortcutHints(isMac: boolean) {
  return {
    closeTab: isMac ? "⌃W" : "⌥W",
    closeAllTabs: isMac ? "⌃⌥W" : "^⌥W",
    toggleSidebar: isMac ? "⌘\\" : "^\\",
    widenChat: isMac ? "⌘⇧\\" : "^⇧\\",
  };
}

export interface AgentPanelCodeAccess {
  enabled: boolean;
  unavailableTitle?: string;
  unavailableDescription?: string;
  unavailableCtaLabel?: string;
  unavailableCtaHref?: string;
  unavailableSecondaryCtaLabel?: string;
  unavailableSecondaryCtaHref?: string;
  /** @deprecated Chat stays available when code access is unavailable. */
  unavailableComposerPlaceholder?: string;
}

function useBuilderConnectUrl() {
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastConfigured = false;
    const refresh = () => {
      fetchBuilderStatus<{
        connectUrl?: string;
        configured?: boolean;
      }>()
        .then((result) => (result.state === "available" ? result.value : null))
        .then((data) => {
          if (cancelled || !data) return;
          const nextConnectUrl = data.connectUrl;
          if (nextConnectUrl) setConnectUrl(nextConnectUrl);
          const nextConfigured = !!data.configured;
          setConfigured(nextConfigured);
          if (nextConfigured && !lastConfigured) {
            lastConfigured = true;
            window.dispatchEvent(
              new CustomEvent("agent-engine:configured-changed", {
                detail: { source: "builder-status" },
              }),
            );
          } else if (!nextConfigured) {
            lastConfigured = false;
          }
        })
        .catch(() => {});
    };
    refresh();
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onConfigured = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { source?: string }
        | undefined;
      if (detail?.source === "builder-status") return;
      refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("agent-engine:configured-changed", onConfigured);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(`builder-connect:${window.location.host}`);
      channel.onmessage = (e: MessageEvent) => {
        const data = e.data as { type?: string } | undefined;
        if (data?.type === "builder-connect-success") refresh();
      };
    } catch {
      // BroadcastChannel missing — focus/visibility refresh still covers it.
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string } | undefined;
      if (data?.type === "builder-connect-success") refresh();
    };
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(
        "agent-engine:configured-changed",
        onConfigured,
      );
      window.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, []);

  return { connectUrl, configured };
}

export interface AgentPanelProps extends Omit<
  AssistantChatProps,
  "onSwitchToCli"
> {
  defaultMode?: "chat" | "cli";
  className?: string;
  style?: React.CSSProperties;
  onCollapse?: () => void;
  showCollapseButton?: boolean;
  isFullscreen?: boolean;
  /** @deprecated Fullscreen sidebar controls are no longer rendered. */
  onToggleFullscreen?: () => void;
  onFullViewRequest?: () => void;
  onSnapTo75Percent?: () => void;
  isWideDrawer?: boolean;
  onExitWideDrawer?: () => void;
  onOpenSettings?: (section?: string) => void;
  onNewCliTab?: () => void;
  onNewUiTab?: () => void;
  renderCliTab?: (input: { id: string; active: boolean }) => React.ReactNode;
  newTabMode?: "ui" | "cli";
  newCliTabLabel?: string;
  newUiTabLabel?: string;
  storageKey?: string;
  restoreActiveThread?: boolean;
  scope?: import("./use-chat-threads.js").ChatThreadScope | null;
  isolateHistoryByScope?: boolean;
  /** @deprecated Scope context now appears inside the composer. */
  showScopeBadge?: MultiTabAssistantChatProps["showScopeBadge"];
  browserTabId?: string;
  threadUrlSync?: MultiTabAssistantChatProps["threadUrlSync"];
  chatNotice?: React.ReactNode;
  showTabBar?: boolean;
  showPageNewChatButton?: boolean;
  showPageHeader?: boolean;
  pageHeaderLeadingSlot?: React.ReactNode;
  pageToolbarSlot?: React.ReactNode;
  onPageHeaderVisibilityChange?: (visible: boolean) => void;
  chatOnly?: boolean;
  agentPageHref?: string;
  codeAccess?: AgentPanelCodeAccess;
}

function useClientOnly() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function PageHeaderVisibilityReporter({
  visible,
  onVisibilityChange,
}: {
  visible: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [onVisibilityChange, visible]);
  return null;
}

const DESKTOP_CODE_SURFACE_QUERY_PARAM = "_agentNativeDesktopCode";
const DESKTOP_CODE_SURFACE_SESSION_KEY = "agent-native:desktop-code-surface";

function isDesktopCodeSurfaceRequested(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const requested =
      new URLSearchParams(window.location.search).get(
        DESKTOP_CODE_SURFACE_QUERY_PARAM,
      ) === "1";
    if (requested) {
      window.sessionStorage.setItem(DESKTOP_CODE_SURFACE_SESSION_KEY, "1");
      return true;
    }
    return (
      window.sessionStorage.getItem(DESKTOP_CODE_SURFACE_SESSION_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function resolveAgentPanelChatSurface(
  explicitSurface: AgentChatSurfaceKind | undefined,
  desktopCodeSurfaceRequested: boolean,
): AgentChatSurfaceKind {
  if (explicitSurface) return explicitSurface;
  return desktopCodeSurfaceRequested ? "desktop" : "app";
}

function CodeAccessUnavailablePanel({
  title,
  description,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel = "Use Builder",
  secondaryCtaHref,
  compact = false,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  compact?: boolean;
}) {
  const { connectUrl: builderConnectUrl } = useBuilderConnectUrl();
  const builderHref = secondaryCtaHref
    ? withBuilderUtmTrackingParams(secondaryCtaHref, {
        campaign: "product",
        content: "code_access_unavailable_panel",
      })
    : builderConnectUrl
      ? withBuilderConnectTrackingParams(builderConnectUrl, {
          source: "code_access_unavailable_panel",
          flow: "background_agent",
        })
      : withBuilderUtmTrackingParams("https://builder.io", {
          content: "code_access_unavailable_panel",
        });

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/35 text-center",
        compact ? "mx-3 mt-2 px-3 py-2.5" : "max-w-[300px] px-4 py-4",
      )}
    >
      <div
        className={cn(
          "mx-auto flex items-center justify-center rounded-full bg-background text-muted-foreground",
          compact ? "mb-2 h-8 w-8" : "mb-3 h-10 w-10",
        )}
      >
        <IconTerminal2 className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p
        className={cn(
          "mt-1 text-muted-foreground",
          compact ? "text-[11px] leading-snug" : "text-xs leading-relaxed",
        )}
      >
        {description}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {ctaHref ? (
          <a
            href={ctaHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
          >
            {ctaLabel}
            <IconExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        <a
          href={builderHref}
          target="_blank"
          rel="noreferrer"
          onClick={() => {
            trackEvent("builder connect clicked", {
              feature: "builder",
              stage: "client",
              source: "code_access_unavailable_panel",
              flow: "background_agent",
              connect_url_kind: builderConnectUrl ? "provided" : "fallback",
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          {secondaryCtaLabel}
        </a>
      </div>
    </div>
  );
}

function AgentPanelInner({
  defaultMode = "chat",
  className,
  style,
  apiUrl,
  emptyStateText,
  emptyStateAddon,
  emptyStateFooter,
  onMessageCountChange,
  suggestions,
  dynamicSuggestions,
  showHeader = true,
  onCollapse,
  showCollapseButton = true,
  isFullscreen,
  onToggleFullscreen,
  onFullViewRequest,
  onSnapTo75Percent,
  isWideDrawer,
  onExitWideDrawer,
  onOpenSettings,
  onNewCliTab,
  onNewUiTab,
  renderCliTab,
  newTabMode = "ui",
  newCliTabLabel,
  newUiTabLabel,
  storageKey,
  restoreActiveThread = true,
  scope,
  isolateHistoryByScope = false,
  showScopeBadge,
  browserTabId,
  threadUrlSync,
  chatNotice,
  showTabBar = true,
  showPageNewChatButton = false,
  showPageHeader = false,
  pageHeaderLeadingSlot,
  pageToolbarSlot,
  onPageHeaderVisibilityChange,
  chatOnly = false,
  agentPageHref,
  codeAccess,
  ...assistantChatProps
}: AgentPanelProps) {
  const t = useT();
  const location = useLocation();
  const mounted = useClientOnly();
  const onboardingPreviewMode = useOnboardingPreviewMode();
  const firstRunOnboardingGateOwnsSurface =
    useFirstRunOnboardingGateOwnsSurface();
  const showFirstRunOnboarding =
    !firstRunOnboardingGateOwnsSurface &&
    (SHOW_FIRST_RUN_ONBOARDING || onboardingPreviewMode);
  const insideAgentSidebar = React.useContext(AgentSidebarOnboardingContext);
  const isFirstRunOnboardingSurface =
    showFirstRunOnboarding && !insideAgentSidebar;
  const feedbackEnabled =
    resolveFeedbackUrl(undefined, mounted ? undefined : null) !== null;
  const keyPrefix = storageKey ? `:${storageKey}` : "";
  const execModeKey = `${EXEC_MODE_KEY}${keyPrefix}`;
  const panelModeKey = `agent-native-panel-mode${keyPrefix}`;
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad/.test(navigator.userAgent),
    [],
  );
  const {
    closeTab: closeTabHint,
    closeAllTabs: closeAllTabsHint,
    toggleSidebar: toggleSidebarHint,
    widenChat: widenChatHint,
  } = getAgentPanelShortcutHints(isMac);

  const [execMode, setExecMode] = useState<ExecMode>(() => {
    try {
      const saved = localStorage.getItem(execModeKey);
      if (saved === "build" || saved === "plan") return saved;
    } catch {}
    return "build";
  });

  const switchExecMode = useCallback(
    (next: ExecMode) => {
      setExecMode(next);
      try {
        localStorage.setItem(execModeKey, next);
      } catch {}
      window.dispatchEvent(
        new CustomEvent("agent-panel:exec-mode-change", {
          detail: { mode: next },
        }),
      );
    },
    [execModeKey],
  );

  const [mode, setMode] = useState<PanelMode>(() => {
    try {
      const saved = localStorage.getItem(panelModeKey);
      return normalizeAgentPanelModeForSurface(saved ?? defaultMode, chatOnly);
    } catch {}
    return normalizeAgentPanelModeForSurface(defaultMode, chatOnly);
  });
  useEffect(() => {
    try {
      localStorage.setItem(panelModeKey, mode);
    } catch {}
  }, [mode, panelModeKey]);
  const switchMode = useCallback(
    (m: PanelMode) => {
      startTransition(() =>
        setMode(normalizeAgentPanelModeForSurface(m, chatOnly)),
      );
    },
    [chatOnly],
  );
  const previousDefaultModeRef = useRef(defaultMode);
  useEffect(() => {
    if (previousDefaultModeRef.current === defaultMode) return;
    previousDefaultModeRef.current = defaultMode;
    switchMode(defaultMode);
  }, [defaultMode, switchMode]);
  useEffect(() => {
    const nextMode = normalizeAgentPanelModeForSurface(mode, chatOnly);
    if (nextMode !== mode) switchMode(nextMode);
  }, [mode, chatOnly, switchMode]);
  const openRunThread = useCallback(
    (threadId: string, run?: AgentRun) => {
      switchMode("chat");
      const metadata = run?.metadata ?? {};
      const parentThreadId =
        typeof metadata.parentThreadId === "string"
          ? metadata.parentThreadId.trim()
          : "";
      const isAgentTeam =
        metadata.kind === "agent-team" || metadata.source === "agent-teams";
      if (isAgentTeam && parentThreadId && parentThreadId !== threadId) {
        window.dispatchEvent(
          new CustomEvent("agent-task-open", {
            detail: {
              threadId,
              parentThreadId,
              description:
                typeof metadata.description === "string"
                  ? metadata.description
                  : run?.title || "",
              name: typeof metadata.name === "string" ? metadata.name : "",
            },
          }),
        );
        return;
      }
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId },
        }),
      );
    },
    [switchMode],
  );
  const activateOnKeyDown = useCallback(
    (activate: () => void) => (event: React.KeyboardEvent) => {
      if (!ACTIVATE_KEYS.has(event.key)) return;
      event.preventDefault();
      activate();
    },
    [],
  );

  useEffect(() => {
    function handler(e: Event) {
      const requestedMode = (e as CustomEvent<{ mode?: unknown }>).detail?.mode;
      if (
        requestedMode === "chat" ||
        requestedMode === "cli" ||
        requestedMode === "resources"
      ) {
        switchMode(requestedMode);
      }
    }
    window.addEventListener(AGENT_PANEL_SET_MODE_EVENT, handler);
    return () =>
      window.removeEventListener(AGENT_PANEL_SET_MODE_EVENT, handler);
  }, [switchMode]);

  const [cliTabs, setCliTabs] = useState<string[]>(["cli-1"]);
  const [activeCliTab, setActiveCliTab] = useState("cli-1");
  const [mountedCliTabs, setMountedCliTabs] = useState<string[]>([]);
  const cliCounter = useRef(1);

  useEffect(() => {
    if (mode !== "cli" || !activeCliTab) return;
    setMountedCliTabs((current) =>
      current.includes(activeCliTab) ? current : [...current, activeCliTab],
    );
  }, [activeCliTab, mode]);

  const addCliTab = useCallback(() => {
    const id = `cli-${++cliCounter.current}`;
    setCliTabs((prev) => [...prev, id]);
    setActiveCliTab(id);
  }, []);
  const openNewCliTab = useCallback(() => {
    if (onNewCliTab) {
      onNewCliTab();
      return;
    }
    addCliTab();
    switchMode("cli");
  }, [addCliTab, onNewCliTab, switchMode]);
  const openNewUiTab = useCallback(
    (addTab: () => void) => {
      if (onNewUiTab) {
        onNewUiTab();
        return;
      }
      addTab();
      switchMode("chat");
    },
    [onNewUiTab, switchMode],
  );
  const cliTabsToRender = renderCliTab
    ? cliTabs.filter((id) => mountedCliTabs.includes(id))
    : cliTabs;

  const closeCliTab = useCallback(
    (id: string) => {
      setCliTabs((prev) => {
        if (prev.length <= 1) {
          const newId = `cli-${++cliCounter.current}`;
          setActiveCliTab(newId);
          return [newId];
        }
        const next = prev.filter((t) => t !== id);
        if (id === activeCliTab) {
          const idx = prev.indexOf(id);
          setActiveCliTab(next[Math.min(idx, next.length - 1)]);
        }
        return next;
      });
    },
    [activeCliTab],
  );

  const closeOtherCliTabs = useCallback((id: string) => {
    setCliTabs([id]);
    setActiveCliTab(id);
  }, []);

  const closeAllCliTabs = useCallback(() => {
    const id = `cli-${++cliCounter.current}`;
    setCliTabs([id]);
    setActiveCliTab(id);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyW" || e.metaKey || e.shiftKey) return;
      const isCloseAll = e.ctrlKey && e.altKey;
      const isCloseOne = isMac
        ? e.ctrlKey && !e.altKey
        : e.altKey && !e.ctrlKey;
      if (!isCloseAll && !isCloseOne) return;
      e.preventDefault();
      if (mode === "chat") {
        window.dispatchEvent(
          new CustomEvent(
            isCloseAll
              ? "agent-chat:close-all-tabs"
              : "agent-chat:close-current-tab",
          ),
        );
      } else if (mode === "cli") {
        if (isCloseAll) closeAllCliTabs();
        else if (activeCliTab) closeCliTab(activeCliTab);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mode, activeCliTab, closeCliTab, closeAllCliTabs, isMac]);

  const availableClis = useAvailableClis();
  const [selectedCli, selectCli] = useCliSelection(keyPrefix);
  const { isDevMode } = useDevMode(apiUrl);
  const effectiveAgentChatSurface = resolveAgentPanelChatSurface(
    assistantChatProps.agentChatSurface,
    isDesktopCodeSurfaceRequested(),
  );
  const isDevFrameChatSurface = effectiveAgentChatSurface === "dev-frame";
  const isCodeEditingChatSurface =
    isDevFrameChatSurface || effectiveAgentChatSurface === "desktop";
  const inferredCodeAccessEnabled = !isDevMode || isCodeEditingChatSurface;
  const codeAccessEnabled = codeAccess?.enabled ?? inferredCodeAccessEnabled;
  const codeUnavailableTitle =
    codeAccess?.unavailableTitle ?? t("agentPanel.openDesktopToEditCode");
  const codeUnavailableDescription =
    codeAccess?.unavailableDescription ??
    t("agentPanel.codeUnavailableDescription");
  const codeUnavailableCtaLabel =
    codeAccess?.unavailableCtaLabel ?? t("agentPanel.downloadDesktop");
  const codeUnavailableCtaHref =
    codeAccess?.unavailableCtaHref ?? "https://www.agent-native.com/download";
  const codeUnavailableSecondaryCtaLabel =
    codeAccess?.unavailableSecondaryCtaLabel ?? t("agentPanel.useBuilder");
  const codeUnavailableSecondaryCtaHref =
    codeAccess?.unavailableSecondaryCtaHref;
  const canUseCodeTools =
    isDevMode && codeAccessEnabled && isCodeEditingChatSurface;
  const showCliMode =
    Boolean(renderCliTab) ||
    ((isDevMode || !codeAccessEnabled) && isCodeEditingChatSurface);
  useEffect(() => {
    if (mode === "cli" && !showCliMode) switchMode("chat");
  }, [mode, showCliMode, switchMode]);

  const prevIsDevMode = useRef(isDevMode);
  useEffect(() => {
    if (prevIsDevMode.current !== isDevMode) {
      prevIsDevMode.current = isDevMode;
      window.dispatchEvent(
        new CustomEvent("agent-panel:dev-mode-change", {
          detail: { isDevMode },
        }),
      );
      if (window.parent !== window) {
        window.parent.postMessage(
          { type: "agentNative.devModeChange", data: { isDevMode } },
          parentFrameTargetOrigin(),
        );
      }
    }
  }, [isDevMode]);

  const renderModeButtons = useCallback(
    (activeMode: PanelMode) => (
      <div className="flex shrink-0 items-center gap-1">
        <DesignSystemTooltip
          trigger={
            <button
              onClick={() => switchMode("chat")}
              aria-label={t("agentPanel.chatMode")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
                activeMode === "chat"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              style={AGENT_PANEL_CONTROL_STYLE}
            >
              <IconMessageCircle size={14} />
              {t("agentPanel.chat")}
            </button>
          }
          content={t("agentPanel.chatMode")}
          delayMs={200}
        />
        {showCliMode && (
          <DesignSystemTooltip
            trigger={
              <button
                onClick={() => switchMode("cli")}
                aria-label={t("agentPanel.cliTerminalMode")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
                  activeMode === "cli"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={AGENT_PANEL_CONTROL_STYLE}
              >
                <IconTerminal2 size={14} />
                {t("agentPanel.cli")}
              </button>
            }
            content={
              codeAccessEnabled
                ? t("agentPanel.cliTerminalMode")
                : codeUnavailableDescription
            }
            className="max-w-[260px]"
            delayMs={200}
          />
        )}
        <DesignSystemTooltip
          trigger={
            <button
              onClick={() => switchMode("resources")}
              aria-label={t("agentPanel.workspaceMode")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
                activeMode === "resources"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              style={AGENT_PANEL_CONTROL_STYLE}
            >
              <IconLayoutGrid size={14} />
              {t("agentPanel.workspace")}
            </button>
          }
          content={t("agentPanel.workspaceMode")}
          delayMs={200}
        />
      </div>
    ),
    [codeAccessEnabled, codeUnavailableDescription, showCliMode, t],
  );

  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [shareFromMenuOpen, setShareFromMenuOpen] = useState(false);
  const preventHeaderMenuFocusRestoreRef = useRef(false);
  const closeHeaderMenuForOverlay = useCallback(() => {
    preventHeaderMenuFocusRestoreRef.current = true;
    setHeaderMenuOpen(false);
  }, []);

  const getChatThreadShareUrl = useCallback(
    (threadId: string) => {
      if (typeof window === "undefined") return undefined;
      if (
        threadUrlSync &&
        typeof threadUrlSync === "object" &&
        typeof threadUrlSync.getPath === "function"
      ) {
        return new URL(
          appPath(threadUrlSync.getPath(threadId)),
          window.location.origin,
        ).toString();
      }
      const url = new URL(window.location.href);
      url.searchParams.set("thread", threadId);
      return url.toString();
    },
    [threadUrlSync],
  );
  const wideDrawerAction = isWideDrawer ? onExitWideDrawer : onSnapTo75Percent;
  const wideDrawerLabel = t(
    isWideDrawer ? "agentPanel.returnChatToLayout" : "agentPanel.widenChat",
  );
  const fullViewAction = resolveAgentPanelFullViewAction(
    agentPageHref,
    onFullViewRequest,
    mode,
    chatOnly,
    location.pathname,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      if (
        event.code === "Backslash" &&
        onCollapse &&
        mode === "chat" &&
        wideDrawerAction
      ) {
        event.preventDefault();
        wideDrawerAction();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mode, onCollapse, wideDrawerAction]);

  const renderHeaderActions = useCallback(
    ({
      activeChatSessionId,
      activeTabId,
      activeTabMessageCount,
      addTab,
      clearActiveTab,
      closeAllTabs,
      closeOtherTabs,
      closeTab,
      showHistory,
      tabs,
      toggleHistory,
    }: Pick<
      MultiTabAssistantChatHeaderProps,
      | "activeTabId"
      | "activeTabMessageCount"
      | "addTab"
      | "clearActiveTab"
      | "closeAllTabs"
      | "closeOtherTabs"
      | "closeTab"
      | "showHistory"
      | "tabs"
      | "toggleHistory"
    > & { activeChatSessionId?: string }) => (
      <div className="relative flex shrink-0 items-center gap-0.5">
        {!onCollapse && SHOW_ONBOARDING && (
          <Suspense fallback={null}>
            <SetupButton />
          </Suspense>
        )}
        {(!onCollapse || shareFromMenuOpen) &&
          (() => {
            const activeTab =
              mode === "chat" && activeChatSessionId
                ? tabs.find((tab) => tab.id === activeChatSessionId)
                : undefined;
            if (
              !activeTab ||
              (activeTabMessageCount <= 0 && activeTab.status === "idle")
            ) {
              return null;
            }
            return (
              <ShareButton
                resourceType="chat_thread"
                resourceId={activeTab.id}
                allowedRoles={["viewer", "editor", "admin"]}
                resourceTitle={activeTab.label || t("agentPanel.chat")}
                shareUrl={getChatThreadShareUrl(activeTab.id)}
                triggerClassName="h-7 px-2"
                defaultOpen={onCollapse && shareFromMenuOpen}
                onOpenChange={onCollapse ? setShareFromMenuOpen : undefined}
              />
            );
          })()}
        {feedbackEnabled ? (
          <FeedbackButton
            variant="icon"
            side="bottom"
            align="end"
            chatSessionId={activeChatSessionId}
            chatStorageKey={storageKey}
            open={feedbackOpen}
            onOpenChange={setFeedbackOpen}
            trigger={
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none absolute end-0 top-full h-px w-px opacity-0"
              />
            }
          />
        ) : null}
        {mode === "chat" && (
          <IconTooltip
            content={
              newTabMode === "cli" && newCliTabLabel
                ? newCliTabLabel
                : (newUiTabLabel ?? t("agentPanel.newChat"))
            }
          >
            <button
              onClick={newTabMode === "cli" ? openNewCliTab : addTab}
              aria-label={
                newTabMode === "cli" && newCliTabLabel
                  ? newCliTabLabel
                  : (newUiTabLabel ?? t("agentPanel.newChat"))
              }
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <IconPlus size={14} />
            </button>
          </IconTooltip>
        )}
        {mode === "cli" && (canUseCodeTools || renderCliTab) && (
          <IconTooltip content={t("agentPanel.newTerminal")}>
            <button
              onClick={openNewCliTab}
              aria-label={t("agentPanel.newTerminal")}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <IconPlus size={14} />
            </button>
          </IconTooltip>
        )}
        <DropdownMenu open={headerMenuOpen} onOpenChange={setHeaderMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                headerMenuOpen && "bg-accent text-foreground",
              )}
              aria-label={t("agentPanel.panelOptions")}
            >
              <IconDotsVertical size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-48 overflow-y-auto"
            onCloseAutoFocus={(event) => {
              consumeAgentPanelOverlayFocusRestore(
                preventHeaderMenuFocusRestoreRef,
                event,
              );
            }}
          >
            {onCollapse && (
              <>
                <DropdownMenuItem onSelect={onCollapse}>
                  <IconLayoutSidebarRightCollapse
                    size={14}
                    className="shrink-0"
                  />
                  {t("agentPanel.collapseSidebar")}
                  <DropdownMenuShortcut>
                    {toggleSidebarHint}
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {onCollapse && mode === "chat" && wideDrawerAction ? (
              <DropdownMenuItem onSelect={wideDrawerAction}>
                <IconArrowsHorizontal size={14} className="shrink-0" />
                {wideDrawerLabel}
                <DropdownMenuShortcut>{widenChatHint}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : null}
            {fullViewAction?.kind === "callback" && onFullViewRequest ? (
              <DropdownMenuItem
                onSelect={onFullViewRequest}
                aria-label={t("agentPanel.openFullView")}
              >
                <IconArrowsMaximize size={14} className="shrink-0" />
                {t("agentPanel.openFullView")}
              </DropdownMenuItem>
            ) : fullViewAction?.kind === "link" ? (
              <DropdownMenuItem asChild>
                <Link
                  to={fullViewAction.href}
                  aria-label={t("agentPanel.openFullView")}
                >
                  <IconArrowsMaximize size={14} className="shrink-0" />
                  {t("agentPanel.openFullView")}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {(onCollapse && mode === "chat" && wideDrawerAction) ||
            fullViewAction ? (
              <DropdownMenuSeparator />
            ) : null}
            {onCollapse &&
              (newTabMode === "cli" || (mode === "cli" && renderCliTab)) && (
                <>
                  <DropdownMenuItem onSelect={() => openNewUiTab(addTab)}>
                    <IconPlus size={14} className="shrink-0" />
                    {newUiTabLabel ?? t("agentPanel.newChat")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openNewCliTab}>
                    <IconTerminal2 size={14} className="shrink-0" />
                    {newCliTabLabel ?? t("agentPanel.newTerminal")}
                  </DropdownMenuItem>
                  {mode === "chat" ? <DropdownMenuSeparator /> : null}
                </>
              )}
            {onCollapse && mode === "chat" && newTabMode !== "cli" && (
              <DropdownMenuItem onSelect={() => openNewUiTab(addTab)}>
                <IconPlus size={14} className="shrink-0" />
                {newUiTabLabel ?? t("agentPanel.newChat")}
              </DropdownMenuItem>
            )}
            {onCollapse &&
            mode === "chat" &&
            renderCliTab &&
            newTabMode !== "cli" ? (
              <DropdownMenuItem onSelect={openNewCliTab}>
                <IconTerminal2 size={14} className="shrink-0" />
                {newCliTabLabel ?? t("agentPanel.newTerminal")}
              </DropdownMenuItem>
            ) : null}
            {mode === "chat" &&
            newTabMode !== "cli" &&
            onNewCliTab &&
            newCliTabLabel ? (
              <DropdownMenuItem onSelect={onNewCliTab}>
                <IconTerminal2 size={14} className="shrink-0" />
                {newCliTabLabel}
              </DropdownMenuItem>
            ) : null}
            {onCollapse &&
              mode === "chat" &&
              (() => {
                const activeTab = activeChatSessionId
                  ? tabs.find((tab) => tab.id === activeChatSessionId)
                  : undefined;
                if (
                  !activeTab ||
                  (activeTabMessageCount <= 0 && activeTab.status === "idle")
                ) {
                  return null;
                }
                return (
                  <DropdownMenuItem
                    onSelect={(event) =>
                      deferAgentPanelOverlayOpen(
                        event,
                        closeHeaderMenuForOverlay,
                        () => setShareFromMenuOpen(true),
                        "timeout",
                      )
                    }
                  >
                    <IconShare3 size={14} className="shrink-0" />
                    {t("agentChat.share.share", { defaultValue: "Share" })}
                  </DropdownMenuItem>
                );
              })()}
            {mode === "chat" && toggleHistory && (
              <DropdownMenuItem
                onSelect={(event) =>
                  deferAgentPanelOverlayOpen(
                    event,
                    closeHeaderMenuForOverlay,
                    toggleHistory,
                    "timeout",
                  )
                }
              >
                <IconHistory size={14} className="shrink-0" />
                {showHistory
                  ? t("agentPanel.hideChats")
                  : t("agentPanel.allChats")}
              </DropdownMenuItem>
            )}
            {mode === "chat" && (
              <RunsTrayMenuItem
                pollMs={0}
                limit={12}
                showRecent={true}
                onOpenThread={openRunThread}
              />
            )}
            {mode === "chat" && <DropdownMenuSeparator />}
            {mode === "cli" && availableClis.length > 0 && (
              <>
                {availableClis.map((cli) => (
                  <DropdownMenuItem
                    key={cli.command}
                    onSelect={() => selectCli(cli.command)}
                    className={cn(
                      cli.command === selectedCli
                        ? "font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {cli.command === selectedCli ? (
                      <IconCheck size={12} className="shrink-0" />
                    ) : (
                      <span className="w-3" />
                    )}
                    {cli.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            {feedbackEnabled ? (
              <DropdownMenuItem
                onSelect={(event) =>
                  deferAgentPanelOverlayOpen(
                    event,
                    closeHeaderMenuForOverlay,
                    () => setFeedbackOpen(true),
                  )
                }
              >
                <IconMessageDots size={14} className="shrink-0" />
                {t("agentPanel.feedback")}
              </DropdownMenuItem>
            ) : null}
            {((mode === "chat" && activeTabId) ||
              (mode === "cli" &&
                (canUseCodeTools || renderCliTab) &&
                activeCliTab)) && (
              <>
                <DropdownMenuSeparator />
                {mode === "chat" ? (
                  shouldShowAgentPanelChatTabBar(tabs, activeTabId) ? (
                    <>
                      <DropdownMenuItem onSelect={() => closeTab(activeTabId)}>
                        <IconX size={14} className="shrink-0" />
                        {t("agentPanel.closeTab")}
                        <DropdownMenuShortcut>
                          {closeTabHint}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => closeOtherTabs(activeTabId)}
                      >
                        {t("agentPanel.closeOtherTabs")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => closeAllTabs()}>
                        {t("agentPanel.closeAllTabs")}
                        <DropdownMenuShortcut>
                          {closeAllTabsHint}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onSelect={clearActiveTab}>
                      <IconX size={14} className="shrink-0" />
                      {t("agentPanel.clearChat")}
                    </DropdownMenuItem>
                  )
                ) : (
                  <>
                    <DropdownMenuItem
                      onSelect={() => closeCliTab(activeCliTab)}
                    >
                      <IconX size={14} className="shrink-0" />
                      {t("agentPanel.closeTab")}
                      <DropdownMenuShortcut>
                        {closeTabHint}
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => closeOtherCliTabs(activeCliTab)}
                    >
                      {t("agentPanel.closeOtherTabs")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => closeAllCliTabs()}>
                      {t("agentPanel.closeAllTabs")}
                      <DropdownMenuShortcut>
                        {closeAllTabsHint}
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {onCollapse && showCollapseButton && (
          <IconTooltip content={t("agentPanel.collapseSidebar")}>
            <button
              type="button"
              onClick={onCollapse}
              aria-label={t("agentPanel.collapseSidebar")}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <IconX size={14} />
            </button>
          </IconTooltip>
        )}
      </div>
    ),
    [
      activeCliTab,
      addCliTab,
      availableClis,
      canUseCodeTools,
      closeHeaderMenuForOverlay,
      closeAllCliTabs,
      closeAllTabsHint,
      closeCliTab,
      closeOtherCliTabs,
      closeTabHint,
      feedbackOpen,
      feedbackEnabled,
      getChatThreadShareUrl,
      headerMenuOpen,
      isWideDrawer,
      mode,
      newTabMode,
      newCliTabLabel,
      newUiTabLabel,
      agentPageHref,
      fullViewAction,
      onCollapse,
      onFullViewRequest,
      onExitWideDrawer,
      onSnapTo75Percent,
      openRunThread,
      openNewCliTab,
      openNewUiTab,
      renderCliTab,
      selectCli,
      selectedCli,
      shareFromMenuOpen,
      showCollapseButton,
      storageKey,
      switchMode,
      t,
      wideDrawerAction,
      wideDrawerLabel,
      widenChatHint,
    ],
  );

  const renderPageChatOverlay = useCallback(
    ({
      activeTabId,
      activeTabMessageCount,
      addTab,
      clearActiveTab,
      showHistory,
      tabs,
      toggleHistory,
    }: MultiTabAssistantChatHeaderProps) => {
      const activeTab = activeTabId
        ? tabs.find((tab) => tab.id === activeTabId)
        : undefined;
      const pageHeaderVisible = shouldShowAgentPanelPageHeader(
        tabs,
        activeTabId,
        activeTabMessageCount,
      );
      const canShareActiveTab =
        activeTab && (activeTabMessageCount > 0 || activeTab.status !== "idle");
      const showNewChatAction =
        showPageNewChatButton &&
        shouldShowAgentPanelPageNewChatButton(
          tabs,
          activeTabId,
          activeTabMessageCount,
        );

      return (
        <>
          <PageHeaderVisibilityReporter
            visible={pageHeaderVisible}
            onVisibilityChange={onPageHeaderVisibilityChange}
          />
          {pageHeaderVisible ? (
            <>
              <div
                aria-hidden="true"
                data-agent-page-chat-fade=""
                className="agent-kit-page-fade pointer-events-none absolute inset-x-0 h-5 bg-gradient-to-b from-background/80 to-transparent"
              />
              <header
                data-agent-page-chat-header=""
                className="agent-kit-page-header absolute inset-x-0 top-0 flex items-center gap-3 border-b border-border/70 px-3 sm:px-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {pageHeaderLeadingSlot}
                  <h1 className="truncate text-xs font-medium text-foreground">
                    {activeTab?.label || t("agentPanel.newChat")}
                  </h1>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-agent-page-title-menu=""
                        aria-label={t("agentPanel.panelOptions")}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
                      >
                        <IconDotsVertical size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      sideOffset={5}
                      className="w-44"
                    >
                      {toggleHistory ? (
                        <DropdownMenuItem onSelect={toggleHistory}>
                          <IconHistory size={14} className="shrink-0" />
                          {showHistory
                            ? t("agentPanel.hideChats")
                            : t("agentPanel.allChats")}
                        </DropdownMenuItem>
                      ) : null}
                      {activeTabMessageCount > 0 ? (
                        <DropdownMenuItem onSelect={clearActiveTab}>
                          <IconX size={14} className="shrink-0" />
                          {t("agentPanel.clearChat")}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {activeTab?.status === "running" ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/55 animate-pulse motion-reduce:animate-none" />
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canShareActiveTab ? (
                    <ShareButton
                      resourceType="chat_thread"
                      resourceId={activeTab.id}
                      allowedRoles={["viewer", "editor", "admin"]}
                      resourceTitle={activeTab.label || t("agentPanel.chat")}
                      shareUrl={getChatThreadShareUrl(activeTab.id)}
                      triggerContent={
                        <IconShare3 size={15} aria-hidden="true" />
                      }
                      triggerClassName="size-8 p-0 border-0 bg-transparent shadow-none hover:bg-accent/60"
                    />
                  ) : null}
                  {pageToolbarSlot}
                  {showNewChatAction ? (
                    <button
                      type="button"
                      data-agent-page-new-chat=""
                      aria-label={t("agentPanel.newChat")}
                      onClick={() => {
                        addTab();
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background/95 px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <IconPlus size={14} />
                      <span>{t("agentPanel.newChat")}</span>
                    </button>
                  ) : null}
                </div>
              </header>
            </>
          ) : null}
        </>
      );
    },
    [
      getChatThreadShareUrl,
      onPageHeaderVisibilityChange,
      pageHeaderLeadingSlot,
      pageToolbarSlot,
      showPageNewChatButton,
      t,
    ],
  );

  const activeTabResizeObserverRef = useRef<ResizeObserver | null>(null);
  const scrollActiveTabIntoView = useCallback((el: HTMLDivElement) => {
    const container = el.parentElement;
    if (!container) return;
    requestAnimationFrame(() => {
      const delta = getActiveTabScrollDelta(
        container.getBoundingClientRect(),
        el.getBoundingClientRect(),
      );
      if (delta !== 0) container.scrollLeft += delta;
    });
  }, []);

  const activeTabRefCb = useCallback(
    (el: HTMLDivElement | null) => {
      activeTabResizeObserverRef.current?.disconnect();
      activeTabResizeObserverRef.current = null;
      if (!el) return;
      const container = el.parentElement;
      if (!container) return;

      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => scrollActiveTabIntoView(el));
      observer?.observe(container);
      activeTabResizeObserverRef.current = observer;
      scrollActiveTabIntoView(el);
    },
    [scrollActiveTabIntoView],
  );

  useEffect(() => () => activeTabResizeObserverRef.current?.disconnect(), []);

  const renderChatHeader = useCallback(
    ({
      tabs,
      activeTabId,
      activeTabMessageCount,
      setActiveTabId,
      addTab,
      clearActiveTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      showHistory,
      toggleHistory,
    }: MultiTabAssistantChatHeaderProps) => {
      const { activeTab, childTabs, focusParentId, hasSubTabs, mainTabs } =
        getAgentPanelChatTabGroups(tabs, activeTabId);
      const showSidebarChatTabs =
        Boolean(onCollapse) &&
        mode === "chat" &&
        shouldShowAgentPanelSidebarChatTabs(tabs);
      const showUnifiedSurfaceTabs = Boolean(
        onCollapse && renderCliTab && showTabBar,
      );
      const renderUnifiedSurfaceTabs = () => (
        <div
          className="agent-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label={t("agentPanel.panelOptions")}
          data-agent-panel-surface-tabs
        >
          {mode === "chat" &&
            mainTabs.map((tab) => {
              const isActive =
                mode === "chat" &&
                (tab.id === activeTabId ||
                  (tab.id === focusParentId &&
                    activeTab?.parentThreadId === tab.id));
              return (
                <div
                  key={tab.id}
                  className="agent-tab-group relative flex shrink-0 items-center"
                >
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={isActive}
                    ref={isActive ? activeTabRefCb : undefined}
                    onClick={() => {
                      setActiveTabId(tab.id);
                      switchMode("chat");
                    }}
                    onKeyDown={activateOnKeyDown(() => {
                      setActiveTabId(tab.id);
                      switchMode("chat");
                    })}
                    className={cn(
                      "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer min-w-[56px] max-w-[150px]",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="truncate pe-1">{tab.label}</span>
                    {tab.status === "running" && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={t("agentPanel.closeTab")}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: 28,
                      paddingRight: 6,
                      borderRadius: "0 6px 6px 0",
                      background:
                        "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                    }}
                  >
                    <IconX size={10} />
                  </button>
                </div>
              );
            })}
          {mode === "cli" &&
            cliTabs.map((id, index) => {
              const isActive = mode === "cli" && id === activeCliTab;
              return (
                <div
                  key={id}
                  className="agent-tab-group relative flex shrink-0 items-center"
                >
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={isActive}
                    ref={isActive ? activeTabRefCb : undefined}
                    onClick={() => {
                      setActiveCliTab(id);
                      switchMode("cli");
                    }}
                    onKeyDown={activateOnKeyDown(() => {
                      setActiveCliTab(id);
                      switchMode("cli");
                    })}
                    className={cn(
                      "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer min-w-[56px]",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span>Terminal {index + 1}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={t("agentPanel.closeTab")}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeCliTab(id);
                    }}
                    className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: 28,
                      paddingRight: 6,
                      borderRadius: "0 6px 6px 0",
                      background:
                        "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                    }}
                  >
                    <IconX size={10} />
                  </button>
                </div>
              );
            })}
        </div>
      );

      return (
        <div
          className="agent-sidebar-chat-header flex flex-col shrink-0"
          data-agent-sidebar-chat-header={onCollapse ? "" : undefined}
          data-agent-sidebar-chat-header-active={
            headerMenuOpen || feedbackOpen ? "" : undefined
          }
        >
          {/* Top bar: chat tabs/mode buttons + actions */}
          <div
            className={cn(
              AGENT_PANEL_HEADER_CLASS,
              !onCollapse && "border-b border-border",
            )}
            style={AGENT_PANEL_HEADER_STYLE}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {showUnifiedSurfaceTabs ? (
                renderUnifiedSurfaceTabs()
              ) : showSidebarChatTabs ? (
                <div className="agent-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                  {mainTabs.map((tab) => {
                    const isActive =
                      tab.id === activeTabId ||
                      (tab.id === focusParentId &&
                        activeTab?.parentThreadId === tab.id);
                    return (
                      <div
                        key={tab.id}
                        className="agent-tab-group relative shrink-0"
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          ref={isActive ? activeTabRefCb : undefined}
                          onClick={() => setActiveTabId(tab.id)}
                          onKeyDown={activateOnKeyDown(() =>
                            setActiveTabId(tab.id),
                          )}
                          className={cn(
                            "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer min-w-[56px] max-w-[150px]",
                            isActive
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <span className="truncate pe-1">{tab.label}</span>
                          {tab.status === "running" && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={t("agentPanel.closeTab")}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                          className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                          style={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            bottom: 0,
                            width: 28,
                            paddingRight: 6,
                            borderRadius: "0 6px 6px 0",
                            background:
                              "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                          }}
                        >
                          <IconX size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : shouldShowAgentPanelModeButtons(
                  Boolean(onCollapse),
                  chatOnly,
                ) ? (
                renderModeButtons(mode)
              ) : null}
            </div>
            <div className="flex items-center gap-0.5">
              {renderHeaderActions({
                activeChatSessionId: activeTabId,
                activeTabId,
                activeTabMessageCount,
                addTab,
                clearActiveTab,
                closeAllTabs,
                closeOtherTabs,
                closeTab,
                showHistory,
                tabs,
                toggleHistory,
              })}
            </div>
          </div>
          {mode === "chat" && chatNotice ? (
            <div className="border-b border-border">{chatNotice}</div>
          ) : null}
          {/* Tab bar: only visible when there is actually more than one tab to switch between. */}
          {showTabBar &&
            !showUnifiedSurfaceTabs &&
            (mode === "chat" ||
              (mode === "cli" && (canUseCodeTools || renderCliTab))) &&
            (() => {
              const showChatTabBar =
                mode === "chat" &&
                shouldShowAgentPanelChatTabBar(tabs, activeTabId);
              const showCliTabBar =
                mode === "cli" &&
                (canUseCodeTools || renderCliTab) &&
                shouldShowAgentPanelCliTabBar(cliTabs);

              if (!showChatTabBar && !showCliTabBar) return null;

              return (
                <>
                  {!showSidebarChatTabs && (
                    <div className="flex items-center px-2 py-1 border-b border-border gap-0.5">
                      <div className="agent-tabs-scroll flex items-center gap-0.5 min-w-0 overflow-x-auto flex-1">
                        {mode === "chat"
                          ? mainTabs.map((tab) => {
                              const isActive =
                                tab.id === activeTabId ||
                                (tab.id === focusParentId &&
                                  activeTab?.parentThreadId === tab.id);
                              return (
                                <div
                                  key={tab.id}
                                  className="agent-tab-group relative shrink-0"
                                >
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    ref={isActive ? activeTabRefCb : undefined}
                                    onClick={() => setActiveTabId(tab.id)}
                                    onKeyDown={activateOnKeyDown(() =>
                                      setActiveTabId(tab.id),
                                    )}
                                    className={cn(
                                      "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer min-w-[56px] max-w-[150px]",
                                      isActive
                                        ? "bg-accent text-foreground"
                                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                                    )}
                                  >
                                    <span className="truncate pe-1">
                                      {tab.label}
                                    </span>
                                    {tab.status === "running" && (
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    aria-label={t("agentPanel.closeTab")}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      closeTab(tab.id);
                                    }}
                                    className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                                    style={{
                                      position: "absolute",
                                      right: 0,
                                      top: 0,
                                      bottom: 0,
                                      width: 28,
                                      paddingRight: 6,
                                      borderRadius: "0 6px 6px 0",
                                      background:
                                        "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                                    }}
                                  >
                                    <IconX size={10} />
                                  </button>
                                </div>
                              );
                            })
                          : cliTabs.map((id, i) => (
                              <div
                                key={id}
                                className="agent-tab-group relative shrink-0"
                              >
                                <div
                                  role="button"
                                  tabIndex={0}
                                  ref={
                                    id === activeCliTab
                                      ? activeTabRefCb
                                      : undefined
                                  }
                                  onClick={() => setActiveCliTab(id)}
                                  onKeyDown={activateOnKeyDown(() =>
                                    setActiveCliTab(id),
                                  )}
                                  className={cn(
                                    "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer min-w-[56px]",
                                    id === activeCliTab
                                      ? "bg-accent text-foreground"
                                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                                  )}
                                >
                                  <span>Terminal {i + 1}</span>
                                </div>
                                <button
                                  type="button"
                                  aria-label={t("agentPanel.closeTab")}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    closeCliTab(id);
                                  }}
                                  className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                                  style={{
                                    position: "absolute",
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 28,
                                    paddingRight: 6,
                                    borderRadius: "0 6px 6px 0",
                                    background:
                                      "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                                  }}
                                >
                                  <IconX size={10} />
                                </button>
                              </div>
                            ))}
                      </div>
                    </div>
                  )}
                  {/* Sub-agent tab row — shown when the active context has children */}
                  {mode === "chat" && hasSubTabs && (
                    <div
                      className={cn(
                        "flex items-center px-2 py-0.5 gap-0.5 bg-muted/30",
                        !showSidebarChatTabs && "border-b border-border",
                      )}
                    >
                      <div className="agent-tabs-scroll flex items-center gap-0.5 min-w-0 overflow-x-auto flex-1">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setActiveTabId(focusParentId)}
                          onKeyDown={activateOnKeyDown(() =>
                            setActiveTabId(focusParentId),
                          )}
                          className={cn(
                            "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium cursor-pointer",
                            activeTabId === focusParentId
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          Main
                        </div>
                        {childTabs.map((tab) => (
                          <div
                            key={tab.id}
                            className="agent-tab-group relative shrink-0"
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              ref={
                                tab.id === activeTabId
                                  ? activeTabRefCb
                                  : undefined
                              }
                              onClick={() => setActiveTabId(tab.id)}
                              onKeyDown={activateOnKeyDown(() =>
                                setActiveTabId(tab.id),
                              )}
                              className={cn(
                                "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium cursor-pointer min-w-[48px] max-w-[140px]",
                                tab.id === activeTabId
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                            >
                              <span className="truncate pe-1">
                                {tab.subAgentName || tab.label}
                              </span>
                              {tab.status === "running" && (
                                <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
                              )}
                            </div>
                            <button
                              type="button"
                              aria-label={t("agentPanel.closeTab")}
                              onClick={(e) => {
                                e.stopPropagation();
                                closeTab(tab.id);
                              }}
                              className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                              style={{
                                position: "absolute",
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: 24,
                                paddingRight: 4,
                                borderRadius: "0 6px 6px 0",
                                background:
                                  "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                              }}
                            >
                              <IconX size={8} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
        </div>
      );
    },
    [
      mode,
      renderHeaderActions,
      renderModeButtons,
      chatNotice,
      canUseCodeTools,
      feedbackOpen,
      headerMenuOpen,
      onCollapse,
      showTabBar,
      cliTabs,
      activeCliTab,
      activeTabRefCb,
      activateOnKeyDown,
      closeCliTab,
      renderCliTab,
      switchMode,
      t,
    ],
  );

  return (
    <ThinkingDisplayProvider value={assistantChatProps.thinkingDisplay}>
      <AgentPanelSettingsNavigation onOpenSettings={onOpenSettings} />
      <div
        className={cn(
          "agent-panel-root agent-kit-density flex flex-1 flex-col min-h-0 min-w-0 h-full antialiased",
          className,
        )}
        style={{
          ...AGENT_PANEL_ROOT_STYLE,
          ...style,
          ...(isFirstRunOnboardingSurface ? { contain: "none" } : {}),
        }}
        data-agent-fullscreen={isFullscreen ? "true" : undefined}
      >
        {/* Fullscreen rules center the message stream and composer to a Claude-style
          column while leaving the header bar at full width so the action buttons
          stay pinned to the top corners. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              ".agent-tab-close{opacity:0;pointer-events:none}" +
              ".agent-tab-group:hover .agent-tab-close,.agent-tab-close:focus-visible{opacity:1;pointer-events:auto}" +
              ".agent-tabs-scroll{scrollbar-width:none;-ms-overflow-style:none;}" +
              ".agent-tabs-scroll::-webkit-scrollbar{display:none;}" +
              `[data-agent-fullscreen='true'] .agent-thread-content,` +
              `[data-agent-fullscreen='true'] .agent-running-activity{` +
              `max-width:var(--agent-kit-conversation-max-width);` +
              `margin-left:auto;margin-right:auto;width:100%;}` +
              `[data-agent-fullscreen='true'] [data-agent-suggestion-bar='true'],` +
              `[data-agent-fullscreen='true'] .agent-composer-area,` +
              `[data-agent-fullscreen='true'] .agent-plan-mode-callout{` +
              `max-width:var(--agent-kit-conversation-max-width);` +
              `margin-left:auto;margin-right:auto;width:100%;}` +
              `[data-agent-fullscreen='true'] .agent-composer-area:not(.agent-composer-area--compact){` +
              `padding-left:0;padding-right:0;}` +
              `[data-agent-fullscreen='true'] .agent-mcp-connection-suggestion--composer,` +
              `[data-agent-fullscreen='true'] .agent-mcp-connection-suggestion-error--composer{` +
              `max-width:var(--agent-kit-conversation-max-width);` +
              `margin-left:auto;margin-right:auto;width:100%;}`,
          }}
        />
        {/* Framework onboarding — appears above the chat, CLI, and resources tabs
          so it's visible regardless of which tab the user is on. The panel
          hides itself once all required steps are done or the user dismisses
          it. */}
        {SHOW_ONBOARDING && mounted && (
          <Suspense fallback={null}>
            <OnboardingPanel />
          </Suspense>
        )}

        {showFirstRunOnboarding && mounted && !insideAgentSidebar && (
          <Suspense fallback={null}>
            <FirstRunOnboarding />
          </Suspense>
        )}

        {/* Chat view — always mounted to preserve state.
          Header (with tabs + mode buttons) is always visible.
          Chat content is hidden when CLI or resources mode is active.
          The wrapper collapses (no flex-1) when another mode is active
          so it only takes the height of its header.
          The Suspense boundary renders the header chrome immediately while
          the lazy assistant-ui chunk loads in the background. */}
        <div
          className={cn(
            "flex flex-col min-h-0",
            mode === "chat" ? "flex-1" : "shrink-0",
          )}
        >
          {mounted && (
            <Suspense
              fallback={
                <ChatLoadingSkeleton
                  renderHeader={showHeader ? renderChatHeader : undefined}
                  centerComposerWhenEmpty={
                    assistantChatProps.centerComposerWhenEmpty
                  }
                  composerSlot={assistantChatProps.composerSlot}
                  composerAreaClassName={
                    assistantChatProps.composerAreaClassName
                  }
                  composerLayoutVariant={
                    assistantChatProps.composerLayoutVariant
                  }
                />
              }
            >
              <MultiTabAssistantChatLazy
                {...assistantChatProps}
                threadContentSlot={assistantChatProps.threadContentSlot}
                agentChatSurface={effectiveAgentChatSurface}
                apiUrl={apiUrl}
                showHeader={false}
                renderHeader={showHeader ? renderChatHeader : undefined}
                showTabBar={showTabBar}
                renderOverlay={
                  showPageHeader && !showHeader
                    ? renderPageChatOverlay
                    : undefined
                }
                contentHidden={mode !== "chat"}
                emptyStateText={emptyStateText}
                emptyStateAddon={emptyStateAddon}
                emptyStateFooter={emptyStateFooter}
                onMessageCountChange={onMessageCountChange}
                suggestions={suggestions}
                dynamicSuggestions={dynamicSuggestions}
                suggestionPlacement="context-chips"
                onSwitchToCli={() => switchMode("cli")}
                execMode={execMode}
                onExecModeChange={switchExecMode}
                storageKey={storageKey}
                restoreActiveThread={restoreActiveThread}
                scope={scope}
                isolateHistoryByScope={isolateHistoryByScope}
                showScopeBadge={showScopeBadge}
                browserTabId={browserTabId}
                threadUrlSync={threadUrlSync}
              />
            </Suspense>
          )}
        </div>

        {/* CLI terminals — code-capable dev mode: real terminal, otherwise handoff. */}
        {(canUseCodeTools || renderCliTab) &&
          (mode === "cli" || Boolean(renderCliTab)) &&
          cliTabsToRender.map((id) => (
            <div
              key={id}
              className="min-h-0 relative flex-1"
              style={{
                display:
                  mode === "cli" && id === activeCliTab ? undefined : "none",
              }}
            >
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    {t("agentPanel.loadingTerminal")}
                  </div>
                }
              >
                {renderCliTab ? (
                  renderCliTab({
                    id,
                    active: mode === "cli" && id === activeCliTab,
                  })
                ) : (
                  <AgentTerminal
                    command={selectedCli}
                    hideInFrame={false}
                    className="h-full"
                    style={{ background: "transparent" }}
                  />
                )}
              </Suspense>
            </div>
          ))}
        {!canUseCodeTools && !renderCliTab && mode === "cli" && (
          <div className="flex flex-1 flex-col items-center justify-center min-h-0 px-6 gap-3">
            <CodeAccessUnavailablePanel
              title={
                codeAccessEnabled
                  ? t("agentPanel.cliRequiresDevMode")
                  : codeUnavailableTitle
              }
              description={
                codeAccessEnabled
                  ? t("agentPanel.cliRequiresDevModeDescription")
                  : codeUnavailableDescription
              }
              ctaLabel={codeUnavailableCtaLabel}
              ctaHref={codeAccessEnabled ? undefined : codeUnavailableCtaHref}
              secondaryCtaLabel={codeUnavailableSecondaryCtaLabel}
              secondaryCtaHref={codeUnavailableSecondaryCtaHref}
            />
          </div>
        )}

        {/* Resources view */}
        {mode === "resources" && (
          <div className="flex flex-1 flex-col min-h-0">
            <Suspense
              fallback={
                <div className="flex h-full flex-col min-h-0">
                  <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <div className="h-5 w-16 rounded bg-muted animate-pulse" />
                      <div className="h-5 w-14 rounded bg-muted animate-pulse" />
                    </div>
                  </div>
                </div>
              }
            >
              <ResourcesPanel />
            </Suspense>
          </div>
        )}
      </div>
    </ThinkingDisplayProvider>
  );
}

export function getActiveTabScrollDelta(
  containerRect: Pick<DOMRect, "left" | "right">,
  tabRect: Pick<DOMRect, "left" | "right">,
  margin = 24,
): number {
  if (tabRect.left < containerRect.left + margin) {
    return tabRect.left - containerRect.left - margin;
  }
  if (tabRect.right > containerRect.right - margin) {
    return tabRect.right - containerRect.right + margin;
  }
  return 0;
}

class AgentPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { error: Error | null; staleIndexRecoveryCount: number }
> {
  state: { error: Error | null; staleIndexRecoveryCount: number } = {
    error: null,
    staleIndexRecoveryCount: 0,
  };

  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryCooldownTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (recoverFromStaleChunkError(error)) {
      console.warn(
        "[agent-native] Recovering agent panel after stale chunk error",
      );
      return;
    }
    const recoverableKind = assistantUiRecoverableRenderErrorKind(error);
    if (recoverableKind) {
      console.warn(
        "[agent-native] Recovering agent panel after assistant UI render error",
        recoverableKind,
      );
      if (this.state.staleIndexRecoveryCount >= 2) {
        console.error(
          "[agent-native] Agent panel assistant UI recovery failed",
          error,
          errorInfo,
        );
        return;
      }
      if (!this.recoveryTimer) {
        this.recoveryTimer = setTimeout(() => {
          this.recoveryTimer = null;
          this.setState((state) => ({
            error: null,
            staleIndexRecoveryCount: state.staleIndexRecoveryCount + 1,
          }));
          this.props.onReset();
        }, 0);
      }
      return;
    }
    console.error("[agent-native] Agent panel crashed", error, errorInfo);
  }

  componentDidUpdate(
    _prevProps: Readonly<{ children: React.ReactNode; onReset: () => void }>,
    prevState: Readonly<{
      error: Error | null;
      staleIndexRecoveryCount: number;
    }>,
  ) {
    if (
      prevState.error &&
      !this.state.error &&
      this.state.staleIndexRecoveryCount > 0
    ) {
      if (this.recoveryCooldownTimer) {
        clearTimeout(this.recoveryCooldownTimer);
      }
      this.recoveryCooldownTimer = setTimeout(() => {
        this.recoveryCooldownTimer = null;
        this.setState((state) =>
          state.error ? null : { staleIndexRecoveryCount: 0 },
        );
      }, 2_000);
    }
  }

  componentWillUnmount() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
    }
    if (this.recoveryCooldownTimer) {
      clearTimeout(this.recoveryCooldownTimer);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (
      assistantUiRecoverableRenderErrorKind(this.state.error) &&
      this.state.staleIndexRecoveryCount < 2
    ) {
      return <AgentPanelReloadingNotice />;
    }

    return (
      <AgentPanelErrorFallback
        details={this.state.error.message}
        onReset={() => {
          this.setState({ error: null, staleIndexRecoveryCount: 0 });
          this.props.onReset();
        }}
      />
    );
  }
}

function AgentPanelReloadingNotice() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
      {t("agentPanel.uiError.reloading")}
    </div>
  );
}

function AgentPanelErrorFallback({
  details,
  onReset,
}: {
  details: string;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="max-w-[260px] space-y-1">
        <p className="text-sm font-medium text-foreground">
          {t("agentPanel.uiError.title")}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("agentPanel.uiError.description")}
        </p>
      </div>
      <button
        type="button"
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        onClick={onReset}
      >
        {t("agentPanel.uiError.reset")}
      </button>
      <ErrorReportActions
        appName="Agent panel"
        title={t("agentPanel.uiError.title")}
        details={details}
        issueTitle="Agent panel UI error"
        className="max-w-[260px]"
        feedbackClassName="h-7"
        githubClassName="h-7"
      />
    </div>
  );
}

export function AgentPanel(props: AgentPanelProps) {
  const [resetKey, setResetKey] = useState(0);
  const resetPanel = useCallback(() => {
    try {
      const keyPrefix = props.storageKey ? `:${props.storageKey}` : "";
      localStorage.setItem(`agent-native-panel-mode${keyPrefix}`, "chat");
    } catch {}
    setResetKey((key) => key + 1);
  }, [props.storageKey]);
  const resolvedBrowserTabId =
    props.browserTabId ??
    (typeof window === "undefined" ? undefined : getBrowserTabId());
  return (
    <AgentPanelErrorBoundary onReset={resetPanel}>
      <AgentPanelInner
        key={resetKey}
        {...props}
        browserTabId={resolvedBrowserTabId}
      />
    </AgentPanelErrorBoundary>
  );
}

export type AgentChatSurfaceMode = "panel" | "page";

export interface AgentChatSurfaceProps extends AgentPanelProps {
  mode?: AgentChatSurfaceMode;
  chatViewTransition?: boolean;
}

export function shouldDefaultAgentChatSurfacePageNewChatButton(
  _mode: AgentChatSurfaceMode | undefined,
  _showTabBar: boolean | undefined,
): boolean {
  return false;
}

export function shouldDefaultAgentChatSurfacePageHeader(
  mode: AgentChatSurfaceMode | undefined,
): boolean {
  return mode === "page";
}

export function AgentChatSurface({
  mode = "panel",
  className,
  defaultMode = "chat",
  showHeader = false,
  showTabBar = false,
  isFullscreen,
  style,
  chatViewTransition = false,
  showPageNewChatButton,
  showPageHeader,
  ...props
}: AgentChatSurfaceProps) {
  const pageMode = mode === "page";
  const resolvedBrowserTabId =
    props.browserTabId ??
    (typeof window === "undefined" ? undefined : getBrowserTabId());
  const defaultShowPageNewChatButton =
    shouldDefaultAgentChatSurfacePageNewChatButton(mode, showTabBar);

  const panel = (
    <AgentPanel
      {...props}
      browserTabId={resolvedBrowserTabId}
      defaultMode={defaultMode}
      showHeader={showHeader}
      showTabBar={showTabBar}
      isFullscreen={isFullscreen ?? pageMode}
      showPageNewChatButton={
        showPageNewChatButton ?? defaultShowPageNewChatButton
      }
      showPageHeader={
        showPageHeader ?? shouldDefaultAgentChatSurfacePageHeader(mode)
      }
      className={cn(
        pageMode && "h-full min-h-0 w-full overflow-hidden bg-background",
        chatViewTransition && AGENT_CHAT_VIEW_TRANSITION_CLASS,
        className,
      )}
      style={
        chatViewTransition ? getAgentChatViewTransitionStyle(style) : style
      }
    />
  );

  if (!pageMode) return panel;
  return (
    <>
      <URLSync browserTabId={resolvedBrowserTabId} />
      {panel}
    </>
  );
}
