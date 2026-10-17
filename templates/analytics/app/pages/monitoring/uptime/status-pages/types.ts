export type {
  PublicStatusPage,
  StatusPage,
  StatusPageAlignment,
  StatusPageDensity,
  StatusPageInput,
  StatusPageMonitorInput,
  StatusPageMonitorRef,
} from "../../../../../server/lib/status-pages";

export interface StatusPagePreview {
  page: import("../../../../../server/lib/status-pages").StatusPage;
  view: import("../../../../../server/lib/status-pages").PublicStatusPage;
}
