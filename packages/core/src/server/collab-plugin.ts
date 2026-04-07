/**
 * Nitro plugin that mounts collaborative editing routes.
 *
 * Templates opt in with one line:
 * ```ts
 * // server/plugins/collab.ts
 * import { createCollabPlugin } from "@agent-native/core/server";
 * export default createCollabPlugin({ table: "documents", contentColumn: "content" });
 * ```
 */

import { createRouter } from "h3";
import { getH3App } from "./framework-request-handler.js";
import { FRAMEWORK_ROUTE_PREFIX } from "./core-routes-plugin.js";
import {
  getCollabState,
  postCollabUpdate,
  postCollabText,
  postCollabSearchReplace,
} from "../collab/routes.js";
import { postAwareness, getActiveUsers } from "../collab/awareness.js";
import { seedFromText } from "../collab/ydoc-manager.js";
import { hasCollabState } from "../collab/storage.js";
import { getDbExec } from "../db/client.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface CollabPluginOptions {
  /** Table name containing document content. Default: "documents" */
  table?: string;
  /** Column name for text content. Default: "content" */
  contentColumn?: string;
  /** Column name for the document ID. Default: "id" */
  idColumn?: string;
  /** Whether to auto-seed existing documents on startup. Default: true */
  autoSeed?: boolean;
  /**
   * Callback invoked after a collab update to sync the content column.
   * If not provided, the plugin auto-syncs using table/contentColumn/idColumn.
   */
  onContentSync?: (docId: string, text: string) => Promise<void>;
}

export function createCollabPlugin(
  options: CollabPluginOptions = {},
): NitroPluginDef {
  const {
    table = "documents",
    contentColumn = "content",
    idColumn = "id",
    autoSeed = true,
  } = options;

  return async (nitroApp: any) => {
    const P = FRAMEWORK_ROUTE_PREFIX;

    // Mount collab routes
    const router = createRouter()
      .get("/:docId/state", getCollabState)
      .post("/:docId/update", postCollabUpdate)
      .post("/:docId/text", postCollabText)
      .post("/:docId/search-replace", postCollabSearchReplace)
      .post("/:docId/awareness", postAwareness)
      .get("/:docId/users", getActiveUsers);

    getH3App(nitroApp).use(`${P}/collab`, router.handler);

    // Auto-seed existing documents into collab state
    if (autoSeed) {
      // Run in background so it doesn't block startup
      setTimeout(async () => {
        try {
          const client = getDbExec();
          const { rows } = await client.execute(
            `SELECT ${idColumn}, ${contentColumn} FROM ${table}`,
          );
          for (const row of rows) {
            const docId = row[idColumn] as string;
            const content = (row[contentColumn] as string) ?? "";
            const exists = await hasCollabState(docId);
            if (!exists) {
              await seedFromText(docId, content);
            }
          }
        } catch {
          // Table may not exist yet on first boot — that's fine
        }
      }, 1000);
    }
  };
}
