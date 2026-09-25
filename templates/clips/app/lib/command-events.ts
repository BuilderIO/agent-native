export const OPEN_CREATE_FOLDER_EVENT = "clips:open-create-folder";
export const OPEN_CREATE_SPACE_EVENT = "clips:open-create-space";
export const OPEN_BUG_REPORT_EVENT = "clips:open-bug-report";

export function openBugReportDialog() {
  window.dispatchEvent(new Event(OPEN_BUG_REPORT_EVENT));
}
