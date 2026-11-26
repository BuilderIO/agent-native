export const CHAT_FIRST_PANE_STATE_KEY = "chat-first-pane";

export const CHAT_FIRST_PANE_CONTEXT_STATE_KEY = "dispatch-pane-context";
export const CHAT_FIRST_PANE_BINDING_MAX_AGE_MS = 30 * 60_000;

export function isDispatchChildBrowserTabId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/** Core consumes this value when the newly linked child document starts. */
export const DISPATCH_CHILD_BROWSER_TAB_PARAM = "agentNativeTab";

export interface PersistedChatFirstPane {
  appId: string;
  placement?: "main" | "side";
  path?: string;
  view?: string;
}

export type PersistedChatFirstPaneState =
  | { status: "absent" }
  | { status: "restorable"; pane: PersistedChatFirstPane }
  | { status: "unreadable" };

/**
 * Absent (never saved, or cleared) and unreadable (saved but malformed) are
 * different outcomes: only the second should surface a failure to the user.
 */
export function parsePersistedChatFirstPane(
  value: unknown,
): PersistedChatFirstPaneState {
  if (value === null || value === undefined) return { status: "absent" };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { status: "unreadable" };
  }
  const record = value as Record<string, unknown>;
  if (typeof record.appId !== "string" || !record.appId.trim()) {
    return { status: "unreadable" };
  }
  return {
    status: "restorable",
    pane: {
      appId: record.appId,
      ...(record.placement === "main" || record.placement === "side"
        ? { placement: record.placement }
        : {}),
      ...(typeof record.path === "string" ? { path: record.path } : {}),
      ...(typeof record.view === "string" ? { view: record.view } : {}),
    },
  };
}
