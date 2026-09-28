export const AGENT_PANEL_PREPARE_EVENT = "agent-panel:prepare";
export const AGENT_PANEL_SET_MODE_EVENT = "agent-panel:set-mode";
export const AGENT_PANEL_OPEN_SETTINGS_EVENT = "agent-panel:open-settings";
export const AGENT_CHAT_RUNNING_EVENT = "agentNative.chatRunning";

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
