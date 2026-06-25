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

import { postAwareness, getActiveUsers } from "../collab/awareness.js";
import { getCollabEmitter } from "../collab/emitter.js";
import {
  getCollabState,
  postCollabUpdate,
  postCollabText,
  postCollabSearchReplace,
} from "../collab/routes.js";
import { hasCollabState } from "../collab/storage.js";
import {
  postCollabJson,
  getCollabJson,
  postCollabPatch,
} from "../collab/struct-routes.js";
import { seedFromText, seedFromJson } from "../collab/ydoc-manager.js";
import { getDbExec } from "../db/client.js";
import { getOrgContext } from "../org/context.js";
import { resolveAccess, assertAccess } from "../sharing/access.js";
import { getSession } from "./auth.js";
import { FRAMEWORK_ROUTE_PREFIX } from "./core-routes-plugin.js";
import { getH3App, awaitBootstrap } from "./framework-request-handler.js";
import { recordChange } from "./poll.js";
import { runWithRequestContext } from "./request-context.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/** Default maximum body size in bytes for collab write operations (2 MB). */
const DEFAULT_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Whether the no-resourceType warning has already been logged once per server
 * process. Avoids flooding logs on every request in templates that deliberately
 * have no sharing model.
 */
let _unscoped_warning_logged = false;

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
  /**
   * Maximum allowed body size in bytes for write operations
   * (update/text/json/patch). Requests exceeding this are rejected with 413.
   * Default: 2097152 (2 MB).
   */
  maxPayloadBytes?: number;
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
    maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  } = options;

  return async (nitroApp: any) => {
    await awaitBootstrap(nitroApp);
    const P = FRAMEWORK_ROUTE_PREFIX;

    // Wire collab emitter → poll ring buffer so clients receive Yjs updates.
    // Security: when resourceType is configured, resolve the resource's
    // owner/org so getChangesSinceForUser can scope delivery. We use
    // resolveAccess to obtain the resource row — it already handles ownership,
    // visibility, and share rows. Rather than trying to enumerate every sharee
    // (which would require querying the shares table for every update), the
    // conservative strategy is:
    //   • tag the event with the resource owner's email and org (owner-scoped).
    //   • non-owner sharees who have explicit viewer+ access will NOT receive
    //     the push event; they fall back to the state-vector catch-up via the
    //     poll loop.  This is safe (never delivers to someone without access)
    //     at the cost of sharees seeing slightly higher latency (state-vector
    //     fetch on the next poll cycle) rather than the push path.
    // See also: SECURITY comment in poll.ts on getChangesSinceForUser.
    if (!resourceType && !_unscoped_warning_logged) {
      _unscoped_warning_logged = true;
      console.warn(
        "[collab] WARNING: createCollabPlugin called without resourceType. " +
          "Collab events will be delivered to ALL authenticated users on this deployment " +
          "without document-level access scoping. Set resourceType to enable access-scoped delivery.",
      );
    }

    const collabEmitter = getCollabEmitter();
    collabEmitter.on("collab", async (event) => {
      if (!resourceType) {
        // No access model — broadcast to all authenticated users (no owner/orgId tag).
        recordChange(event);
        return;
      }

      // Resolve the resource to learn its owner/org so we can scope the event.
      const docId = event.docId as string | undefined;
      if (!docId) {
        recordChange(event);
        return;
      }

      try {
        const resourceId = resolveResourceId
          ? await resolveResourceId(docId)
          : docId;
        if (!resourceId) {
          // Cannot resolve resource — drop the event to avoid leaking to
          // unauthorized pollers. The client will catch up via state-vector.
          return;
        }

        // Load the resource row to get owner/org. resolveAccess fetches the
        // resource row internally; use getShareableResource to read it cheaply.
        const { requireShareableResource } =
          await import("../sharing/registry.js");
        const reg = requireShareableResource(resourceType);
        const db = reg.getDb() as any;
        const { eq } = await import("drizzle-orm");
        const [resource] = await db
          .select()
          .from(reg.resourceTable)
          .where(eq(reg.resourceTable.id, resourceId))
          .limit(1);

        if (!resource) {
          // Resource deleted — drop silently.
          return;
        }

        const ownerEmail =
          typeof resource.ownerEmail === "string"
            ? resource.ownerEmail
            : undefined;
        const orgId =
          typeof resource.orgId === "string" ? resource.orgId : undefined;

        // Tag the event with owner/org. Non-owner sharees fall back to poll;
        // this is acceptable (see comment above).
        recordChange({
          ...event,
          ...(ownerEmail ? { owner: ownerEmail } : {}),
          ...(orgId ? { orgId } : {}),
        });
      } catch {
        // If we fail to resolve the resource (DB not ready, etc.) we skip
        // the event rather than broadcasting it without scoping.
      }
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
          // Access check — require at least viewer for reads, editor for writes.
          // Awareness routes (POST awareness / GET users) require the same
          // level as other reads so that knowledge of who is editing a doc
          // doesn't leak to users without access.
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

          // Payload size limit for write operations
          const isWriteAction =
            (action === "update" && method === "POST") ||
            (action === "text" && method === "POST") ||
            (action === "search-replace" && method === "POST") ||
            (action === "json" && method === "POST") ||
            (action === "patch" && method === "POST");

          if (isWriteAction) {
            const contentLength = Number(
              event.headers?.get?.("content-length") ?? NaN,
            );
            if (!isNaN(contentLength) && contentLength > maxPayloadBytes) {
              setResponseStatus(event, 413);
              return {
                error: `Payload too large. Maximum is ${maxPayloadBytes} bytes.`,
              };
            }
            // Store limit in context so route handlers can enforce it on the
            // parsed body when content-length is absent or spoofed.
            if (event.context) {
              event.context._collabMaxPayloadBytes = maxPayloadBytes;
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
