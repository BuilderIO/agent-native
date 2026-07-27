import { openCommandMenu } from "@agent-native/core/client/navigation";

/**
 * Keyboard shortcuts live in the shell but the dialogs they open belong to
 * whichever page is mounted, so the shell announces an intent and the page
 * decides. A page that never listens simply does nothing — no shell change is
 * needed to add or drop a surface.
 */

export const CRM_NEW_RECORD_EVENT = "crm:new-record";
export const CRM_NEW_TASK_EVENT = "crm:new-task";
export const CRM_EDIT_RECORD_EVENT = "crm:edit-record";

export type CrmUiIntent =
  | typeof CRM_NEW_RECORD_EVENT
  | typeof CRM_NEW_TASK_EVENT
  | typeof CRM_EDIT_RECORD_EVENT;

export function emitCrmUiIntent(intent: CrmUiIntent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(intent));
}

/** Marks the page's own search field as the `/` shortcut target. */
export const CRM_SEARCH_ATTRIBUTE = "data-crm-search";

/**
 * `/` prefers the page's own search box and falls back to the command menu,
 * which is the app-wide search when a page has none.
 */
export function focusCrmSearch() {
  if (typeof document === "undefined") return;
  const field = document.querySelector<HTMLElement>(
    `[${CRM_SEARCH_ATTRIBUTE}]`,
  );
  if (field) {
    field.focus();
    return;
  }
  openCommandMenu();
}
