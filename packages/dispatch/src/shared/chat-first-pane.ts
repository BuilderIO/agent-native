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
