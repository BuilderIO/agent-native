/**
 * Nitro plugin that mounts collaborative editing routes.
 *
 * Templates opt in with one line:
 * ```ts
 * // server/plugins/collab.ts
 * import { createCollabPlugin } from "@agent-native/core/server";
 * export default createCollabPlugin({
 *   table: "documents",
 *   contentColumn: "content",
 *   access: { mode: "resource", resourceType: "document" },
 * });
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

type CollabAwarenessScope = {
  owner?: string;
  orgId?: string;
  resourceType?: string;
  resourceId?: string;
};

export type CollabResourceIdResolver = (
  docId: string,
) => string | null | Promise<string | null>;

export type CollabAccess =
  | {
      mode: "resource";
      /** The shareable resource type registered via `registerShareableResource`. */
      resourceType: string;
      /** Map a collab document id to its parent shareable resource id. */
      resolveResourceId?: CollabResourceIdResolver;
    }
  | {
      /** Deliver collaboration events to every authenticated user. */
      mode: "all-authenticated";
    };

type NormalizedCollabAccess =
  | {
      mode: "resource";
      resourceType: string;
      resolveResourceId?: CollabResourceIdResolver;
    }
  | {
      mode: "all-authenticated";
      explicit: boolean;
    };

/**
 * Tables whose implicit all-authenticated warning has already been logged in
 * this process. Avoids duplicate warnings during hot reloads while still
 * identifying every affected table.
 */
const COLLAB_WARNING_TABLES_KEY =
  "__agentNativeImplicitCollabAccessWarningTables__";
const collabWarningGlobal = globalThis as typeof globalThis & {
  [COLLAB_WARNING_TABLES_KEY]?: Set<string>;
};
const _unscoped_warning_tables = (collabWarningGlobal[
  COLLAB_WARNING_TABLES_KEY
] ??= new Set<string>());

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
   * Access policy for collaboration routes and event delivery.
   * Use `resource` for registered shareable resources, or explicitly choose
   * `all-authenticated` for deployment-wide collaboration.
   */
  access?: CollabAccess;
  /**
   * The shareable resource type registered via `registerShareableResource`.
   * Used to enforce access checks on collab routes.
   * @deprecated Use `access: { mode: "resource", resourceType }`.
   */
  resourceType?: string;
  /**
   * Map the collab document id to the shareable resource id. Many templates
   * use route-specific collab ids (for example, one doc per slide inside a
   * deck) while sharing is enforced at the parent resource level.
   * @deprecated Use `access: { mode: "resource", resourceType, resolveResourceId }`.
   */
  resolveResourceId?: CollabResourceIdResolver;
  /**
   * Maximum allowed body size in bytes for write operations
   * (update/text/json/patch). Requests exceeding this are rejected with 413.
   * Default: 2097152 (2 MB).
   */
  maxPayloadBytes?: number;
}

export function normalizeCollabAccess(
  options: Pick<
    CollabPluginOptions,
    "access" | "resourceType" | "resolveResourceId"
  >,
): NormalizedCollabAccess {
  const hasLegacyAccess =
    options.resourceType !== undefined ||
    options.resolveResourceId !== undefined;

  if (options.access && hasLegacyAccess) {
    throw new Error(
      'createCollabPlugin cannot combine "access" with the deprecated root "resourceType" or "resolveResourceId" options. Move those fields into access.',
    );
  }

  if (options.access?.mode === "resource") {
    if (!options.access.resourceType.trim()) {
      throw new Error(
        'createCollabPlugin access mode "resource" requires a non-empty resourceType.',
      );
    }
    return options.access;
  }

  if (options.access?.mode === "all-authenticated") {
    return { mode: "all-authenticated", explicit: true };
  }

  if (options.access) {
    throw new Error(
      `createCollabPlugin received an unsupported access mode: ${String((options.access as { mode?: unknown }).mode)}`,
    );
  }

  if (options.resourceType !== undefined) {
    if (!options.resourceType.trim()) {
      throw new Error(
        'createCollabPlugin "resourceType" must be a non-empty string when provided.',
      );
    }
    return {
      mode: "resource",
      resourceType: options.resourceType,
      resolveResourceId: options.resolveResourceId,
    };
  }

  if (options.resolveResourceId !== undefined) {
    throw new Error(
      'createCollabPlugin "resolveResourceId" requires a non-empty "resourceType".',
    );
  }

  return { mode: "all-authenticated", explicit: false };
}

