/**
 * Agent sidebar shell.
 *
 * The layout and its interaction listeners stay eager; the chat panel and
 * realtime voice controller load only when the panel is needed.
 */

import { Tooltip as DesignSystemTooltip } from "@agent-native/toolkit/design-system";
import { IconLayoutSidebarRight } from "@tabler/icons-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { flushSync } from "react-dom";

import {
  hostedHarnessAgentOption,
  isHostedHarnessConfigured,
  isHostedHarnessRuntime,
  normalizeHostedHarnessRuntimes,
  type HostedHarnessRuntime,
} from "../agent/harness/hosted.js";
import type { AgentChatSurfaceKind } from "./agent-chat-adapter.js";
import { AgentSidebarOnboardingContext } from "./agent-sidebar-context.js";
import {
  AGENT_CHAT_RUNNING_EVENT,
  AGENT_PANEL_OPEN_SETTINGS_EVENT,
  AGENT_PANEL_PREPARE_EVENT,
  AGENT_PANEL_SET_MODE_EVENT,
  shouldHandleAgentPanelChatShortcut,
  shouldHandleAgentSidebarToggle,
} from "./agent-sidebar-events.js";
import {
  AGENT_SIDEBAR_MIN_WIDTH,
  consumeAgentSidebarUrlOpenOverride,
  clampAgentSidebarWidth,
  dispatchAgentSidebarStateChange,
  getAgentSidebarMaxWidth,
  getInitialAgentSidebarOpen,
  getAgentSidebarWideWidth,
  setAgentSidebarOpenPreference,
  subscribeAgentSidebarUrlChanges,
  SIDEBAR_STATE_CHANGE_EVENT,
  type AgentSidebarStateChangeDetail,
} from "./agent-sidebar-state.js";
import { ScreenRefreshBoundary, URLSync } from "./agent-sidebar-url-sync.js";
import { agentNativePath } from "./api-path.js";
import {
  APP_CHAT_SIDEBAR_STATE_EVENT,
  APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE,
  buildAppChatSidebarStateMessage,
  isPerAppChatStorageKey,
  requestPerAppChatCommand,
  usePerAppChatState,
} from "./app-chat-sidebar.js";
import { injectedAgentNativeConfig } from "./app-config.js";
import type { AssistantChatProps } from "./AssistantChat.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import { shouldParentFrameOwnAgentPanel } from "./builder-frame.js";
import {
  AGENT_CHAT_VIEW_TRANSITION_CLASS,
  getAgentChatViewTransitionStyle,
  startAgentChatViewTransition,
} from "./chat-view-transition.js";
import {
  getFramePostMessageTargetOrigin,
  isTrustedFrameMessage,
} from "./frame.js";
import { useT } from "./i18n.js";
import { LazyChunkErrorBoundary } from "./lazy-chunk-error-boundary.js";
import type { MultiTabAssistantChatProps } from "./MultiTabAssistantChat.js";
import { isFirstRunOnboardingEnabled } from "./onboarding/first-run-enabled.js";
import { useFirstRunOnboardingGateOwnsSurface } from "./onboarding/first-run-startup-gate.js";
import { useOnboardingPreviewMode } from "./onboarding/use-preview-mode.js";
import { useActionQuery } from "./use-action.js";
import { cn } from "./utils.js";
// These modules install window-level bridges used before the panel body is
// loaded, including chat-running and MCP host message listeners.
import "./agent-chat.js";
import "./mcp-app-host.js";

const loadAgentSidebarPanel = () =>
  import("./AgentSidebarPanel.js").then((m) => ({
    default: m.AgentSidebarPanel,
  }));
const AgentSidebarPanelLazy = lazy(loadAgentSidebarPanel);

/** Start loading the panel body and its voice controller before opening. */
export function preloadAgentChatSurface(): Promise<void> {
  return loadAgentSidebarPanel().then(() => undefined);
}

const SHOW_FIRST_RUN_ONBOARDING = isFirstRunOnboardingEnabled();
const FirstRunOnboarding = lazy(() =>
  import("./onboarding/FirstRunOnboarding.js").then((m) => ({
    default: m.FirstRunOnboarding,
  })),
);

const AGENT_PANEL_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const AGENT_PANEL_ROOT_STYLE = {
  fontFamily: AGENT_PANEL_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
} satisfies React.CSSProperties;

type AgentPanelStyle = React.CSSProperties & {
  "--agent-sidebar-background"?: string;
  "--agent-sidebar-closed-transform"?: string;
  "--agent-sidebar-inner-closed-transform"?: string;
  "--agent-sidebar-width"?: string;
  viewTransitionName?: string;
};

const SIDEBAR_STORAGE_KEY = "agent-native-sidebar-width";
const SIDEBAR_DRAWER_KEY = "agent-native-sidebar-wide-drawer";
const SIDEBAR_DRAWER_PLACEHOLDER_KEY =
  "agent-native-sidebar-drawer-placeholder-width";
const SIDEBAR_ANIMATION_MS = 260;
const SIDEBAR_OVERLAY_Z_INDEX = 70;
const SIDEBAR_DRAWER_Z_INDEX = 80;
const SIDEBAR_DRAWER_VIEW_TRANSITION_NAME = "agent-native-sidebar-drawer";
function ResizeHandle({
  position,
  onDrag,
  onResizeStart,
  onResizeEnd,
}: {
  position: "left" | "right";
  onDrag: (delta: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onDragRef = useRef(onDrag);
  const onResizeStartRef = useRef(onResizeStart);
  const onResizeEndRef = useRef(onResizeEnd);
  onDragRef.current = onDrag;
  onResizeStartRef.current = onResizeStart;
  onResizeEndRef.current = onResizeEnd;
  const GRAB_ZONE = 5; // px on each side of the border

  // All drag logic runs via document-level listeners so the 1px-wide
  // element doesn't need to capture pointer events itself.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cursorActive = false;

    function onMouseDown(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const dist = Math.abs(e.clientX - (rect.left + rect.width / 2));
      if (dist > GRAB_ZONE) return;
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;
      onResizeStartRef.current();
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    function onMouseMove(e: MouseEvent) {
      if (dragging.current) {
        const delta = e.clientX - lastX.current;
        lastX.current = e.clientX;
        onDragRef.current(position === "left" ? delta : -delta);
        return;
      }
      // Hover cursor
      const rect = el!.getBoundingClientRect();
      const dist = Math.abs(e.clientX - (rect.left + rect.width / 2));
      const near = dist <= GRAB_ZONE;
      if (near && !cursorActive) {
        cursorActive = true;
        document.body.style.cursor = "col-resize";
      } else if (!near && cursorActive) {
        cursorActive = false;
        document.body.style.cursor = "";
      }
    }

    function endDrag() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEndRef.current();
    }

    // mouseup covers the normal release-inside-the-page case; window blur
    // covers releasing the button outside the browser window/iframe (e.g.
    // dragging the sidebar wide and letting go over the OS chrome), which
    // never delivers a mouseup to this document. Without both, a drag that
    // ends abnormally — or this effect re-running/unmounting mid-drag —
    // could leave `document.body.style.userSelect` stuck at "none",
    // silently breaking text selection/copy everywhere in the app.
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", endDrag);
      window.removeEventListener("blur", endDrag);
      if (cursorActive) document.body.style.cursor = "";
      // Always clear regardless of `dragging`/`cursorActive` state — this
      // effect can unmount or re-run (position change, sidebar layout
      // change) while a drag is in flight, and a stuck "none" here disables
      // selection app-wide until reload.
      document.body.style.userSelect = "";
      dragging.current = false;
      onResizeEndRef.current();
    };
  }, [position]);

  return (
    <div
      ref={ref}
      className={cn(
        "agent-sidebar-resize-handle relative z-20 w-px shrink-0 touch-none select-none bg-transparent transition-colors hover:bg-border active:bg-border",
      )}
      style={{ cursor: "col-resize" }}
    />
  );
}

