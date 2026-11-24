import {
  resolveChatFirstAppTarget,
  type ChatFirstAppRegistration,
  type ChatFirstAppResolution,
  type ChatFirstOpenAppDetail,
  type ChatFirstSurfaceTab,
} from "@agent-native/core/client/chat-first-state";

export function resolveDispatchChatFirstAppTarget(
  detail: ChatFirstOpenAppDetail,
  apps: readonly ChatFirstAppRegistration[],
  options?: { currentOrigin?: string },
): ChatFirstAppResolution {
  const requested = detail.app?.trim().toLowerCase();
  if (!requested) return resolveChatFirstAppTarget(detail, apps, options);

  const enabled = apps.filter((app) => app.enabled !== false);
  const exact = enabled.find((app) => app.id.toLowerCase() === requested);
  if (exact) return resolveChatFirstAppTarget(detail, [exact], options);

  const named = enabled.filter(
    (app) => app.name?.trim().toLowerCase() === requested,
  );
  return !requested.includes("/") && named.length === 1
    ? resolveChatFirstAppTarget(detail, named, options)
    : { status: "unresolved", reason: "unknown-app" };
}

/**
 * The tab the side panel shows.
 *
 * The tab store keeps `activeTabId` null when the first app opens beside the
 * chat, so the chat stays the main surface. The panel still has to show that
 * app: with every tab treated as inactive it rendered a strip and an app frame
 * inside a `display: none` wrapper, measured at 0 x 0.
 */
export function visibleChatFirstSurfaceTabId(
  tabs: readonly Pick<ChatFirstSurfaceTab, "id" | "kind" | "placement">[],
  activeTabId: string | null,
): string | null {
  if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return (
    tabs.find((tab) => tab.kind === "app" && tab.placement === "side")?.id ??
    null
  );
}

const DELEGATION_TOOLS: Partial<Record<string, "agent" | "app">> = {
  "call-agent": "agent",
  ask_app: "app",
  call_app_action: "app",
  list_app_actions: "app",
};
const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The workspace app a first-party Dispatch delegation is about to work in.
 * Opening that app beside the chat while the delegate runs lets the app's own
 * navigation and edits show live, the way the desktop shell shows the app it
 * is working in.
 */
export function delegatedAppFromToolStart(
  detail: { tool?: unknown; input?: unknown } | null | undefined,
): string | null {
  if (!detail || typeof detail.tool !== "string") return null;
  const key = DELEGATION_TOOLS[detail.tool];
  if (!key) return null;
  const input = detail.input;
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.viewportMode === "string" &&
    record.viewportMode.trim().toLowerCase() === "background"
  ) {
    return null;
  }
  const value = record[key === "agent" ? "agent" : "app"];
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  if (!APP_ID_PATTERN.test(id) || id === "dispatch") return null;
  return id;
}

export interface TurnViewportLockEvaluation {
  allowed: boolean;
  lockedAppId: string | null;
}

export interface TurnViewportLock {
  beginTurn: (turnKey?: string) => void;
  clear: () => void;
  getLockedAppId: () => string | null;
  evaluate: (request: {
    appId: string;
    focus?: boolean | undefined;
    turnKey?: string | undefined;
    viewportMode?: "foreground" | "background" | undefined;
  }) => TurnViewportLockEvaluation;
}

/**
 * Turn-scoped foreground viewport lock: once a turn commits a foreground app,
 * secondary or background lookups targeting another app cannot overwrite the
 * visible pane unless `focus: true` is explicitly passed.
 */
export function createTurnViewportLock(): TurnViewportLock {
  let currentTurnKey: string | null = null;
  let lockedAppId: string | null = null;

  return {
    beginTurn(turnKey?: string) {
      currentTurnKey = turnKey ?? null;
      lockedAppId = null;
    },
    clear() {
      currentTurnKey = null;
      lockedAppId = null;
    },
    getLockedAppId() {
      return lockedAppId;
    },
    evaluate(request) {
      const normalizedAppId = request.appId.trim().toLowerCase();
      if (!normalizedAppId) {
        return { allowed: false, lockedAppId };
      }
      if (request.viewportMode === "background") {
        return { allowed: false, lockedAppId };
      }
      if (request.turnKey !== undefined && request.turnKey !== currentTurnKey) {
        currentTurnKey = request.turnKey;
        lockedAppId = null;
      }
      if (lockedAppId === null) {
        lockedAppId = normalizedAppId;
        return { allowed: true, lockedAppId };
      }
      if (lockedAppId === normalizedAppId) {
        return { allowed: true, lockedAppId };
      }
      if (request.focus === true) {
        lockedAppId = normalizedAppId;
        return { allowed: true, lockedAppId };
      }
      return { allowed: false, lockedAppId };
    },
  };
}
