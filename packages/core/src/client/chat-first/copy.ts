import type { ChatFirstSurfaceKind } from "../chat-first.js";
import type { ChatFirstCopy } from "./types.js";

const DEFAULT_COPY: Record<string, string> = {
  newChat: "New chat",
  search: "Search",
  workspaceApps: "Apps",
  allApps: "All apps",
  integrations: "Integrations",
  scheduled: "Scheduled",
  createWorkspaceApp: "Create app",
  openApp: "Open {name}",
  appsLoadError: "Apps could not be loaded",
  noWorkspaceApps: "No apps yet",
  createApp: "Create app",
  retry: "Retry",
  dismiss: "Dismiss",
  unpinApp: "Unpin {name}",
  pinApp: "Pin {name}",
  removePinned: "Remove from pinned apps",
  pinTop: "Pin app to the top",
  moveUp: "Move up",
  moveDown: "Move down",
  removeApp: "Remove app from workspace",
  showMore: "Show more",
  showLess: "Show less",
  appOrderUnavailable: "App order could not be saved on this device.",
  openSideSurfaces: "Open side surfaces",
  sideSurfaces: "Side surfaces",
  resizeSideSurface: "Resize side surface",
  closeTab: "Close {name}",
  close: "Close",
  closeOthers: "Close others",
  closeToRight: "Close to the right",
  closeAll: "Close all",
  deferred: "Deferred",
  openActivity: "Open activity",
  unavailable: "This surface is not available here.",
  browserBack: "Back",
  browserForward: "Forward",
  browserReload: "Reload page",
  browserAddress: "Browser address",
  browserOpenExternal: "Open in external browser",
  browserClose: "Close browser",
  browserPage: "Browser page",
  browserInvalidUrl: "Enter a full http(s) URL to navigate.",
  browserPreviewStarting: "Starting preview…",
  browserPreviewError: "Preview unavailable",
  appUnavailable: "This workspace app is no longer available.",
  appLoading: "Loading app",
  agentActivityEyebrow: "Workspace",
  agentActivityTitle: "Agent activity",
  agentActivityDescription:
    "Follow runs and open a second session beside this chat.",
  refreshAgentActivity: "Refresh agent activity",
  noAgentSessions: "No agent sessions yet",
  startAgentSession: "Start an agent run and it will appear here.",
  watchSession: "Watch",
  copySessionId: "Copy session ID",
  copySessionIdFor: "Copy session ID for {name}",
  sessionIdCopied: "Session ID copied",
  sessionIdShort: "ID",
  copied: "Copied",
  agentActivityStatusQueued: "Queued",
  agentActivityStatusRunning: "Running",
  agentActivityStatusPaused: "Paused",
  agentActivityStatusNeedsApproval: "Needs approval",
  agentActivityStatusCompleted: "Completed",
  agentActivityStatusErrored: "Needs attention",
  agentActivityStatusRecent: "Recent",
  agentActivityStatusUnknown: "Unknown",
  watchingSession: "Watching {name}",
  session: "session",
  stopWatchingSession: "Stop watching session",
  stopWatching: "Stop watching",
  watchedSession: "Watched session",
  agentsTitle: "Subagents",
};

const SURFACE_COPY: Record<
  ChatFirstSurfaceKind,
  { label: string; reason: string }
> = {
  app: {
    label: "App",
    reason: "Open a workspace app beside the conversation.",
  },
  browser: {
    label: "Browser",
    reason: "Ask the agent to open a web URL.",
  },
  terminal: {
    label: "Terminal",
    reason:
      "Deferred: an embedded PTY lifecycle is not connected in this release.",
  },
  files: {
    label: "Files",
    reason:
      "Deferred: a bounded workspace tree is not connected in this release.",
  },
  diff: {
    label: "Diff",
    reason: "Deferred: changed-file data is not connected in this release.",
  },
  "side-chat": {
    label: "Side chat",
    reason: "Choose Watch and message from any chat row.",
  },
  agents: {
    label: "Agents",
    reason: "Review recent runs or watch one beside this conversation.",
  },
};

function interpolate(value: string, values?: Record<string, string>): string {
  if (!values) return value;
  return value.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

export const defaultChatFirstCopy: ChatFirstCopy = (key, values) => {
  if (key.startsWith("surface.")) {
    const [, kind, field] = key.split(".");
    const surface = SURFACE_COPY[kind as ChatFirstSurfaceKind];
    if (surface && (field === "label" || field === "reason")) {
      return surface[field];
    }
  }
  return interpolate(DEFAULT_COPY[key] ?? key, values);
};
