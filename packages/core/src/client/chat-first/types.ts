import type { ReactNode } from "react";

import type {
  ChatFirstAgentActivity,
  ChatFirstAppLayoutPreference,
  ChatFirstSessionReference,
  ChatFirstSurfaceKind,
  ChatFirstSurfaceTab,
} from "../chat-first.js";

export type { ChatFirstAgentActivity, ChatFirstSurfaceTab };

export interface ChatFirstAppItem {
  id: string;
  name: string;
  icon?: string;
  color?: string;
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
  apps?: readonly ChatFirstAppItem[];
  onOpenApp?: (app: ChatFirstAppItem) => void;
  renderAppIcon?: (app: ChatFirstAppItem) => ReactNode;
  copy?: ChatFirstCopy;
}

export interface ChatFirstAppRailProps {
  apps: readonly ChatFirstAppItem[];
  activeAppId?: string;
  loading?: boolean;
  error?: string | null;
  collapsed?: boolean;
  layout?: ChatFirstAppLayoutPreference;
  onLayoutChange?: (layout: ChatFirstAppLayoutPreference) => void;
  onLayoutError?: (reason: "unavailable" | "write-failed") => void;
  onRetry?: () => void;
  onOpenApp: (app: ChatFirstAppItem) => void;
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