function postPerAppChatSidebarStateToEmbeddedFrames(open: boolean): void {
  const message = buildAppChatSidebarStateMessage(open);
  for (const frame of document.querySelectorAll("iframe")) {
    frame.contentWindow?.postMessage(message, "*");
  }
}

function parentFrameTargetOrigin(): string {
  return getFramePostMessageTargetOrigin() ?? window.location.origin;
}

function AgentSidebarPanelSkeleton() {
  const t = useT();
  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background animate-pulse"
      data-agent-sidebar-panel-skeleton="true"
      role="status"
      aria-label={t("agentChat.common.loading")}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="h-5 w-5 rounded bg-muted" />
        <div className="h-4 w-24 rounded bg-muted" />
      </div>
      <div className="flex-1 space-y-4 p-4">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-4 w-5/6 rounded bg-muted" />
        <div className="h-24 rounded-lg bg-muted" />
      </div>
      <div className="border-t border-border p-3">
        <div className="h-10 rounded-lg bg-muted" />
      </div>
    </div>
  );
}

// ─── AgentSidebar — wraps content with a toggleable agent panel ─────────────

export interface AgentSidebarProps {
  children: React.ReactNode;
  /** Keep the app surface mounted while temporarily disabling the chat panel. */
  enabled?: boolean;
  /** Placeholder text for the empty chat state */
  emptyStateText?: string;
  /** Static or agent-authored next actions shown at the base of the chat. */
  suggestions?: AssistantChatProps["suggestions"];
  /** Context-aware suggestions merged with `suggestions`. Enabled by default. */
  dynamicSuggestions?: AssistantChatProps["dynamicSuggestions"];
  /** Optional controls rendered in the chat composer toolbar. */
  composerToolbarSlot?: AssistantChatProps["composerToolbarSlot"];
  /** Optional contextual content rendered just above the chat composer. */
  composerSlot?: AssistantChatProps["composerSlot"];
  /** Observe the active chat composer's current plain text. */
  onComposerTextChange?: AssistantChatProps["onComposerTextChange"];
  /** Optional secondary model menu shown inside the chat composer model picker. */
  imageModelMenu?: AssistantChatProps["imageModelMenu"];
  /** Local or hosted agent runtimes shown above the model list. */
  availableAgents?: AssistantChatProps["availableAgents"];
  /** Host-provided model catalog used by native chat surfaces. */
  availableModels?: AssistantChatProps["availableModels"];
  /** Whether the host-provided model catalog is still loading. */
  modelListLoading?: AssistantChatProps["modelListLoading"];
  /** Selected agent runtime identifier. */
  selectedAgent?: AssistantChatProps["selectedAgent"];
  /** Callback when the user picks an agent runtime. */
  onAgentChange?: AssistantChatProps["onAgentChange"];
  /** Route local runtime setup through the host's native bridge. */
  onConnectLocalRuntime?: AssistantChatProps["onConnectLocalRuntime"];
  /** Route hosted provider setup through the host's native bridge. */
  onConnectProvider?: AssistantChatProps["onConnectProvider"];
  /** Bring-your-own runtime used by embedded hosts such as Electron. */
  runtime?: AssistantChatProps["runtime"];
  /** Explicit key for recreating an injected runtime adapter. */
  adapterReloadKey?: AssistantChatProps["adapterReloadKey"];
  /** Optional content rendered at the bottom of the chat thread. */
  threadFooterSlot?: AssistantChatProps["threadFooterSlot"];
  emptyStateFooter?: AssistantChatProps["emptyStateFooter"];
  onMessageCountChange?: AssistantChatProps["onMessageCountChange"];
  /** Initial sidebar width in pixels. Mount-only; user resize and a saved
   *  localStorage value override this. Default: 380 */
  defaultSidebarWidth?: number;
  /** @deprecated Use `defaultSidebarWidth` — this prop is mount-only. */
  sidebarWidth?: number;
  /** Which side the sidebar appears on. Default: "right" */
  position?: "left" | "right";
  /** Whether the sidebar starts open. Default: false */
  defaultOpen?: boolean;
  /** Disable the Cmd+I / Ctrl+I shortcut that opens chat. */
  disableChatShortcut?: boolean;
  /** Whether to render the panel's header collapse button. Default: true. */
  showCollapseButton?: boolean;
  /** Animate the mobile overlay in a sheet-style slide transition. Default: true */
  animateMobile?: boolean;
  /** Animate desktop open/close by resizing the sidebar. Default: true */
  animateDesktop?: boolean;
  /**
   * Apply the shared chat view-transition marker/name to the sidebar panel so a
   * page-level AgentChatSurface can morph into it on navigation.
   */
  chatViewTransition?: boolean;
  /**
   * Mark the initial panel mount as the destination of a page-to-sidebar chat
   * handoff. This suppresses only the drawer's initial entry animation; normal
   * sidebar open/close transitions remain enabled.
   */
  chatViewTransitionHandoff?: boolean;
  /** Namespace for persisted chat state. Use the same key as AgentChatHome. */
  storageKey?: string;
  /** Initial mode for the sidebar. Default: "chat" */
  defaultMode?: "chat" | "cli";
  /** Restore the previously active chat thread on mount. Default: true. */
  restoreActiveThread?: boolean;
  /** Namespace for the persisted open/closed preference. Defaults to storageKey. */
  openStorageKey?: string;
  /** API base URL used by the chat surface. */
  apiUrl?: string;
  /** Runtime surface identity used for server-side chat capabilities. */
  agentChatSurface?: AgentChatSurfaceKind;
  /** Whether the desktop host is currently showing its unauthenticated identity gate. */
  desktopIdentityUnauthenticated?: AssistantChatProps["desktopIdentityUnauthenticated"];
  /** Whether the desktop host has just established its authenticated identity session. */
  desktopIdentityAuthenticated?: AssistantChatProps["desktopIdentityAuthenticated"];
  /** Show the chat thread tab row. Default: true. */
  showTabBar?: MultiTabAssistantChatProps["showTabBar"];
  /** Keep inline app-opening results inside the current app chat. */
  suppressInlineOpenApp?: AssistantChatProps["suppressInlineOpenApp"];
  /** Placeholder shown in the chat composer. */
  composerPlaceholder?: AssistantChatProps["composerPlaceholder"];
  /** Open the sidebar when a chat run is active or reconnects. */
  openOnChatRunning?: boolean;
  /** Called when the user selects the full-view action from the chat sidebar. */
  onFullscreenRequest?: () => void;
  /** Route settings requests to a host-owned settings surface. */
  onOpenSettings?: (section?: string) => void;
  /** Start a desktop-owned CLI tab from the chat sidebar menu. */
  onNewCliTab?: () => void;
  /** Return from a desktop-owned CLI tab to a UI chat tab. */
  onNewUiTab?: () => void;
  /** Render a host-owned CLI tab; the built-in terminal is used when omitted. */
  renderCliTab?: (input: { id: string; active: boolean }) => React.ReactNode;
  /** Select the mode used by the chat sidebar's new-tab affordances. */
  newTabMode?: "ui" | "cli";
  /** Host-owned label for the desktop CLI tab action. */
  newCliTabLabel?: string;
  /** Host-owned label for the desktop UI tab action. */
  newUiTabLabel?: string;
  /** Ambient resource context rendered as a composer chip. */
  scope?: import("./use-chat-threads.js").ChatThreadScope | null;
  /** Optional host-owned resource history used for chat-side reverts. */
  chatHistory?: AssistantChatProps["chatHistory"];
  /** Identity used to route host-scoped sidebar toggle events. */
  toggleScopeId?: string;
  /** Keep app-owned chat history isolated to the supplied scope. */
  isolateHistoryByScope?: boolean;
  /** @deprecated Scope context now appears inside the composer. */
  showScopeBadge?: MultiTabAssistantChatProps["showScopeBadge"];
  /** Stable browser tab id used for tab-scoped app-state context. */
  browserTabId?: string;
  /** Keep chat thread selection in URL state. */
  threadUrlSync?: MultiTabAssistantChatProps["threadUrlSync"];
  /** Optional link shown in Resources mode for the full Agent page. */
  agentPageHref?: string;
  /** Suppress first-run onboarding while a deep-linked resource is open. */
  suppressFirstRunOnboarding?: boolean;
  /** Pin how much model reasoning the chat shows. Omit to let the reader choose. */
  thinkingDisplay?: AssistantChatProps["thinkingDisplay"];
  /** Show the composer's model and effort picker. Defaults to true. */
  showModelSelector?: AssistantChatProps["showModelSelector"];
  /** Keep the sidebar on chat mode. Defaults to true for embedded app sidebars. */
  chatOnly?: boolean;
}

