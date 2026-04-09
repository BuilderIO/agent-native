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

import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getH3App, awaitBootstrap } from "./framework-request-handler.js";
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
import { getCollabEmitter } from "../collab/emitter.js";
import { recordChange } from "./poll.js";

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
    await awaitBootstrap(nitroApp);
    const P = FRAMEWORK_ROUTE_PREFIX;

    // Wire collab emitter → poll ring buffer so clients receive Yjs updates
    const collabEmitter = getCollabEmitter();
    collabEmitter.on("collab", (event) => {
      recordChange(event);
    });

    // Mount collab routes — manual method dispatch since the path layout is
    // `/collab/:docId/<action>`. The framework strips the `/collab` mount
    // prefix from event.url.pathname before calling us, so we see e.g.
    // `/abc-123/state`.
    getH3App(nitroApp).use(
      `${P}/collab`,
      defineEventHandler(async (event: H3Event) => {
        const parts = (event.url?.pathname || "")
          .replace(/^\/+/, "")
          .split("/");
        const docId = parts[0] || "";
        const action = parts[1] || "";
        if (!docId) return;
        if (event.context) {
          event.context.params = { ...event.context.params, docId };
        }
        const method = getMethod(event);
        if (action === "state" && method === "GET")
          return getCollabState(event);
        if (action === "update" && method === "POST")
          return postCollabUpdate(event);
        if (action === "text" && method === "POST")
          return postCollabText(event);
        if (action === "search-replace" && method === "POST")
          return postCollabSearchReplace(event);
        if (action === "awareness" && method === "POST")
          return postAwareness(event);
        if (action === "users" && method === "GET")
          return getActiveUsers(event);
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );

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