function warnForImplicitAllAuthenticatedAccess(table: string): void {
  if (_unscoped_warning_tables.has(table)) return;
  _unscoped_warning_tables.add(table);
  console.warn(
    `[collab] WARNING: createCollabPlugin for table "${table}" does not declare an access policy. ` +
      "Collab events will be delivered to ALL authenticated users on this deployment without document-level access scoping. " +
      'Use access: { mode: "resource", resourceType: "..." } for access-scoped delivery, ' +
      'or access: { mode: "all-authenticated" } to explicitly acknowledge deployment-wide delivery.',
  );
}

export function createCollabPlugin(
  options: CollabPluginOptions = {},
): NitroPluginDef {
  const normalizedAccess = normalizeCollabAccess(options);
  const {
    table = "documents",
    contentColumn = "content",
    idColumn = "id",
    autoSeed = true,
    maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  } = options;
  const resourceType =
    normalizedAccess.mode === "resource"
      ? normalizedAccess.resourceType
      : undefined;
  const resolveResourceId =
    normalizedAccess.mode === "resource"
      ? normalizedAccess.resolveResourceId
      : undefined;

  if (
    normalizedAccess.mode === "all-authenticated" &&
    !normalizedAccess.explicit
  ) {
    warnForImplicitAllAuthenticatedAccess(table);
  }

  return async (nitroApp: any) => {
    await awaitBootstrap(nitroApp);
    const P = FRAMEWORK_ROUTE_PREFIX;

    // Wire collab emitter → poll ring buffer so clients receive Yjs updates.
    // Security: when resourceType is configured, resolve the resource's
    // owner/org so getChangesSinceForUser can scope delivery. We use
    // resolveAccess to obtain the resource row — it already handles ownership,
    // visibility, and share rows. In addition to the owner/org tags we also
    // tag the event with `resourceType` + `resourceId` so the per-user
    // delivery filter (canSeeChangeForUser) can evaluate resource access
    // directly for non-owner sharees:
    //   • tag the event with the resource owner's email and org (owner-scoped)
    //     for backward compatibility with the conservative owner/org fast path.
    //   • ALSO tag with resourceType/resourceId so canSeeChangeForUser can run
    //     an access-aware (cached) check and push to explicit viewer+ sharees
    //     who don't match owner/org — instead of only degrading them to the
    //     poll fallback.
    // See also: SECURITY comment in poll.ts on canSeeChangeForUser.
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

        // Tag the event with owner/org (backward-compat fast path) AND with
        // resourceType/resourceId so canSeeChangeForUser can run an
        // access-aware check for non-owner sharees (see poll.ts).
        recordChange({
          ...event,
          ...(ownerEmail ? { owner: ownerEmail } : {}),
          ...(orgId ? { orgId } : {}),
          resourceType,
          resourceId,
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
              const access = await assertAccess(
                resourceType,
                resourceId,
                "editor",
              );
              const resource = access.resource as Record<string, unknown>;
              const awarenessScope: CollabAwarenessScope = {
                resourceType,
                resourceId,
                ...(typeof resource.ownerEmail === "string"
                  ? { owner: resource.ownerEmail }
                  : {}),
                ...(typeof resource.orgId === "string"
                  ? { orgId: resource.orgId }
                  : {}),
              };
              if (event.context) {
                event.context._collabAwarenessScope = awarenessScope;
              }
            } else {
              // resolveAccess returns null when no access; return 404 to avoid leaking existence
              const access = await resolveAccess(resourceType, resourceId);
              if (!access) {
                setResponseStatus(event, 404);
                return { error: "Not found" };
              }
              const resource = access.resource as Record<string, unknown>;
              const awarenessScope: CollabAwarenessScope = {
                resourceType,
                resourceId,
                ...(typeof resource.ownerEmail === "string"
                  ? { owner: resource.ownerEmail }
                  : {}),
                ...(typeof resource.orgId === "string"
                  ? { orgId: resource.orgId }
                  : {}),
              };
              if (event.context) {
                event.context._collabAwarenessScope = awarenessScope;
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
