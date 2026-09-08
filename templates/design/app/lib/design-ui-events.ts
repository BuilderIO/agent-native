export const DESIGN_UI_TOGGLE_EVENT = "agent-native:toggle-design-ui";

export function requestDesignUiToggle(): void {
  window.dispatchEvent(new Event(DESIGN_UI_TOGGLE_EVENT));
}