interface HostedHarnessStatus {
  enabled: boolean;
  runtimes: HostedHarnessRuntime[];
}

/**
 * Wraps app content with a toggleable agent sidebar.
 * Use AgentToggleButton in your header to open/close it.
 */
export function AgentSidebar({
  children,
  enabled = true,
  emptyStateText = "How can I help you?",
  defaultMode = "chat",
  suggestions,
  dynamicSuggestions,
  composerToolbarSlot,
  composerSlot,
  onComposerTextChange,
  imageModelMenu,
  availableAgents,
  availableModels,
  modelListLoading,
  selectedAgent,
  onAgentChange,
  onConnectLocalRuntime,
  onConnectProvider,
  runtime,
  adapterReloadKey,
  threadFooterSlot,
  defaultSidebarWidth,
  sidebarWidth,
  position,
  defaultOpen,
  disableChatShortcut = false,
  showCollapseButton = true,
  animateMobile = true,
  animateDesktop = true,
  chatViewTransition = false,
  chatViewTransitionHandoff = false,
  storageKey,
  openStorageKey,
  restoreActiveThread = true,
  apiUrl,
  agentChatSurface,
  desktopIdentityUnauthenticated,
  desktopIdentityAuthenticated,
  showTabBar = true,
  suppressInlineOpenApp,
  composerPlaceholder,
  openOnChatRunning = false,
  onFullscreenRequest,
  onOpenSettings,
  onNewCliTab,
  onNewUiTab,
  renderCliTab,
  newTabMode = "ui",
  newCliTabLabel,
  newUiTabLabel,
  scope,
  chatHistory,
  toggleScopeId,
  isolateHistoryByScope = false,
  showScopeBadge,
  browserTabId,
  threadUrlSync,
  agentPageHref,
  suppressFirstRunOnboarding = false,
  thinkingDisplay,
  showModelSelector,
  chatOnly = true,
}: AgentSidebarProps) {
  const resolvedBrowserTabId =
    browserTabId ??
    (typeof window === "undefined" ? undefined : getBrowserTabId());
  const staticHostedHarnessEnabled = isHostedHarnessConfigured(
    injectedAgentNativeConfig().harness,
  );
  const hostedHarnessQuery = useActionQuery<HostedHarnessStatus>(
    "get-hosted-harness-config" as never,
    undefined,
    { enabled: staticHostedHarnessEnabled },
  );
  const hostedHarnessStatus = hostedHarnessQuery.data;
  const hostedHarnessEnabled = hostedHarnessStatus?.enabled === true;
  const hostedHarnessRuntimes = useMemo(
    () =>
      hostedHarnessEnabled
        ? normalizeHostedHarnessRuntimes(hostedHarnessStatus?.runtimes)
        : [],
    [hostedHarnessEnabled, hostedHarnessStatus?.runtimes],
  );
  const hostedHarnessUi = hostedHarnessEnabled;
  const hostedHarnessStorageKey = `agent-native-hosted-harness${storageKey ? `:${storageKey}` : ""}`;
  const [hostedHarnessRuntime, setHostedHarnessRuntime] =
    useState<HostedHarnessRuntime>("claude-code");
  const hostedHarnessAgentOptions = useMemo(
    () => hostedHarnessRuntimes.map(hostedHarnessAgentOption),
    [hostedHarnessRuntimes],
  );
  const effectiveAvailableAgents = hostedHarnessEnabled
    ? [
        ...hostedHarnessAgentOptions,
        ...(availableAgents ?? []).filter(
          (agent) => !isHostedHarnessRuntime(agent.id),
        ),
      ]
    : availableAgents;
  const effectiveSelectedAgent = hostedHarnessEnabled
    ? hostedHarnessRuntime
    : selectedAgent;
  const effectiveOnAgentChange = hostedHarnessEnabled
    ? (agent: string) => {
        if (isHostedHarnessRuntime(agent)) {
          setHostedHarnessRuntime(agent);
        }
        onAgentChange?.(agent);
      }
    : onAgentChange;
  const effectivePosition = position ?? (hostedHarnessUi ? "left" : "right");
  const effectiveDefaultOpen = defaultOpen ?? hostedHarnessUi;
  const effectiveShowTabBar = hostedHarnessUi || showTabBar;
  const effectiveAnimateDesktop = hostedHarnessUi ? false : animateDesktop;
  const sidebarOpenStorageKey = openStorageKey ?? storageKey;
  const isPerAppChatSidebar = isPerAppChatStorageKey(sidebarOpenStorageKey);
  const perAppChatState = usePerAppChatState(!isPerAppChatSidebar);
  const isPerAppChatHosted =
    !isPerAppChatSidebar && perAppChatState.hosted === true;
  const onboardingPreviewMode = useOnboardingPreviewMode();
  const firstRunOnboardingGateOwnsSurface =
    useFirstRunOnboardingGateOwnsSurface();
  const showFirstRunOnboarding =
    !firstRunOnboardingGateOwnsSurface &&
    !suppressFirstRunOnboarding &&
    (SHOW_FIRST_RUN_ONBOARDING || onboardingPreviewMode);
  const initialWidth = defaultSidebarWidth ?? sidebarWidth ?? 380;
  const [open, setOpen] = useState(
    () =>
      openOnChatRunning ||
      getInitialAgentSidebarOpen(effectiveDefaultOpen, sidebarOpenStorageKey),
  );
  const [presentationMode, setPresentationMode] = useState(false);
  const [width, setWidth] = useState(initialWidth);
  const [isWideDrawer, setIsWideDrawer] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(SIDEBAR_DRAWER_KEY) === "true";
    } catch {
      // coercion-ok: the drawer defaults to the normal inline presentation when storage is unavailable.
      return false;
    }
  });
  const [drawerPlaceholderWidth, setDrawerPlaceholderWidth] = useState(() => {
    const fallback = Number.isFinite(initialWidth) ? initialWidth : 380;
    try {
      const saved = localStorage.getItem(SIDEBAR_DRAWER_PLACEHOLDER_KEY);
      const parsed = saved ? Number.parseInt(saved, 10) : Number.NaN;
      if (Number.isFinite(parsed)) return clampAgentSidebarWidth(parsed);
    } catch {
      // coercion-ok: the normal sidebar width is a safe placeholder fallback.
    }
    return clampAgentSidebarWidth(fallback);
  });
  const drawerExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Track mobile viewport so we can switch to overlay mode.
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved) {
        const n = Number.parseInt(saved, 10);
        if (Number.isFinite(n)) setWidth(clampAgentSidebarWidth(n));
      }
    } catch {
      // coercion-ok: unavailable storage leaves the in-memory default width intact.
    }
  }, []);

  useEffect(
    () => () => {
      if (drawerExitTimerRef.current !== null) {
        clearTimeout(drawerExitTimerRef.current);
      }
    },
    [],
  );

  const setOpenPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setOpen((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        setAgentSidebarOpenPreference(value, sidebarOpenStorageKey);
        return value;
      });
    },
    [sidebarOpenStorageKey],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(hostedHarnessStorageKey);
      if (saved && isHostedHarnessRuntime(saved)) {
        setHostedHarnessRuntime(saved);
      }
    } catch {
      // coercion-ok: localStorage is optional persistence; memory state remains authoritative.
      // The picker falls back to Claude Code when storage is unavailable.
    }
  }, [hostedHarnessStorageKey]);

  useEffect(() => {
    if (!hostedHarnessEnabled || hostedHarnessRuntimes.length === 0) return;
    const next = hostedHarnessRuntimes.includes(hostedHarnessRuntime)
      ? hostedHarnessRuntime
      : hostedHarnessRuntimes[0];
    if (!next) return;
    if (next !== hostedHarnessRuntime) setHostedHarnessRuntime(next);
    try {
      localStorage.setItem(hostedHarnessStorageKey, next);
    } catch {
      // coercion-ok: localStorage is optional persistence; memory state remains authoritative.
      // The selected runtime remains in memory for this tab.
    }
  }, [
    hostedHarnessEnabled,
    hostedHarnessRuntimes,
    hostedHarnessRuntime,
    hostedHarnessStorageKey,
  ]);

  const applyUrlOpenOverride = useCallback(() => {
    const override = consumeAgentSidebarUrlOpenOverride(sidebarOpenStorageKey);
    if (override !== null) setOpenPersisted(override);
  }, [setOpenPersisted, sidebarOpenStorageKey]);

  useEffect(() => {
    applyUrlOpenOverride();
    return subscribeAgentSidebarUrlChanges(applyUrlOpenOverride);
  }, [applyUrlOpenOverride]);

  useEffect(() => {
    if (openOnChatRunning && !isPerAppChatHosted) setOpen(true);
  }, [isPerAppChatHosted, openOnChatRunning]);

  // Track whether the frame is controlling the sidebar (code mode = frame active).
  // Default to true when inside an iframe — assume the frame sidebar is active
  // until told otherwise. This prevents both sidebars flashing after hot reloads.
  const [frameCodeMode, setFrameCodeMode] = useState(() =>
    shouldParentFrameOwnAgentPanel(),
  );
  // Frame sidebar visibility: we don't know the frame's open/closed state at
  // mount, so start at false and wait for the frame to dispatch its real
  // state via the message handler below. Initializing to
  // `shouldParentFrameOwnAgentPanel()` here was a category error — that
  // helper reports ownership (which side renders the sidebar), not whether
  // the sidebar is currently open. Mixing them up dispatched a stale
  // "open: true" before the first frame message arrived.
  const [frameSidebarOpen, setFrameSidebarOpen] = useState(false);
  // Has the frame told us its sidebar state yet? In frame-owned mode we
  // don't know whether the sidebar is open or closed until the parent frame
  // dispatches `agentNative.sidebarMode`. Emitting a synthetic
  // `{ open: false }` before that message arrives makes downstream listeners
  // flip a moment later when the real state lands, which is the same
  // ownership-vs-open-state confusion the previous fix addressed.
  const [hasFrameSidebarState, setHasFrameSidebarState] = useState(false);
  const [backgroundPanelActive, setBackgroundPanelActive] = useState(false);
  const [runningTabIds, setRunningTabIds] = useState<Set<string>>(
    () => new Set(),
  );
  const shouldMountPanel =
    enabled &&
    !isPerAppChatHosted &&
    !presentationMode &&
    (!frameCodeMode || !shouldParentFrameOwnAgentPanel()) &&
    (open || backgroundPanelActive || runningTabIds.size > 0);
  const shouldMountPanelRef = useRef(shouldMountPanel);

  useEffect(() => {
    shouldMountPanelRef.current = shouldMountPanel;
  }, [shouldMountPanel]);

  useEffect(() => {
    const frameOwned = frameCodeMode && shouldParentFrameOwnAgentPanel();
    // Skip the initial emit in frame-owned mode — wait until the frame has
    // sent us its real sidebar state. Once we know, this effect re-runs and
    // dispatches the correct value.
    if (frameOwned && !hasFrameSidebarState && !isPerAppChatHosted) return;
    dispatchAgentSidebarStateChange({
      open:
        enabled &&
        (isPerAppChatHosted
          ? perAppChatState.open
          : !presentationMode && (frameOwned ? frameSidebarOpen : open)),
      source: frameOwned ? "frame" : "app",
      mode: frameOwned ? "code" : "app",
    });
  }, [
    frameCodeMode,
    frameSidebarOpen,
    open,
    presentationMode,
    hasFrameSidebarState,
    isPerAppChatHosted,
    perAppChatState.open,
    enabled,
  ]);

  useEffect(() => {
    if (!isPerAppChatSidebar) return;

    const frameOwned = frameCodeMode && shouldParentFrameOwnAgentPanel();
    if (frameOwned && !hasFrameSidebarState) return;

    const openState =
      enabled && !presentationMode && (frameOwned ? frameSidebarOpen : open);
    const message = buildAppChatSidebarStateMessage(openState);

    window.dispatchEvent(
      new CustomEvent(APP_CHAT_SIDEBAR_STATE_EVENT, {
        detail: message.data,
      }),
    );
    postPerAppChatSidebarStateToEmbeddedFrames(openState);

    const handleStateRequest = (event: MessageEvent) => {
      if (event.data?.type !== APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE) return;
      const frame = Array.from(document.querySelectorAll("iframe")).find(
        (candidate) => candidate.contentWindow === event.source,
      );
      if (!frame) return;
      frame.contentWindow?.postMessage(message, event.origin || "*");
    };

    window.addEventListener("message", handleStateRequest);
    return () => window.removeEventListener("message", handleStateRequest);
  }, [
    frameCodeMode,
    frameSidebarOpen,
    hasFrameSidebarState,
    isPerAppChatSidebar,
    open,
    presentationMode,
    enabled,
  ]);

  useEffect(() => {
    const preparePanel = () => setBackgroundPanelActive(true);
    const handleChatRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const tabId =
        typeof detail?.tabId === "string" && detail.tabId
          ? detail.tabId
          : "__default__";

      if (detail?.isRunning === true) {
        if (openOnChatRunning && !isPerAppChatHosted) setOpen(true);
        setRunningTabIds((prev) => {
          const next = new Set(prev);
          next.add(tabId);
          return next;
        });
        return;
      }

      if (detail?.isRunning === false) {
        setRunningTabIds((prev) => {
          if (!prev.has(tabId)) return prev;
          const next = new Set(prev);
          next.delete(tabId);
          return next;
        });
        setBackgroundPanelActive(false);
      }
    };

    window.addEventListener(AGENT_PANEL_PREPARE_EVENT, preparePanel);
    window.addEventListener(AGENT_CHAT_RUNNING_EVENT, handleChatRunning);
    return () => {
      window.removeEventListener(AGENT_PANEL_PREPARE_EVENT, preparePanel);
      window.removeEventListener(AGENT_CHAT_RUNNING_EVENT, handleChatRunning);
    };
  }, [isPerAppChatHosted, openOnChatRunning, setOpenPersisted]);

  useEffect(() => {
    const replayAfterMount = (type: string, event: Event) => {
      if (shouldMountPanelRef.current) return;

      const detail = (event as CustomEvent).detail;
      shouldMountPanelRef.current = true;
      setBackgroundPanelActive(true);
      if (type === AGENT_PANEL_OPEN_SETTINGS_EVENT) {
        setOpenPersisted(true);
      }

      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(type, { detail }));
      }, 0);
    };

    const handleSetMode = (event: Event) => {
      replayAfterMount(AGENT_PANEL_SET_MODE_EVENT, event);
    };
    const handleOpenSettings = (event: Event) => {
      replayAfterMount(AGENT_PANEL_OPEN_SETTINGS_EVENT, event);
    };

    window.addEventListener(AGENT_PANEL_SET_MODE_EVENT, handleSetMode);
    window.addEventListener(
      AGENT_PANEL_OPEN_SETTINGS_EVENT,
      handleOpenSettings,
    );
    return () => {
      window.removeEventListener(AGENT_PANEL_SET_MODE_EVENT, handleSetMode);
      window.removeEventListener(
        AGENT_PANEL_OPEN_SETTINGS_EVENT,
        handleOpenSettings,
      );
    };
  }, [setOpenPersisted]);

  useEffect(() => {
    const toggleHandler = (event: Event) => {
      if (!shouldHandleAgentSidebarToggle(event, toggleScopeId)) return;
      const focusOnOpen =
        (event as CustomEvent<{ focus?: unknown }>).detail?.focus === true;
      const sidebarIsOpen = isPerAppChatHosted
        ? perAppChatState.open
        : frameCodeMode && shouldParentFrameOwnAgentPanel()
          ? frameSidebarOpen
          : open;
      if (focusOnOpen && !sidebarIsOpen) {
        focusAgentChat();
        return;
      }
      if (isPerAppChatHosted) {
        requestPerAppChatCommand("toggle");
        return;
      }
      if (frameCodeMode && shouldParentFrameOwnAgentPanel()) {
        // Forward toggle to frame parent — the frame sidebar handles it
        window.parent.postMessage(
          { type: "agentNative.toggleSidebar" },
          parentFrameTargetOrigin(),
        );
      } else {
        setOpenPersisted((prev) => !prev);
      }
    };
    const openHandler = (event: Event) => {
      const focusOnOpen =
        (event as CustomEvent<{ focus?: unknown }>).detail?.focus === true;
      if (isPerAppChatHosted) {
        requestPerAppChatCommand(
          "open",
          focusOnOpen ? { focus: true } : undefined,
        );
        return;
      }
      if (frameCodeMode && shouldParentFrameOwnAgentPanel()) {
        window.parent.postMessage(
          {
            type: "agentNative.toggleSidebar",
            data: { open: true, ...(focusOnOpen ? { focus: true } : {}) },
          },
          parentFrameTargetOrigin(),
        );
      } else {
        setOpenPersisted(true);
        if (focusOnOpen) focusAgentChatComposer();
      }
    };
    const closeHandler = () => {
      if (isPerAppChatHosted) {
        requestPerAppChatCommand("close");
        return;
      }
      if (frameCodeMode && shouldParentFrameOwnAgentPanel()) {
        window.parent.postMessage(
          { type: "agentNative.toggleSidebar", data: { open: false } },
          parentFrameTargetOrigin(),
        );
      } else {
        setOpenPersisted(false);
      }
    };
    window.addEventListener("agent-panel:toggle", toggleHandler);
    window.addEventListener("agent-panel:open", openHandler);
    window.addEventListener("agent-panel:close", closeHandler);
    return () => {
      window.removeEventListener("agent-panel:toggle", toggleHandler);
      window.removeEventListener("agent-panel:open", openHandler);
      window.removeEventListener("agent-panel:close", closeHandler);
    };
  }, [
    frameCodeMode,
    frameSidebarOpen,
    isPerAppChatHosted,
    open,
    perAppChatState.open,
    setOpenPersisted,
    toggleScopeId,
  ]);

  // Listen for sidebar mode commands from the frame parent.
  // When frame is in "code" mode, hide the app sidebar.
  // When frame is in "app" mode, show the app sidebar, sync width and panel mode.
  useEffect(() => {
    if (window.parent === window) return; // Not in an iframe

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "agentNative.sidebarMode") return;
      if (event.source !== window.parent || !isTrustedFrameMessage(event))
        return;
      const {
        mode,
        appMode,
        width: frameWidth,
        open: frameOpen,
        wide: frameWide,
        placeholderWidth: framePlaceholderWidth,
      } = event.data.data || {};
      if (mode === "code") {
        // Frame is showing its own sidebar — hide the app's
        setFrameCodeMode(true);
        setFrameSidebarOpen(frameOpen !== false);
        setHasFrameSidebarState(true);
        setOpenPersisted(false);
      } else if (mode === "app") {
        // Frame deferred to the app — show and sync width + mode
        setFrameCodeMode(false);
        setFrameSidebarOpen(false);
        setHasFrameSidebarState(true);
        setOpenPersisted(frameOpen !== false);
        if (
          typeof frameWidth === "number" &&
          Number.isFinite(frameWidth) &&
          frameWidth >= AGENT_SIDEBAR_MIN_WIDTH &&
          frameWidth <= getAgentSidebarMaxWidth()
        ) {
          setWidth(frameWidth);
        }
        if (frameWide === true || frameWide === false) {
          setIsWideDrawer(frameWide);
          if (
            typeof framePlaceholderWidth === "number" &&
            Number.isFinite(framePlaceholderWidth) &&
            framePlaceholderWidth >= AGENT_SIDEBAR_MIN_WIDTH &&
            framePlaceholderWidth <= getAgentSidebarMaxWidth()
          ) {
            setDrawerPlaceholderWidth(framePlaceholderWidth);
          }
        }
        // Sync the panel mode from frame tab selection
        if (
          appMode === "cli" ||
          appMode === "resources" ||
          appMode === "chat"
        ) {
          window.dispatchEvent(
            new CustomEvent("agent-panel:set-mode", {
              detail: { mode: appMode },
            }),
          );
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [setOpenPersisted]);

  // Cmd+\ / Ctrl+\ toggles globally; Cmd+I / Ctrl+I can focus chat and attach
  // selected page text as one-shot context for the next turn.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "\\" || e.code === "Backslash")
      ) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("agent-panel:toggle", { detail: { focus: true } }),
        );
        return;
      }
      if (!disableChatShortcut && (e.metaKey || e.ctrlKey) && e.key === "i") {
        if (!shouldHandleAgentPanelChatShortcut(e.target)) return;
        e.preventDefault();
        let selectionText = "";
        try {
          selectionText = window.getSelection()?.toString().trim() ?? "";
        } catch {
          // coercion-ok: selection capture is optional; the shortcut still opens chat.
        }
        if (selectionText) {
          fetch(
            agentNativePath(
              "/_agent-native/application-state/pending-selection-context",
            ),
            {
              method: "PUT",
              keepalive: true,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: selectionText,
                capturedAt: Date.now(),
              }),
            },
          ).catch(() => {});
          window.dispatchEvent(
            new CustomEvent("agent-panel:selection-attached", {
              detail: { text: selectionText, length: selectionText.length },
            }),
          );
        }
        focusAgentChat();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [disableChatShortcut]);

  // Hide sidebar during presentation mode
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "agentNative.presentationMode") return;
      if (event.source !== window.parent || !isTrustedFrameMessage(event))
        return;
      setPresentationMode(event.data.data?.active === true);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleDrag = useCallback((delta: number) => {
    setWidth((prev) => {
      const next = clampAgentSidebarWidth(prev + delta);
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // coercion-ok: the in-memory width update already applied; persistence is optional.
      }
      return next;
    });
  }, []);
  // `view-transition-name` is only legal to carry while a transition is
  // actually capturing. Left on permanently it makes the panel its own
  // stacking context and the containing block for every fixed/absolute
  // descendant, and enlists it as a captured group in unrelated transitions
  // (any React Router `viewTransition` navigation), which is how overlays end
  // up painted at stale offsets. Apply it only around the drawer morph, and
  // flush it into the DOM first: `startViewTransition` captures the old state
  // before it invokes the callback, so a name applied in a normal React commit
  // would land too late to be captured.
  const [drawerMorphing, setDrawerMorphing] = useState(false);
  const runDrawerMorph = useCallback((apply: () => void) => {
    flushSync(() => setDrawerMorphing(true));
    const settle = () => setDrawerMorphing(false);
    const transition = startAgentChatViewTransition(apply);
    if (!transition) {
      settle();
      return;
    }
    transition.finished.then(settle, settle);
  }, []);
  const snapTo75Percent = useCallback(() => {
    if (drawerExitTimerRef.current !== null) {
      clearTimeout(drawerExitTimerRef.current);
      drawerExitTimerRef.current = null;
    }
    const next = getAgentSidebarWideWidth();
    const placeholder = isWideDrawer ? drawerPlaceholderWidth : width;
    const apply = () => {
      setDrawerPlaceholderWidth(placeholder);
      setIsWideDrawer(true);
      setWidth(next);
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
        localStorage.setItem(SIDEBAR_DRAWER_KEY, "true");
        localStorage.setItem(
          SIDEBAR_DRAWER_PLACEHOLDER_KEY,
          String(placeholder),
        );
        // coercion-ok: the drawer remains applied in memory when storage is unavailable.
      } catch {}
    };
    runDrawerMorph(apply);
  }, [runDrawerMorph, drawerPlaceholderWidth, isWideDrawer, width]);
  const exitWideDrawer = useCallback(() => {
    if (!isWideDrawer || drawerExitTimerRef.current !== null) return;
    const next = drawerPlaceholderWidth;
    const apply = () => {
      setWidth(next);
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
        localStorage.setItem(SIDEBAR_DRAWER_KEY, "false");
        // coercion-ok: the normal sidebar remains applied in memory when storage is unavailable.
      } catch {}
      drawerExitTimerRef.current = setTimeout(() => {
        drawerExitTimerRef.current = null;
        setIsWideDrawer(false);
      }, SIDEBAR_ANIMATION_MS + 32);
    };
    runDrawerMorph(apply);
  }, [runDrawerMorph, drawerPlaceholderWidth, isWideDrawer]);
  const handleResizeStart = useCallback(() => setIsResizing(true), []);
  const handleResizeEnd = useCallback(() => setIsResizing(false), []);

  const isLeft = effectivePosition === "left";
  const wideDrawerEnabled = isWideDrawer && !isMobile;
  const mobileAnimationEnabled = !presentationMode && isMobile && animateMobile;
  const desktopAnimationEnabled =
    !presentationMode && !isMobile && effectiveAnimateDesktop;
  const sidebarAnimationEnabled =
    mobileAnimationEnabled || desktopAnimationEnabled;
  const [renderAnimatedPanel, setRenderAnimatedPanel] =
    useState(shouldMountPanel);

  useEffect(() => {
    if (!sidebarAnimationEnabled) {
      setRenderAnimatedPanel(shouldMountPanel);
      return;
    }

    let unmountTimer: number | undefined;

    if (shouldMountPanel) {
      setRenderAnimatedPanel(true);
    } else {
      unmountTimer = window.setTimeout(() => {
        setRenderAnimatedPanel(false);
      }, SIDEBAR_ANIMATION_MS);
    }

    return () => {
      if (unmountTimer !== undefined) {
        window.clearTimeout(unmountTimer);
      }
    };
  }, [shouldMountPanel, sidebarAnimationEnabled]);

  const shouldRenderPanel =
    enabled &&
    (sidebarAnimationEnabled ? renderAnimatedPanel : shouldMountPanel);
  const panelOpen = enabled && open && shouldMountPanel;
  const panelLayout = isMobile
    ? "mobile"
    : wideDrawerEnabled
      ? "drawer"
      : "desktop";
  // On desktop the resize handle is also the visual divider. Avoid painting a
  // second panel border next to it.
  const showResizeHandle = !isMobile && !wideDrawerEnabled && panelOpen;

  // On mobile the sidebar floats as a fixed overlay so the content below isn't
  // squashed. On desktop it participates in the flex layout or becomes a
  // fixed-width drawer when the user asks for more room.
  let panelStyle: AgentPanelStyle;
  if (isMobile) {
    panelStyle = {
      ...AGENT_PANEL_ROOT_STYLE,
      position: "fixed",
      top: 0,
      [isLeft ? "left" : "right"]: 0,
      height: "100%",
      width,
      maxWidth: "85vw",
      maxHeight: "var(--agent-native-viewport-height, 100vh)",
      zIndex: SIDEBAR_OVERLAY_Z_INDEX,
      "--agent-sidebar-background":
        "var(--agent-native-lower-surface, hsl(var(--background)))",
      background: "var(--agent-sidebar-background)",
      borderLeft: isLeft ? "none" : "1px solid hsl(var(--border))",
      borderRight: isLeft ? "1px solid hsl(var(--border))" : "none",
      display: mobileAnimationEnabled || panelOpen ? "flex" : "none",
      "--agent-sidebar-closed-transform": `translateX(${isLeft ? "-" : ""}calc(100% + 1px))`,
      pointerEvents: mobileAnimationEnabled && !panelOpen ? "none" : undefined,
    };
  } else if (wideDrawerEnabled) {
    panelStyle = {
      ...AGENT_PANEL_ROOT_STYLE,
      position: "fixed",
      top: 0,
      [isLeft ? "left" : "right"]: 0,
      height: "100%",
      width,
      maxWidth: "100vw",
      maxHeight: "var(--agent-native-viewport-height, 100vh)",
      zIndex: SIDEBAR_DRAWER_Z_INDEX,
      "--agent-sidebar-background":
        "var(--agent-native-lower-surface, hsl(var(--background)))",
      background: "var(--agent-sidebar-background)",
      borderLeft: isLeft ? "none" : "1px solid hsl(var(--border))",
      borderRight: isLeft ? "1px solid hsl(var(--border))" : "none",
      display: "flex",
      ...(drawerMorphing
        ? { viewTransitionName: SIDEBAR_DRAWER_VIEW_TRANSITION_NAME }
        : null),
    };
  } else {
    panelStyle = {
      ...AGENT_PANEL_ROOT_STYLE,
      "--agent-sidebar-width": `${width}px`,
      "--agent-sidebar-inner-closed-transform": `translateX(${isLeft ? "-" : ""}100%)`,
      "--agent-sidebar-background":
        "var(--agent-native-lower-surface, hsl(var(--background)))",
      background: "var(--agent-sidebar-background)",
      width: desktopAnimationEnabled ? undefined : width,
      maxHeight: "var(--agent-native-viewport-height, 100vh)",
      zIndex: hostedHarnessUi ? SIDEBAR_OVERLAY_Z_INDEX : undefined,
      borderLeft:
        !panelOpen || isLeft || showResizeHandle
          ? "none"
          : "1px solid hsl(var(--border))",
      borderRight:
        !panelOpen || !isLeft || showResizeHandle
          ? "none"
          : "1px solid hsl(var(--border))",
      display: desktopAnimationEnabled || panelOpen ? "flex" : "none",
      minWidth: desktopAnimationEnabled ? 0 : undefined,
      pointerEvents: desktopAnimationEnabled && !panelOpen ? "none" : undefined,
      ...(drawerMorphing
        ? { viewTransitionName: SIDEBAR_DRAWER_VIEW_TRANSITION_NAME }
        : null),
    };
  }

  // Mount the live chat surface only while visible or actively needed. Keeping
  // it mounted while closed starts app-state polling on every public page view.
  const sidebar = shouldRenderPanel ? (
    <>
      {showResizeHandle && !isLeft && (
        <ResizeHandle
          position={effectivePosition}
          onDrag={handleDrag}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
        />
      )}
      <div
        className={cn(
          "agent-sidebar-panel agent-kit-density flex shrink-0 flex-col overflow-hidden antialiased",
          chatViewTransition && AGENT_CHAT_VIEW_TRANSITION_CLASS,
        )}
        data-agent-sidebar-animation={
          wideDrawerEnabled
            ? "drawer"
            : mobileAnimationEnabled
              ? "mobile"
              : desktopAnimationEnabled
                ? "desktop"
                : undefined
        }
        data-agent-sidebar-layout={panelLayout}
        data-agent-sidebar-position={effectivePosition}
        data-agent-native-hosted-harness-ui={
          hostedHarnessUi ? "desktop" : undefined
        }
        data-agent-sidebar-state={panelOpen ? "open" : "closed"}
        data-agent-sidebar-per-app-chat={
          isPerAppChatSidebar ? "true" : undefined
        }
        data-agent-sidebar-resizing={isResizing ? "true" : undefined}
        data-agent-sidebar-chat-handoff={
          chatViewTransitionHandoff ? "true" : undefined
        }
        style={
          chatViewTransition
            ? getAgentChatViewTransitionStyle(panelStyle)
            : panelStyle
        }
        inert={sidebarAnimationEnabled && !panelOpen ? true : undefined}
        aria-hidden={sidebarAnimationEnabled && !panelOpen ? true : undefined}
      >
        <div className="agent-sidebar-panel-inner relative flex min-h-0 flex-1 flex-col">
          <LazyChunkErrorBoundary fallback={<AgentSidebarPanelSkeleton />}>
            <Suspense fallback={<AgentSidebarPanelSkeleton />}>
              <AgentSidebarPanelLazy
                emptyStateText={emptyStateText}
                suggestions={suggestions}
                dynamicSuggestions={dynamicSuggestions}
                suggestionPlacement="context-chips"
                composerToolbarSlot={composerToolbarSlot}
                composerSlot={composerSlot}
                onComposerTextChange={onComposerTextChange}
                imageModelMenu={imageModelMenu}
                availableAgents={effectiveAvailableAgents}
                availableModels={availableModels}
                modelListLoading={modelListLoading}
                selectedAgent={effectiveSelectedAgent}
                onAgentChange={effectiveOnAgentChange}
                hostedHarness={hostedHarnessEnabled}
                onConnectProvider={onConnectProvider}
                onConnectLocalRuntime={onConnectLocalRuntime}
                runtime={runtime}
                adapterReloadKey={adapterReloadKey}
                threadFooterSlot={threadFooterSlot}
                apiUrl={apiUrl}
                agentChatSurface={agentChatSurface}
                desktopIdentityUnauthenticated={desktopIdentityUnauthenticated}
                desktopIdentityAuthenticated={desktopIdentityAuthenticated}
                showTabBar={effectiveShowTabBar}
                suppressInlineOpenApp={suppressInlineOpenApp}
                composerPlaceholder={composerPlaceholder}
                missingApiKeySetupLayout="sidebar"
                defaultMode={defaultMode}
                onCollapse={() => setOpenPersisted(false)}
                showCollapseButton={showCollapseButton}
                onSnapTo75Percent={isMobile ? undefined : snapTo75Percent}
                isWideDrawer={isMobile ? false : isWideDrawer}
                onExitWideDrawer={isMobile ? undefined : exitWideDrawer}
                onFullViewRequest={onFullscreenRequest}
                onOpenSettings={onOpenSettings}
                onNewCliTab={onNewCliTab}
                onNewUiTab={onNewUiTab}
                renderCliTab={renderCliTab}
                newTabMode={newTabMode}
                newCliTabLabel={newCliTabLabel}
                newUiTabLabel={newUiTabLabel}
                storageKey={storageKey}
                restoreActiveThread={restoreActiveThread}
                scope={scope}
                chatHistory={chatHistory}
                isolateHistoryByScope={isolateHistoryByScope}
                showScopeBadge={showScopeBadge}
                browserTabId={resolvedBrowserTabId}
                threadUrlSync={threadUrlSync}
                agentPageHref={agentPageHref}
                thinkingDisplay={thinkingDisplay}
                showModelSelector={showModelSelector}
                chatOnly={chatOnly}
              />
            </Suspense>
          </LazyChunkErrorBoundary>
        </div>
      </div>
      {showResizeHandle && isLeft && (
        <ResizeHandle
          position={effectivePosition}
          onDrag={handleDrag}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
        />
      )}
    </>
  ) : null;

  const drawerPlaceholder =
    wideDrawerEnabled && !presentationMode && panelOpen ? (
      <div
        aria-hidden="true"
        className="agent-sidebar-drawer-placeholder shrink-0"
        data-agent-sidebar-placeholder="true"
        style={{ width: drawerPlaceholderWidth + 1 }}
      />
    ) : null;

  return (
    <AgentSidebarOnboardingContext.Provider value>
      {showFirstRunOnboarding && (
        <Suspense fallback={null}>
          <FirstRunOnboarding />
        </Suspense>
      )}
      <div
        className="agent-sidebar-shell flex min-w-0 flex-1 h-screen overflow-hidden"
        data-agent-sidebar-position={effectivePosition}
        data-agent-native-hosted-harness-ui={
          hostedHarnessUi ? "desktop" : undefined
        }
        data-agent-native-hosted-chat={isPerAppChatHosted ? "true" : undefined}
        data-agent-sidebar-resizing={isResizing ? "true" : undefined}
      >
        {/* Mobile backdrop — tapping it closes the sidebar */}
        {isMobile &&
          !isPerAppChatHosted &&
          !presentationMode &&
          enabled &&
          (mobileAnimationEnabled ? shouldRenderPanel : open) && (
            <div
              className={cn(
                "agent-sidebar-backdrop fixed inset-0 bg-foreground/40",
                mobileAnimationEnabled && !panelOpen && "pointer-events-none",
              )}
              data-agent-sidebar-animation={
                mobileAnimationEnabled ? "mobile" : undefined
              }
              data-agent-sidebar-state={panelOpen ? "open" : "closed"}
              style={{ zIndex: SIDEBAR_OVERLAY_Z_INDEX - 1 }}
              onClick={() => setOpenPersisted(false)}
            />
          )}
        {/* URLSync writes the current URL to application-state so the agent
          sees what page/filters the user is on, and applies URL-update
          commands the agent writes via `set-search-params` / `set-url`. */}
        {shouldMountPanel ? (
          <URLSync browserTabId={resolvedBrowserTabId} />
        ) : null}
        {isResizing ? (
          <div aria-hidden="true" className="agent-sidebar-resize-overlay" />
        ) : null}
        {isLeft && !presentationMode ? sidebar : null}
        {isLeft && !presentationMode ? drawerPlaceholder : null}
        <div
          className="agent-sidebar-main-surface flex flex-1 flex-col overflow-auto min-w-0"
          data-agent-sidebar-main-position={effectivePosition}
          data-agent-sidebar-main-state={
            !isMobile && !presentationMode && panelOpen ? "open" : "closed"
          }
          data-agent-sidebar-resizing={isResizing ? "true" : undefined}
        >
          {/* Screen-refresh key: the agent's `refresh-screen` tool bumps this
            counter, remounting only the main content subtree so it re-fetches
            its data. The sidebar above stays mounted, preserving chat state. */}
          <ScreenRefreshBoundary>{children}</ScreenRefreshBoundary>
        </div>
        {!isLeft && !presentationMode ? drawerPlaceholder : null}
        {!isLeft && !presentationMode ? sidebar : null}
      </div>
    </AgentSidebarOnboardingContext.Provider>
  );
}

