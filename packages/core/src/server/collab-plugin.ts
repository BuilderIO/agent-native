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
import {
  postCollabJson,
  getCollabJson,
  postCollabPatch,
} from "../collab/struct-routes.js";
import { postAwareness, getActiveUsers } from "../collab/awareness.js";
import { seedFromText, seedFromJson } from "../collab/ydoc-manager.js";
import { hasCollabState } from "../collab/storage.js";
import { getDbExec } from "../db/client.js";
import { getCollabEmitter } from "../collab/emitter.js";
import { recordChange } from "./poll.js";
import { getSession } from "./auth.js";
import { getOrgContext } from "../org/context.js";
import { runWithRequestContext } from "./request-context.js";
import { resolveAccess, assertAccess } from "../sharing/access.js";

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
  /** Content type: "text" for Y.Text (default) or "json" for Y.Map/Y.Array. */
  contentType?: "text" | "json";
  /** Column name for JSON content (used when contentType is "json"). */
  jsonColumn?: string;
  /**
   * The shareable resource type registered via `registerShareableResource`.
   * Used to enforce access checks on collab routes.
   * Omit only for resources that are always public (no sharing model).
   */
  resourceType?: string;
  /**
   * Map the collab document id to the shareable resource id. Many templates
   * use route-specific collab ids (for example, one doc per slide inside a
   * deck) while sharing is enforced at the parent resource level.
   */
  resolveResourceId?: (docId: string) => string | null | Promise<string | null>;
}

export function createCollabPlugin(
  options: CollabPluginOptions = {},
): NitroPluginDef {
  const {
    table = "documents",
    contentColumn = "content",
    idColumn = "id",
    autoSeed = true,
    resourceType,
    resolveResourceId,
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

        // Auth check — all collab routes require a session
        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "Authentication required" };
        }

        const orgCtx = await getOrgContext(event).catch(() => null);
        const userEmail = session.email;
        const orgId = orgCtx?.orgId ?? undefined;

        return runWithRequestContext({ userEmail, orgId }, async () => {
          // Access check — require at least viewer for reads, editor for writes
          if (resourceType) {
            const resourceId = resolveResourceId
              ? await resolveResourceId(docId)
              : docId;
            if (!resourceId) {
              setResponseStatus(event, 404);
              return { error: "Not found" };
            }
            const isWrite =
              (action === "update" && method === "POST") ||
              (action === "text" && method === "POST") ||
              (action === "search-replace" && method === "POST") ||
              (action === "json" && method === "POST") ||
              (action === "patch" && method === "POST");

            if (isWrite) {
              // assertAccess throws ForbiddenError (→ 403) if no editor access
              await assertAccess(resourceType, resourceId, "editor");
            } else {
              // resolveAccess returns null when no access; return 404 to avoid leaking existence
              const access = await resolveAccess(resourceType, resourceId);
              if (!access) {
                setResponseStatus(event, 404);
                return { error: "Not found" };
              }
            }
          }

          if (action === "state" && method === "GET")
            return getCollabState(event);
          if (action === "update" && method === "POST")
            return postCollabUpdate(event);
          if (action === "text" && method === "POST")
            return postCollabText(event);
          if (action === "search-replace" && method === "POST")
            return postCollabSearchReplace(event);
          if (action === "json" && method === "POST")
            return postCollabJson(event);
          if (action === "json" && method === "GET")
            return getCollabJson(event);
          if (action === "patch" && method === "POST")
            return postCollabPatch(event);
          if (action === "awareness" && method === "POST")
            return postAwareness(event);
          if (action === "users" && method === "GET")
            return getActiveUsers(event);
          setResponseStatus(event, 404);
          return { error: "Not found" };
        });
      }),
    );

    // Auto-seed existing documents into collab state
    if (autoSeed) {
      const isJson = options.contentType === "json";
      const seedColumn = isJson
        ? options.jsonColumn || contentColumn
        : contentColumn;

      // Run in background so it doesn't block startup
      setTimeout(async () => {
        try {
          const client = getDbExec();
          const { rows } = await client.execute(
            `SELECT ${idColumn}, ${seedColumn} FROM ${table}`,
          );
          for (const row of rows) {
            const docId = row[idColumn] as string;
            const exists = await hasCollabState(docId);
            if (exists) continue;

            if (isJson) {
              const raw = (row[seedColumn] as string) ?? "{}";
              try {
                const parsed = JSON.parse(raw);
                const inferredType: "map" | "array" = Array.isArray(parsed)
                  ? "array"
                  : "map";
                await seedFromJson(docId, parsed, "data", inferredType);
              } catch {
                // Invalid JSON — skip
              }
            } else {
              const content = (row[seedColumn] as string) ?? "";
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
