export const AGENT_PANEL_PREPARE_EVENT = "agent-panel:prepare";
export const AGENT_PANEL_SET_MODE_EVENT = "agent-panel:set-mode";
export const AGENT_PANEL_OPEN_SETTINGS_EVENT = "agent-panel:open-settings";
export const AGENT_CHAT_RUNNING_EVENT = "agentNative.chatRunning";

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