/**
 * Focus the agent chat composer input.
 * Opens the sidebar if closed, then focuses the text input.
 */
export function focusAgentChat() {
  void preloadAgentChatSurface();
  window.dispatchEvent(
    new CustomEvent("agent-panel:set-mode", {
      detail: { mode: "chat" },
    }),
  );
  window.dispatchEvent(
    new CustomEvent("agent-panel:open", { detail: { focus: true } }),
  );
  focusAgentChatComposer();
}

function focusAgentChatComposer() {
  const focusComposer = (attempt = 0) => {
    const panel = document.querySelector(
      ".agent-sidebar-panel[data-agent-sidebar-state='open'], " +
        ".agent-frame-sidebar[data-agent-frame-sidebar-state='open']",
    );
    const composer = panel?.querySelector<HTMLElement>(
      ".ProseMirror, textarea",
    );
    if (
      composer &&
      composer.getAttribute("contenteditable") !== "false" &&
      !composer.hasAttribute("disabled")
    ) {
      composer.focus();
      return;
    }
    if (attempt < 40) {
      window.setTimeout(() => focusComposer(attempt + 1), 50);
    }
  };
  // ponytail: retry for 2s so a slow body chunk can still receive shortcut focus.
  requestAnimationFrame(() => focusComposer());
}

