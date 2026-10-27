import type { ModelEngineConfig } from "@agent-native/core/agent/model-version";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { buildSettingsRoute } from "@agent-native/core/navigation";
import {
  isSettingsSectionId,
  SETTINGS_SECTION_ALIASES,
} from "@agent-native/core/navigation";
import type { AgentRun } from "@agent-native/core/progress";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared/builder-link-tracking";
import { Tooltip as DesignSystemTooltip } from "@agent-native/toolkit/design-system";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { normalizeTooltipText } from "@agent-native/toolkit/ui/tooltip";
import {
  IconMessageCircle,
  IconTerminal2,
  IconLayoutGrid,
  IconCheck,
  IconPlus,
  IconX,
  IconDotsVertical,
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
import { useLocation, useNavigate } from "react-router";

import { Skeleton } from "../../ui/skeleton.js";
import { resolveFeedbackUrl } from "../feedback/FeedbackButton.js";
import { ErrorReportActions, FeedbackButton } from "../feedback/index.js";
import { RunsTrayMenuItem } from "../progress/index.js";
import { ShareButton } from "../sharing/index.js";
import {
  AGENT_PANEL_OPEN_SETTINGS_EVENT,
  AGENT_PANEL_SET_MODE_EVENT,
} from "./agent-sidebar-events.js";
import type { AgentChatSurfaceKind } from "./chat/surface-types.js";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderCallbackProps,
  type MultiTabAssistantChatHeaderProps,
  type MultiTabAssistantChatProps,
} from "./MultiTabAssistantChat.js";
import { ThinkingDisplayProvider } from "./thinking-display.js";
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
import {
  AGENT_CHAT_VIEW_TRANSITION_CLASS,
  getAgentChatViewTransitionStyle,
} from "@agent-native/core/client/agent-chat";
import {
  fetchAvailableClis,
  useDevMode,
  type AvailableCli,
} from "@agent-native/core/client/agent-chat";
import { appPath } from "@agent-native/core/client/api-path";
import { getFramePostMessageTargetOrigin } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { isFirstRunOnboardingEnabled } from "@agent-native/core/client/onboarding";
import { useOnboardingPreviewMode } from "@agent-native/core/client/onboarding";
import { recoverFromStaleChunkError } from "@agent-native/core/client/route-chunk-recovery";
import { cn } from "@agent-native/toolkit/utils";

import { useFirstRunOnboardingGateOwnsSurface } from "../onboarding/first-run-startup-gate.js";
import {
  BuilderConnectPopover,
  SETTINGS_SECTION_STATE_KEY,
  useBuilderConnectFlow,
  type BuilderConnectTransport,
} from "../settings/index.js";
import { RouterSidebarLink } from "../shared/index.js";
import { useRegisterAgentChatSurface } from "./agent-chat-presence.js";
import { AgentSidebarOnboardingContext } from "./agent-sidebar-context.js";
import {
  SettingsReturnPathRecorder,
  URLSync,
} from "./agent-sidebar-url-sync.js";
import {
  AgentPanelTab,
  AgentPanelTabList,
  AgentPanelThreadNav,
  resolveAgentPanelTabLayout,
  useElementInlineSize,
  type AgentPanelThreadItem,
} from "./AgentPanelThreadTabs.js";
import type { AssistantChatProps } from "./chat/surface-types.js";
import { assistantUiRecoverableRenderErrorKind } from "./composer/assistant-ui-recovery.js";
function parentFrameTargetOrigin(): string {
  return getFramePostMessageTargetOrigin() ?? window.location.origin;
}

const AgentTerminal = lazy(() =>
  import("../terminal/index.js").then((m) => ({
    default: m.AgentTerminal,
  })),
);

/**
 * The section an `agent-panel:open-settings` request names. Callers that set
 * the hash and dispatch no section (run recovery's `#agent-limits`, the
 * composer's `#llm`) meant that hash.
 */
