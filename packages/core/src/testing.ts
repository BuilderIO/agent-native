/**
 * `@agent-native/core/testing` — a small barrel of internal symbols that
 * template test suites need direct access to (an in-memory db factory, the
 * local Design/Plan dev bridges, and the shared rich-markdown-editor drag
 * handle). Published so template specs can import these through the package
 * boundary instead of reaching into `packages/core/src/**` with deep
 * relative paths.
 *
 * Keep this list minimal — only add a re-export when a template spec
 * actually needs it.
 */

export {
  createGetDb,
  patchBetterSqliteTransactions,
} from "./db/create-get-db.js";

export { startLocalPlanBridge } from "./cli/plan-local.js";

export {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "./cli/design-connect.js";

export { DragHandle } from "./client/rich-markdown-editor/DragHandle.js";
