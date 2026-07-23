import type { QueryClient } from "@tanstack/react-query";

export const LIST_INBOX_ITEMS_QUERY_KEY = [
  "action",
  "list-inbox-items",
] as const;
export const LIST_TASKS_QUERY_KEY = ["action", "list-tasks"] as const;
export const LIST_CUSTOM_FIELDS_QUERY_KEY = [
  "action",
  "list-custom-fields",
] as const;
export const LIST_VISIBLE_TASK_FIELDS_QUERY_KEY = [
  "action",
  "list-visible-task-fields",
] as const;

export function invalidateInboxItems(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: LIST_INBOX_ITEMS_QUERY_KEY });
}

export function invalidateTasks(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: LIST_TASKS_QUERY_KEY });
}

export function invalidateCustomFields(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: LIST_CUSTOM_FIELDS_QUERY_KEY });
}

export function invalidateVisibleTaskFields(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: LIST_VISIBLE_TASK_FIELDS_QUERY_KEY });
}