export function requestedSettingsSection(
  section?: string | null,
  currentHash?: string | null,
): string {
  const requested = section?.replace(/^#/, "").trim() ?? "";
  if (requested) return requested;
  const hash = currentHash?.replace(/^#/, "").trim() ?? "";
  return isSettingsSectionId(hash) || /^secrets:./i.test(hash) ? hash : "";
}

/** Today's Settings hash for a section; the redesigned shell reads the section itself. */
export function settingsRouteHashForSection(
  section?: string | null,
  currentHash?: string | null,
): string {
  const raw = requestedSettingsSection(section, currentHash);
  const lowered = raw.toLowerCase();
  const normalized = SETTINGS_SECTION_ALIASES[lowered] ?? lowered;
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
  onReadyChange,
}: {
  onOpenSettings?: (section?: string) => void;
  onReadyChange?: (ready: boolean) => void;
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
      const requested = requestedSettingsSection(section, window.location.hash);
      const navigation = navigate(
        {
          pathname: "/settings",
          hash: settingsRouteHashForSection(section, window.location.hash),
        },
        // The hash can't tell API keys from Integrations; the redesigned
        // Settings reads the section from history state instead.
        {
          state: requested ? { [SETTINGS_SECTION_STATE_KEY]: requested } : null,
        },
      );
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
    onReadyChange?.(true);
    return () => {
      onReadyChange?.(false);
      window.removeEventListener(
        AGENT_PANEL_OPEN_SETTINGS_EVENT,
        handleOpenSettings,
      );
    };
  }, [navigate, onOpenSettings, onReadyChange]);

  return null;
}
const ResourcesPanel = lazy(() =>
  import("../resources/ResourcesPanel.js").then((m) => ({
    default: m.ResourcesPanel,
  })),
);

const OnboardingPanel = lazy(() =>
  import("../onboarding/OnboardingPanel.js").then((m) => ({
    default: m.OnboardingPanel,
  })),
);

const FirstRunOnboarding = lazy(() =>
  import("../onboarding/FirstRunOnboarding.js").then((m) => ({
    default: m.FirstRunOnboarding,
  })),
);

const SetupButton = lazy(() =>
  import("../onboarding/SetupButton.js").then((m) => ({
    default: m.SetupButton,
  })),
);

const SHOW_ONBOARDING = false;
const SHOW_FIRST_RUN_ONBOARDING = isFirstRunOnboardingEnabled();

const CLI_STORAGE_KEY = "agent-native-cli-command";
const CLI_DEFAULT = "claude";
type PanelMode = "chat" | "cli" | "resources";
export function normalizeAgentPanelModeForSurface(
  mode: string,
  chatOnly = false,
): PanelMode {
  if (chatOnly) return "chat";
  return mode === "cli" || mode === "resources" ? mode : "chat";
}
const AGENT_PANEL_HEADER_CLASS =
  "agent-native-shell-topbar relative z-[240] flex h-12 shrink-0 items-center justify-between gap-2";
const AGENT_PANEL_HEADER_STYLE = {
  paddingLeft: 8,
  paddingRight: 8,
} satisfies React.CSSProperties;

export function deferAgentPanelOverlayOpen(
  event: { preventDefault: () => void },
  closeMenu: () => void,
  openOverlay: () => void,
  pendingOverlayRef: { current: (() => void) | null },
): void {
  event.preventDefault();
  pendingOverlayRef.current = openOverlay;
  closeMenu();
}

export function consumeAgentPanelOverlayFocusRestore(
  pendingOverlayRef: { current: (() => void) | null },
  event: { preventDefault: () => void },
): void {
  const openOverlay = pendingOverlayRef.current;
  if (!openOverlay) return;
  pendingOverlayRef.current = null;
  event.preventDefault();
  openOverlay();
}

const NO_CLIS: AvailableCli[] = [];

type AvailableClisState =
  | { status: "idle" | "loading" }
  | { status: "ready"; clis: AvailableCli[] }
  | { status: "error" };

