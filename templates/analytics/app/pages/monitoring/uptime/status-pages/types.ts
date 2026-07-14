/**
 * Client-facing status-page contract. We re-export the server library's
 * type-only shapes (erased at build time) from a single place so the editor and
 * list components share one source of truth with the actions they call.
 */
export type {
  PublicStatusPage,
  StatusPage,
  StatusPageAlignment,
  StatusPageDensity,
  StatusPageInput,
  StatusPageMonitorInput,
  StatusPageMonitorRef,
} from "../../../../../server/lib/status-pages";

/** Response shape of the `get-status-page` action: config + live preview view. */
export interface StatusPagePreview {
  page: import("../../../../../server/lib/status-pages").StatusPage;
  view: import("../../../../../server/lib/status-pages").PublicStatusPage;
}
