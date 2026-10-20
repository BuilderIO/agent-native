export const CONTENT_COMMAND_MENU_OPEN_EVENT = "content:open-command-menu";

export function openContentCommandMenu(returnFocusTo?: HTMLElement) {
  window.dispatchEvent(
    new CustomEvent(CONTENT_COMMAND_MENU_OPEN_EVENT, {
      detail: { returnFocusTo },
    }),
  );
}