function useAvailableClis(enabled: boolean) {
  const [state, setState] = useState<AvailableClisState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const loaded = state.status === "ready";
  useEffect(() => {
    if (!enabled || loaded) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchAvailableClis({ signal: controller.signal })
      .then((clis) => {
        if (!controller.signal.aborted) setState({ status: "ready", clis });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, [attempt, enabled, loaded]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
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
  activeTabIsPersisted = false,
) {
  return shouldShowAgentPanelPageHeader(
    tabs,
    activeTabId,
    activeTabMessageCount,
    false,
    activeTabIsPersisted,
  );
}

export function shouldShowAgentPanelPageHeader(
  tabs: MultiTabAssistantChatHeaderProps["tabs"],
  activeTabId: string,
  activeTabMessageCount: number,
  showWhenEmpty = false,
  activeTabIsPersisted = false,
) {
  if (!activeTabId) return false;
  if (activeTabMessageCount > 0) return true;
  if (activeTabIsPersisted) return true;

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  return Boolean(
    activeTab &&
    (showWhenEmpty ||
      activeTab.status === "running" ||
      activeTab.status === "completed"),
  );
}

export function resolveAgentPanelPageHeaderActions({
  showPageTitleMenu = true,
  canShareActiveTab,
}: {
  showPageTitleMenu?: boolean;
  canShareActiveTab: boolean;
}) {
  return { showPageTitleMenu, showShareAction: canShareActiveTab };
}

export type AgentPanelPageToolbarActions = Pick<
  MultiTabAssistantChatHeaderCallbackProps,
  "activeTabMessageCount" | "clearActiveTab" | "showHistory" | "toggleHistory"
>;

export function resolveAgentPanelPageToolbarSlot(
  slot:
    | React.ReactNode
    | ((actions: AgentPanelPageToolbarActions) => React.ReactNode),
  actions: AgentPanelPageToolbarActions,
) {
  return typeof slot === "function" ? slot(actions) : slot;
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

export function AgentPanelFullViewMenuItem({
  activeTabId,
  onFullViewRequest,
  label,
}: {
  activeTabId: string;
  onFullViewRequest: (threadId?: string) => void;
  label: string;
}) {
  return (
    <DropdownMenuItem
      onSelect={() => onFullViewRequest(activeTabId || undefined)}
      aria-label={label}
    >
      {label}
    </DropdownMenuItem>
  );
}

export function resolveAgentPanelFullViewAction(
  agentPageHref: string | undefined,
  onFullViewRequest: ((threadId?: string) => void) | undefined,
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

// Hosts without a Settings route pass no agentPageHref, so it doubles as the
// signal that an Integrations page exists to link to. Both paths are
// router-local; RouterSidebarLink adds the app base path.
export function resolveAgentPanelIntegrationsHref(
  agentPageHref: string | undefined,
  currentPath?: string,
) {
  if (!agentPageHref) return null;
  const href = buildSettingsRoute("integrations");
  if (currentPath === href || currentPath?.startsWith(`${href}/`)) return null;
  return href;
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

export interface AgentPanelProps extends Omit<
  AssistantChatProps,
  "onSwitchToCli"
> {
  onReadyChange?: (ready: boolean) => void;
  defaultMode?: "chat" | "cli";
  onReferenceTargetChange?: MultiTabAssistantChatProps["onReferenceTargetChange"];
  onNavigationChange?: MultiTabAssistantChatProps["onNavigationChange"];
  onTabsClosed?: MultiTabAssistantChatProps["onTabsClosed"];
  onTabsClosing?: MultiTabAssistantChatProps["onTabsClosing"];
  className?: string;
  style?: React.CSSProperties;
  onCollapse?: () => void;
  showCollapseButton?: boolean;
  isFullscreen?: boolean;
  /** @deprecated Fullscreen sidebar controls are no longer rendered. */
  onToggleFullscreen?: () => void;
  onFullViewRequest?: (threadId?: string) => void;
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
  scope?: import("@agent-native/core/client/agent-chat").ChatThreadScope | null;
  isolateHistoryByScope?: boolean;
  /** @deprecated Scope context now appears inside the composer. */
  showScopeBadge?: MultiTabAssistantChatProps["showScopeBadge"];
  browserTabId?: string;
  threadUrlSync?: MultiTabAssistantChatProps["threadUrlSync"];
  chatNotice?: React.ReactNode;
  showTabBar?: boolean;
  showPageNewChatButton?: boolean;
  showPageHeader?: boolean;
  showPageHeaderWhenEmpty?: boolean;
  /** Hide the default page title menu while keeping the shared page actions. */
  showPageTitleMenu?: boolean;
  pageHeaderLeadingSlot?: React.ReactNode;
  /** Override the shared page header share button's icon and label contents. */
  pageHeaderShareTriggerContent?: React.ReactNode;
  /** Render host page actions alongside Share, with the active chat controls. */
  pageToolbarSlot?:
    | React.ReactNode
    | ((actions: AgentPanelPageToolbarActions) => React.ReactNode);
  onPageHeaderVisibilityChange?: (visible: boolean) => void;
  chatOnly?: boolean;
  agentPageHref?: string;
  codeAccess?: AgentPanelCodeAccess;
  builderConnectTransport?: BuilderConnectTransport;
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
  secondaryCtaLabel,
  secondaryCtaHref,
  compact = false,
  builderConnectTransport,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref?: string;
  secondaryCtaLabel: string;
  secondaryCtaHref?: string;
  compact?: boolean;
  builderConnectTransport?: BuilderConnectTransport;
}) {
  const builderFlow = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: "code_access_unavailable_panel",
    trackingFlow: "background_agent",
    transport: builderConnectTransport,
  });
  const secondaryHref = secondaryCtaHref
    ? withBuilderUtmTrackingParams(secondaryCtaHref, {
        campaign: "product",
        content: "code_access_unavailable_panel",
      })
    : null;

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
        {secondaryHref ? (
          <a
            href={secondaryHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            {secondaryCtaLabel}
            <IconExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <BuilderConnectPopover flow={builderFlow}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              {secondaryCtaLabel}
            </button>
          </BuilderConnectPopover>
        )}
      </div>
    </div>
  );
}

function AgentPanelInner({
  onReadyChange,
  onReferenceTargetChange,
  onNavigationChange,
  onTabsClosed,
  onTabsClosing,
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
  showPageHeaderWhenEmpty = false,
  showPageTitleMenu = true,
  pageHeaderLeadingSlot,
  pageHeaderShareTriggerContent,
  pageToolbarSlot,
  onPageHeaderVisibilityChange,
  chatOnly = false,
  agentPageHref,
  codeAccess,
  builderConnectTransport,
  ...assistantChatProps
}: AgentPanelProps) {
  const t = useT();
  const location = useLocation();
  const mounted = useClientOnly();
  const [chatCommandsReady, setChatCommandsReady] = useState(false);
  const [modeCommandsReady, setModeCommandsReady] = useState(false);
  const [settingsCommandsReady, setSettingsCommandsReady] = useState(false);
  useEffect(() => {
    onReadyChange?.(
      chatCommandsReady && modeCommandsReady && settingsCommandsReady,
    );
    return () => onReadyChange?.(false);
  }, [
    onReadyChange,
    chatCommandsReady,
    modeCommandsReady,
    settingsCommandsReady,
  ]);
  const [activeChatModelEngine, setActiveChatModelEngine] =
    useState<ModelEngineConfig | null>(null);
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
    setModeCommandsReady(true);
    return () => {
      setModeCommandsReady(false);
      window.removeEventListener(AGENT_PANEL_SET_MODE_EVENT, handler);
    };
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

  const { state: availableClisState, retry: retryAvailableClis } =
    useAvailableClis(mode === "cli");
  const availableClis =
    availableClisState.status === "ready" ? availableClisState.clis : NO_CLIS;
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
    codeAccess?.unavailableSecondaryCtaLabel ??
    t("agentPanel.connectBuilderIo");
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
                "flex h-6 items-center gap-1 rounded-md px-2 text-xs",
                activeMode === "chat"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <IconMessageCircle size={16} />
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
                  "flex h-6 items-center gap-1 rounded-md px-2 text-xs",
                  activeMode === "cli"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <IconTerminal2 size={16} />
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
                "flex h-6 items-center gap-1 rounded-md px-2 text-xs",
                activeMode === "resources"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <IconLayoutGrid size={16} />
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
  const panelRootRef = useRef<HTMLDivElement>(null);
  const panelWidth = useElementInlineSize(panelRootRef);
  // Only the docked sidebar trades its tabs for a switcher; full-page chat keeps them.
  const sidebarTabLayout = onCollapse
    ? resolveAgentPanelTabLayout(panelWidth)
    : "tabs";
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [shareFromMenuOpen, setShareFromMenuOpen] = useState(false);
  const pendingHeaderOverlayRef = useRef<(() => void) | null>(null);
  const closeHeaderMenuForOverlay = useCallback(() => {
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
  const integrationsHref = resolveAgentPanelIntegrationsHref(
    agentPageHref,
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

  // The switcher menu leads with its own "New" row, so the header and the
  // overflow menu drop theirs instead of offering it twice.
  const isThreadSwitcherShown = useCallback(
    (tabs: MultiTabAssistantChatHeaderProps["tabs"]) =>
      Boolean(onCollapse) &&
      sidebarTabLayout === "switcher" &&
      (Boolean(renderCliTab && showTabBar) ||
        (mode === "chat" && shouldShowAgentPanelSidebarChatTabs(tabs))),
    [mode, onCollapse, renderCliTab, showTabBar, sidebarTabLayout],
  );

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
                triggerClassName="h-6 px-2 text-xs"
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
        {mode === "chat" && !isThreadSwitcherShown(tabs) && (
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
              <IconPlus size={16} />
            </button>
          </IconTooltip>
        )}
        {mode === "cli" &&
          (canUseCodeTools || renderCliTab) &&
          !isThreadSwitcherShown(tabs) && (
            <IconTooltip content={t("agentPanel.newTerminal")}>
              <button
                onClick={openNewCliTab}
                aria-label={t("agentPanel.newTerminal")}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
              >
                <IconPlus size={16} />
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
              <IconDotsVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-48 overflow-y-auto"
            onCloseAutoFocus={(event) => {
              consumeAgentPanelOverlayFocusRestore(
                pendingHeaderOverlayRef,
                event,
              );
            }}
          >
            {onCollapse && (
              <>
                <DropdownMenuItem onSelect={onCollapse}>
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
                {wideDrawerLabel}
                <DropdownMenuShortcut>{widenChatHint}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : null}
            {fullViewAction?.kind === "callback" && onFullViewRequest ? (
              <AgentPanelFullViewMenuItem
                activeTabId={activeTabId}
                onFullViewRequest={onFullViewRequest}
                label={t("agentPanel.openFullView")}
              />
            ) : fullViewAction?.kind === "link" ? (
              <DropdownMenuItem asChild>
                <RouterSidebarLink
                  to={fullViewAction.href}
                  aria-label={t("agentPanel.openFullView")}
                >
                  {t("agentPanel.openFullView")}
                </RouterSidebarLink>
              </DropdownMenuItem>
            ) : null}
            {integrationsHref ? (
              <DropdownMenuItem asChild>
                <RouterSidebarLink to={integrationsHref}>
                  {t("agentPanel.integrations")}
                </RouterSidebarLink>
              </DropdownMenuItem>
            ) : null}
            {(onCollapse && mode === "chat" && wideDrawerAction) ||
            fullViewAction ||
            integrationsHref ? (
              <DropdownMenuSeparator />
            ) : null}
            {onCollapse &&
              (newTabMode === "cli" || (mode === "cli" && renderCliTab)) && (
                <>
                  <DropdownMenuItem onSelect={() => openNewUiTab(addTab)}>
                    {newUiTabLabel ?? t("agentPanel.newChat")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openNewCliTab}>
                    {newCliTabLabel ?? t("agentPanel.newTerminal")}
                  </DropdownMenuItem>
                  {mode === "chat" ? <DropdownMenuSeparator /> : null}
                </>
              )}
            {onCollapse &&
              mode === "chat" &&
              newTabMode !== "cli" &&
              !isThreadSwitcherShown(tabs) && (
                <DropdownMenuItem onSelect={() => openNewUiTab(addTab)}>
                  {newUiTabLabel ?? t("agentPanel.newChat")}
                </DropdownMenuItem>
              )}
            {onCollapse &&
            mode === "chat" &&
            renderCliTab &&
            newTabMode !== "cli" ? (
              <DropdownMenuItem onSelect={openNewCliTab}>
                {newCliTabLabel ?? t("agentPanel.newTerminal")}
              </DropdownMenuItem>
            ) : null}
            {mode === "chat" &&
            newTabMode !== "cli" &&
            onNewCliTab &&
            newCliTabLabel ? (
              <DropdownMenuItem onSelect={onNewCliTab}>
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
                        pendingHeaderOverlayRef,
                      )
                    }
                  >
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
                    pendingHeaderOverlayRef,
                  )
                }
              >
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
            {mode === "cli" && availableClisState.status === "error" ? (
              <>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    retryAvailableClis();
                  }}
                  className="text-muted-foreground"
                >
                  {t("agentChat.agentPanel.clisLoadFailed")}
                  <span className="ms-auto text-foreground">
                    {t("agentChat.common.retry")}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
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
                    pendingHeaderOverlayRef,
                  )
                }
              >
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
                      {t("agentPanel.clearChat")}
                    </DropdownMenuItem>
                  )
                ) : (
                  <>
                    <DropdownMenuItem
                      onSelect={() => closeCliTab(activeCliTab)}
                    >
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
              <IconX size={16} />
            </button>
          </IconTooltip>
        )}
      </div>
    ),
    [
      activeCliTab,
      addCliTab,
      availableClis,
      availableClisState.status,
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
      integrationsHref,
      onCollapse,
      onFullViewRequest,
      onExitWideDrawer,
      onSnapTo75Percent,
      openRunThread,
      openNewCliTab,
      openNewUiTab,
      renderCliTab,
      retryAvailableClis,
      selectCli,
      selectedCli,
      shareFromMenuOpen,
      showCollapseButton,
      isThreadSwitcherShown,
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
      activeTabIsPersisted,
      addTab,
      clearActiveTab,
      showHistory,
      tabs,
      toggleHistory,
    }: MultiTabAssistantChatHeaderCallbackProps) => {
      const activeTab = activeTabId
        ? tabs.find((tab) => tab.id === activeTabId)
        : undefined;
      const pageHeaderVisible = shouldShowAgentPanelPageHeader(
        tabs,
        activeTabId,
        activeTabMessageCount,
        showPageHeaderWhenEmpty,
        activeTabIsPersisted,
      );
      const canShareActiveTab = Boolean(
        activeTab &&
        (activeTabIsPersisted ||
          activeTabMessageCount > 0 ||
          activeTab.status !== "idle"),
      );
      const pageHeaderActions = resolveAgentPanelPageHeaderActions({
        showPageTitleMenu,
        canShareActiveTab,
      });
      const showNewChatAction =
        showPageNewChatButton &&
        shouldShowAgentPanelPageNewChatButton(
          tabs,
          activeTabId,
          activeTabMessageCount,
          activeTabIsPersisted,
        );
      const toolbarSlot = resolveAgentPanelPageToolbarSlot(pageToolbarSlot, {
        activeTabMessageCount,
        clearActiveTab,
        showHistory,
        toggleHistory,
      });

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
                  {pageHeaderActions.showPageTitleMenu ? (
                    <DropdownMenu
                      open={headerMenuOpen}
                      onOpenChange={setHeaderMenuOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          data-agent-page-title-menu=""
                          aria-label={t("agentPanel.panelOptions")}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
                        >
                          <IconDotsVertical size={16} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        sideOffset={5}
                        className="w-44"
                        onCloseAutoFocus={(event) => {
                          consumeAgentPanelOverlayFocusRestore(
                            pendingHeaderOverlayRef,
                            event,
                          );
                        }}
                      >
                        {toggleHistory ? (
                          <DropdownMenuItem
                            onSelect={(event) =>
                              deferAgentPanelOverlayOpen(
                                event,
                                closeHeaderMenuForOverlay,
                                toggleHistory,
                                pendingHeaderOverlayRef,
                              )
                            }
                          >
                            {showHistory
                              ? t("agentPanel.hideChats")
                              : t("agentPanel.allChats")}
                          </DropdownMenuItem>
                        ) : null}
                        {activeTabMessageCount > 0 ? (
                          <DropdownMenuItem onSelect={clearActiveTab}>
                            {t("agentPanel.clearChat")}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  {activeTab?.status === "running" ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/55 animate-pulse motion-reduce:animate-none" />
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {pageHeaderActions.showShareAction && activeTab ? (
                    <ShareButton
                      resourceType="chat_thread"
                      resourceId={activeTab.id}
                      allowedRoles={["viewer", "editor", "admin"]}
                      resourceTitle={activeTab.label || t("agentPanel.chat")}
                      shareUrl={getChatThreadShareUrl(activeTab.id)}
                      triggerContent={
                        pageHeaderShareTriggerContent ?? (
                          <IconShare3 size={16} aria-hidden="true" />
                        )
                      }
                      triggerClassName={cn(
                        "h-6 border-0 bg-transparent text-xs shadow-none hover:bg-accent/60 [&_svg]:size-4",
                        pageHeaderShareTriggerContent === undefined ||
                          pageHeaderShareTriggerContent === null
                          ? "size-6 p-0"
                          : "w-auto px-2",
                      )}
                    />
                  ) : null}
                  {toolbarSlot}
                  {showNewChatAction ? (
                    <IconTooltip content={t("agentPanel.newChat")}>
                      <button
                        type="button"
                        data-agent-page-new-chat=""
                        aria-label={t("agentPanel.newChat")}
                        onClick={() => {
                          addTab();
                        }}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <IconPlus size={16} aria-hidden="true" />
                      </button>
                    </IconTooltip>
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
      closeHeaderMenuForOverlay,
      headerMenuOpen,
      onPageHeaderVisibilityChange,
      pageHeaderLeadingSlot,
      pageHeaderShareTriggerContent,
      pageToolbarSlot,
      pendingHeaderOverlayRef,
      setHeaderMenuOpen,
      showPageTitleMenu,
      showPageNewChatButton,
      t,
    ],
  );

  const activeTabResizeObserverRef = useRef<ResizeObserver | null>(null);
  const scrollActiveTabIntoView = useCallback((el: HTMLElement) => {
    const container = getActiveTabScrollContainer(el);
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
    (el: HTMLElement | null) => {
      activeTabResizeObserverRef.current?.disconnect();
      activeTabResizeObserverRef.current = null;
      if (!el) return;
      const container = getActiveTabScrollContainer(el);
      if (!container) return;

      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => scrollActiveTabIntoView(el));
      observer?.observe(container);
      observer?.observe(el);
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
    }: MultiTabAssistantChatHeaderCallbackProps) => {
      const { activeTab, childTabs, focusParentId, hasSubTabs, mainTabs } =
        getAgentPanelChatTabGroups(tabs, activeTabId);
      const showSidebarChatTabs =
        Boolean(onCollapse) &&
        mode === "chat" &&
        shouldShowAgentPanelSidebarChatTabs(tabs);
      const showUnifiedSurfaceTabs = Boolean(
        onCollapse && renderCliTab && showTabBar,
      );
      const isActiveMainTab = (tab: (typeof mainTabs)[number]) =>
        tab.id === activeTabId ||
        (tab.id === focusParentId && activeTab?.parentThreadId === tab.id);
      const chatThreadItems = (): AgentPanelThreadItem[] =>
        mainTabs.map((tab) => ({
          id: tab.id,
          label: tab.label || t("agentPanel.newChat"),
          active: isActiveMainTab(tab),
          running: tab.status === "running",
        }));
      const newChatLabel = newUiTabLabel ?? t("agentPanel.newChat");
      const renderUnifiedSurfaceTabs = () =>
        mode === "cli" ? (
          <AgentPanelThreadNav
            layout={sidebarTabLayout}
            tabListLabel={t("agentChat.agentPanel.terminalTabs")}
            items={cliTabs.map((id, index) => ({
              id,
              label: t("agentChat.agentPanel.terminalTab", {
                index: index + 1,
              }),
              active: id === activeCliTab,
            }))}
            activeTabRef={activeTabRefCb}
            onSelect={(id) => {
              setActiveCliTab(id);
              switchMode("cli");
            }}
            onClose={closeCliTab}
            onNew={openNewCliTab}
            newLabel={newCliTabLabel ?? t("agentPanel.newTerminal")}
            closeLabel={t("agentPanel.closeTab")}
          />
        ) : (
          <AgentPanelThreadNav
            layout={sidebarTabLayout}
            tabListLabel={t("agentChat.agentPanel.chatTabs")}
            items={chatThreadItems()}
            activeTabRef={activeTabRefCb}
            onSelect={(id) => {
              setActiveTabId(id);
              switchMode("chat");
            }}
            onClose={closeTab}
            onNew={() => openNewUiTab(addTab)}
            newLabel={newChatLabel}
            closeLabel={t("agentPanel.closeTab")}
          />
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
                <AgentPanelThreadNav
                  layout={sidebarTabLayout}
                  tabListLabel={t("agentChat.agentPanel.chatTabs")}
                  items={chatThreadItems()}
                  activeTabRef={activeTabRefCb}
                  onSelect={setActiveTabId}
                  onClose={closeTab}
                  onNew={addTab}
                  newLabel={newChatLabel}
                  closeLabel={t("agentPanel.closeTab")}
                />
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
                      <AgentPanelTabList
                        label={
                          mode === "chat"
                            ? t("agentChat.agentPanel.chatTabs")
                            : t("agentChat.agentPanel.terminalTabs")
                        }
                      >
                        {mode === "chat"
                          ? mainTabs.map((tab) => {
                              const isActive =
                                tab.id === activeTabId ||
                                (tab.id === focusParentId &&
                                  activeTab?.parentThreadId === tab.id);
                              return (
                                <AgentPanelTab
                                  key={tab.id}
                                  label={tab.label}
                                  active={isActive}
                                  running={tab.status === "running"}
                                  tabRef={isActive ? activeTabRefCb : undefined}
                                  onSelect={() => setActiveTabId(tab.id)}
                                  onClose={() => closeTab(tab.id)}
                                  closeLabel={t("agentPanel.closeTab")}
                                />
                              );
                            })
                          : cliTabs.map((id, i) => (
                              <AgentPanelTab
                                key={id}
                                label={t("agentChat.agentPanel.terminalTab", {
                                  index: i + 1,
                                })}
                                active={id === activeCliTab}
                                tabRef={
                                  id === activeCliTab
                                    ? activeTabRefCb
                                    : undefined
                                }
                                onSelect={() => setActiveCliTab(id)}
                                onClose={() => closeCliTab(id)}
                                closeLabel={t("agentPanel.closeTab")}
                              />
                            ))}
                      </AgentPanelTabList>
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
                      <AgentPanelTabList
                        label={t("agentChat.agentPanel.subAgentTabs")}
                      >
                        <AgentPanelTab
                          size="compact"
                          label={t("agentChat.agentPanel.mainThread")}
                          active={activeTabId === focusParentId}
                          tabRef={
                            activeTabId === focusParentId
                              ? activeTabRefCb
                              : undefined
                          }
                          onSelect={() => setActiveTabId(focusParentId)}
                          closeLabel={t("agentPanel.closeTab")}
                        />
                        {childTabs.map((tab) => (
                          <AgentPanelTab
                            key={tab.id}
                            size="compact"
                            label={tab.subAgentName || tab.label}
                            active={tab.id === activeTabId}
                            running={tab.status === "running"}
                            tabRef={
                              tab.id === activeTabId
                                ? activeTabRefCb
                                : undefined
                            }
                            onSelect={() => setActiveTabId(tab.id)}
                            onClose={() => closeTab(tab.id)}
                            closeLabel={t("agentPanel.closeTab")}
                          />
                        ))}
                      </AgentPanelTabList>
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
      closeCliTab,
      newCliTabLabel,
      newUiTabLabel,
      openNewCliTab,
      openNewUiTab,
      renderCliTab,
      sidebarTabLayout,
      switchMode,
      t,
    ],
  );

  return (
    <ThinkingDisplayProvider value={assistantChatProps.thinkingDisplay}>
      <AgentPanelSettingsNavigation
        onOpenSettings={onOpenSettings}
        onReadyChange={setSettingsCommandsReady}
      />
      <div
        ref={panelRootRef}
        data-agent-panel-tab-layout={onCollapse ? sidebarTabLayout : undefined}
        className={cn(
          "agent-panel-root agent-kit-density flex flex-1 flex-col min-h-0 min-w-0 h-full antialiased",
          className,
        )}
        style={{
          ...style,
          ...(isFirstRunOnboardingSurface ? { contain: "none" } : {}),
        }}
        data-agent-fullscreen={isFullscreen ? "true" : undefined}
      >
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

        {/* Chat view stays mounted to preserve state. MultiTabAssistantChat
          owns its transcript loading state; mounting it here keeps the
          interactive composer available while that data loads. */}
        <div
          className={cn(
            "flex flex-col min-h-0",
            mode === "chat" ? "flex-1" : "shrink-0",
          )}
        >
          {mounted && (
            <MultiTabAssistantChat
              {...assistantChatProps}
              onCommandListenersReadyChange={setChatCommandsReady}
              onReferenceTargetChange={onReferenceTargetChange}
              onNavigationChange={onNavigationChange}
              onTabsClosed={onTabsClosed}
              onTabsClosing={onTabsClosing}
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
              onActiveModelEngineChange={setActiveChatModelEngine}
              suggestions={suggestions}
              dynamicSuggestions={dynamicSuggestions}
              suggestionPlacement={
                assistantChatProps.suggestionPlacement ?? "context-chips"
              }
              onSwitchToCli={() => switchMode("cli")}
              storageKey={storageKey}
              restoreActiveThread={restoreActiveThread}
              scope={scope}
              isolateHistoryByScope={isolateHistoryByScope}
              showScopeBadge={showScopeBadge}
              browserTabId={browserTabId}
              threadUrlSync={threadUrlSync}
            />
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
                  <div role="status" className="flex h-full flex-col gap-2 p-3">
                    <span className="sr-only">
                      {t("agentPanel.loadingTerminal")}
                    </span>
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-4 w-2/5" />
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
              builderConnectTransport={builderConnectTransport}
            />
          </div>
        )}

        {/* Resources view */}
        {mode === "resources" && (
          <div className="flex flex-1 flex-col min-h-0">
            <Suspense
              fallback={
                <div className="flex h-full flex-col min-h-0" aria-hidden>
                  <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-5 w-16 rounded" />
                      <Skeleton className="h-5 w-14 rounded" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 p-2">
                    {[64, 48, 56, 40].map((width) => (
                      <div
                        key={width}
                        className="flex h-7 items-center gap-2 px-1"
                      >
                        <Skeleton className="size-4 shrink-0 rounded" />
                        <Skeleton
                          className="h-3.5"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              }
            >
              <ResourcesPanel modelEngine={activeChatModelEngine} />
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

export function getActiveTabScrollContainer(
  el: HTMLElement,
): HTMLElement | null {
  return el.closest<HTMLElement>(".agent-tabs-scroll");
}

class AgentPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { error: Error | null; staleIndexRecoveryCount: number }
> {
  override state: { error: Error | null; staleIndexRecoveryCount: number } = {
    error: null,
    staleIndexRecoveryCount: 0,
  };

  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryCooldownTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
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

  override componentDidUpdate(
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

  override componentWillUnmount() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
    }
    if (this.recoveryCooldownTimer) {
      clearTimeout(this.recoveryCooldownTimer);
    }
  }

  override render() {
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
  useRegisterAgentChatSurface(true);
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
      <SettingsReturnPathRecorder />
    </>
  );
}