/**
 * Button to toggle the agent sidebar. Place this in your app's header/toolbar.
 * Dispatches a custom event that AgentSidebar listens for.
 */
export function AgentToggleButton({
  className,
  icon,
  showWhenOpen = false,
}: {
  className?: string;
  /** Icon rendered inside the toggle. */
  icon?: React.ReactNode;
  /** Keep the toggle visible while the sidebar is open. */
  showWhenOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AgentSidebarStateChangeDetail>)
        .detail;
      if (detail && typeof detail.open === "boolean") setOpen(detail.open);
    };
    window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, handler);
    return () =>
      window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, handler);
  }, []);
  if (open && !showWhenOpen) return null;
  return (
    <DesignSystemTooltip
      trigger={
        <button
          type="button"
          aria-label={t("agentPanel.toggleAgent")}
          aria-pressed={open}
          data-state={open ? "open" : "closed"}
          onPointerEnter={() => void preloadAgentChatSurface()}
          onFocus={() => void preloadAgentChatSurface()}
          onPointerDown={() => void preloadAgentChatSurface()}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("agent-panel:toggle", {
                detail: { focus: true },
              }),
            )
          }
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-accent text-foreground",
            className,
          )}
        >
          {icon ?? <IconLayoutSidebarRight size={18} aria-hidden />}
        </button>
      }
      content={t("agentPanel.toggleAgent")}
      delayMs={200}
    />
  );
}
