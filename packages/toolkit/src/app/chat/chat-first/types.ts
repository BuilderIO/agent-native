import type {
  ChatFirstAgentActivity,
  ChatFirstAppLayoutPreference,
  ChatFirstSessionReference,
  ChatFirstSurfaceKind,
  ChatFirstSurfaceTab,
} from "@agent-native/core/client/chat-first-state";
import type { ReactNode } from "react";

import type { ChatFirstPrimaryTab } from "./active-surface.js";

export type { ChatFirstAgentActivity, ChatFirstSurfaceTab };

export interface ChatFirstAppItem {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  source?: "workspace" | "builtin" | "connected";
}

export type ChatFirstCopy = (
  key: string,
  values?: Record<string, string>,
) => string;

export interface ChatFirstAppIconRenderOptions {
  isActive: boolean;
  isInactive: boolean;
}

export interface ChatFirstEmbedTarget {
  url: string;
  title?: string;
  key?: string | number;
}

export interface ChatFirstAppPaneProps {
  app: ChatFirstAppItem | null;
  status: "loading" | "ready" | "unresolved" | "error";
  embedUrl?: string | null;
  errorMessage?: string | null;
  onRetry?: () => void;
  renderEmbed: (target: ChatFirstEmbedTarget) => ReactNode;
  copy?: ChatFirstCopy;
}

export interface ChatFirstSurfaceTabsProps {
  tabs: ChatFirstSurfaceTab[];
  activeTabId: string | null;
  onActivate: (tab: ChatFirstSurfaceTab) => void;
  onClose: (tab: ChatFirstSurfaceTab) => void;
  onCloseOthers: (tab: ChatFirstSurfaceTab) => void;
  onCloseToRight: (tab: ChatFirstSurfaceTab) => void;
  onCloseAll: () => void;
  onOpenSurface?: (kind: ChatFirstSurfaceKind) => void;
  hiddenSurfaceKinds?: readonly ChatFirstSurfaceKind[];
  onAddTab?: () => void;
  addTabLabel?: string;
  apps?: readonly ChatFirstAppItem[];
  onOpenApp?: (app: ChatFirstAppItem) => void;
  renderAppIcon?: (app: ChatFirstAppItem) => ReactNode;
  copy?: ChatFirstCopy;
}

export interface ChatFirstAppRailSection {
  id: string;
  label: string;
  /** Rows in display order; ids missing from `apps` are skipped. */
  appIds: readonly string[];
  /** Rendered at the end of the section header. */
  action?: ReactNode;
  /** Shown in place of rows when the section has no apps. */
  emptyLabel?: string;
}

export interface ChatFirstAppRailProps {
  apps: readonly ChatFirstAppItem[];
  /**
   * Grouped rows, shown in full in both the expanded and collapsed rail. The
   * host owns the grouping and order, so sectioned rails offer no drag or move
   * reordering.
   */
  sections?: readonly ChatFirstAppRailSection[];
  defaultAppIds?: readonly string[];
  activeAppId?: string;
  activeTab?: ChatFirstPrimaryTab;
  loading?: boolean;
  error?: string | null;
  collapsed?: boolean;
  grayscaleInactiveIcons?: boolean;
  layout?: ChatFirstAppLayoutPreference;
  onLayoutChange?: (layout: ChatFirstAppLayoutPreference) => void;
  /**
   * Pin or unpin from the host's latest layout. When set, the rail hands pin
   * changes to the host instead of `onLayoutChange` with a whole layout built
   * from its own, possibly stale, copy.
   */
  onTogglePinned?: (appId: string) => void;
  onLayoutError?: (reason: "unavailable" | "write-failed") => void;
  onRetry?: () => void;
  onOpenApp: (app: ChatFirstAppItem) => void;
  onReloadApp?: (app: ChatFirstAppItem) => void;
  onRemoveApp?: (app: ChatFirstAppItem) => void;
  onOpenAllApps?: () => void;
  onCreateApp?: () => void;
  createAppTrigger?: ReactNode;
  renderIcon: (
    app: ChatFirstAppItem,
    options?: ChatFirstAppIconRenderOptions,
  ) => ReactNode;
  copy?: ChatFirstCopy;
}

export interface ChatFirstBrowserPaneProps {
  url: string;
  title?: string;
  status?: "starting" | "ready" | "error";
  statusMessage?: string;
  onClose: () => void;
  renderEmbed: (target: ChatFirstEmbedTarget) => ReactNode;
  copy?: ChatFirstCopy;
}

export interface ChatFirstSessionWatchPaneProps {
  target: ChatFirstSessionReference | null;
  onClose: () => void;
  renderChat: (target: ChatFirstSessionReference) => ReactNode;
  copy?: ChatFirstCopy;
}

export interface ChatFirstAgentsPaneProps {
  activities: readonly ChatFirstAgentActivity[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onWatch: (activity: ChatFirstAgentActivity) => void;
  copy?: ChatFirstCopy;
}
