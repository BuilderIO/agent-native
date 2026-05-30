export { DbAdminPage } from "./DbAdminPage.js";
export {
  DevDatabaseLink,
  type DevDatabaseLinkProps,
} from "./DevDatabaseLink.js";

// Shared data layer + helpers (re-exported for convenience).
export {
  dbAdminBasePath,
  dbAdminGet,
  dbAdminPost,
  useOverview,
  useTableSchema,
  useTableRows,
  mutateTable,
  runQuery,
  type DbAdminOverview,
  type DbAdminQueryState,
} from "./useDbAdmin.js";
export {
  loadGridState,
  saveGridState,
  getLS,
  setLS,
  removeLS,
  type GridState,
} from "./storage.js";
export {
  useDbAdminAgentSync,
  useNavigateConsumer,
  type DbAdminNavigationState,
} from "./useAgentSync.js";
export { TableBrowser, type TableBrowserProps } from "./TableBrowser.js";
