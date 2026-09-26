import { openCommandMenu } from "@agent-native/core/client/navigation";

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

export const CRM_SEARCH_ATTRIBUTE = "data-crm-search";

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
