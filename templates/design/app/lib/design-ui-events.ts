export const DESIGN_UI_TOGGLE_EVENT = "agent-native:toggle-design-ui";
export const DESIGN_HISTORY_OPEN_EVENT = "agent-native:open-design-history";

export function requestDesignUiToggle(): void {
  window.dispatchEvent(new Event(DESIGN_UI_TOGGLE_EVENT));
}

export function requestDesignHistoryOpen(): void {
  window.dispatchEvent(new Event(DESIGN_HISTORY_OPEN_EVENT));
}
