import type { ChatFirstSurfaceTab } from "@agent-native/core/client/chat-first-state";

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

const DELEGATION_TOOLS: Record<string, "agent" | "app"> = {
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
  const value = (input as Record<string, unknown>)[
    key === "agent" ? "agent" : "app"
  ];
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  if (!APP_ID_PATTERN.test(id) || id === "dispatch") return null;
  return id;
}
