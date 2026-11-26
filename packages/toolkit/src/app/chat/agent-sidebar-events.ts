export const AGENT_PANEL_PREPARE_EVENT = "agent-panel:prepare";
export const AGENT_PANEL_SET_MODE_EVENT = "agent-panel:set-mode";
export const AGENT_PANEL_OPEN_SETTINGS_EVENT = "agent-panel:open-settings";
export const AGENT_CHAT_RUNNING_EVENT = "agentNative.chatRunning";

export type AgentChatNavigationKey = string | Event;

export function getAgentChatNavigationKey(
  event: Event,
): AgentChatNavigationKey {
  const id = (event as CustomEvent<{ openRequestId?: unknown }>).detail
    ?.openRequestId;
  return typeof id === "string" && id ? id : event;
}

export interface AgentPanelChatShortcutEvent extends KeyboardEvent {
  agentNativeSelectionText?: string;
}

export function isAgentSidebarToggleShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "\\" || event.code === "Backslash")
  );
}

export function isAgentPanelChatShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.key === "i" &&
    shouldHandleAgentPanelChatShortcut(event.target)
  );
}

export function agentPanelShortcutSelectionText(
  event: AgentPanelChatShortcutEvent,
): string {
  if (typeof event.agentNativeSelectionText === "string")
    return event.agentNativeSelectionText;
  return window.getSelection()?.toString().trim() ?? "";
}

export function shouldHandleAgentSidebarToggle(
  event: Event,
  toggleScopeId?: string | null,
): boolean {
  const detail = (event as CustomEvent<{ scopeId?: unknown }>).detail;
  if (!detail || detail.scopeId === undefined) return true;
  return typeof detail.scopeId === "string" && detail.scopeId === toggleScopeId;
}

export function shouldHandleAgentPanelChatShortcut(
  target: EventTarget | null,
): boolean {
  const element = target as HTMLElement | null;
  if (!element) return true;
  return !(
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable ||
    element.closest?.("[contenteditable]")
  );
}

/** Open chat without importing the sidebar renderer or its deferred UI graph. */
export function focusAgentChat() {
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

export function focusAgentChatComposer() {
  const focusComposer = (attempt = 0) => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;
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
