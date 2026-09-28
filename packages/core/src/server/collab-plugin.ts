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
import { getDbExec, withDbExec, type DbExec } from "../db/client.js";
import { getOrgContext } from "../org/context.js";
import { resolveAccess, assertAccess } from "../sharing/access.js";
import { getSession } from "./auth.js";
import { FRAMEWORK_ROUTE_PREFIX } from "./core-routes-plugin.js";
import { getH3App, awaitBootstrap } from "./framework-request-handler.js";
import { recordChange } from "./poll.js";
import { runWithRequestContext } from "./request-context.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

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
      resourceType: string;
      resolveResourceId?: CollabResourceIdResolver;
    }
  | {
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

const COLLAB_WARNING_TABLES_KEY =
  "__agentNativeImplicitCollabAccessWarningTables__";
const collabWarningGlobal = globalThis as typeof globalThis & {
  [COLLAB_WARNING_TABLES_KEY]?: Set<string>;
};
const _unscoped_warning_tables = (collabWarningGlobal[
  COLLAB_WARNING_TABLES_KEY
] ??= new Set<string>());

export interface CollabPluginOptions {
  table?: string;
  contentColumn?: string;
  idColumn?: string;
  autoSeed?: boolean;
  resolveCollabDocumentId?: (sourceId: string) => string;
  resolveSourceIdFromCollabDocumentId?: (docId: string) => string;
  onContentSync?: (docId: string, text: string) => Promise<void>;
  contentType?: "text" | "json";
  jsonColumn?: string;
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

export function createCollabSourceSeeder(options: {
  hasState: (docId: string) => Promise<boolean>;
  loadSource: (docId: string) => Promise<string | null>;
  seed: (docId: string, source: string, client?: DbExec) => Promise<void>;
  withLock?: (
    docId: string,
    run: (client?: DbExec) => Promise<void>,
  ) => Promise<void>;
}): (docId: string) => Promise<void> {
  const inFlight = new Map<string, Promise<void>>();

  return async (docId) => {
    const existing = inFlight.get(docId);
    if (existing) return existing;

    const seed = async (client?: DbExec) => {
      if (await options.hasState(docId)) return;
      const source = await options.loadSource(docId);
      if (source === null) return;
      if (client) {
        await options.seed(docId, source, client);
      } else {
        await options.seed(docId, source);
      }
    };
    const pending = (async () => {
      if (await options.hasState(docId)) return;
      if (options.withLock) {
        await options.withLock(docId, seed);
      } else {
        await seed();
      }
    })();
    inFlight.set(docId, pending);

    try {
      await pending;
    } finally {
      if (inFlight.get(docId) === pending) inFlight.delete(docId);
    }
  };
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
  const resolveSourceIdFromCollabDocumentId =
    options.resolveSourceIdFromCollabDocumentId ?? ((docId: string) => docId);
  const isJson = options.contentType === "json";
  const seedColumn = isJson
    ? options.jsonColumn || contentColumn
    : contentColumn;
  const legacyResolveCollabDocumentId = options.resolveCollabDocumentId;
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

  const ensureDocumentSeeded = autoSeed
    ? createCollabSourceSeeder({
        hasState: hasCollabState,
        loadSource: async (docId) => {
          const readSource = (
            row: Record<string, unknown>,
            sourceId: string,
          ): string => {
            const source = row[seedColumn];
            if (typeof source !== "string") {
              throw new Error(
                `[collab] ${table}.${seedColumn} for ${sourceId} is unreadable`,
              );
            }
            return source;
          };

          if (
            legacyResolveCollabDocumentId &&
            !options.resolveSourceIdFromCollabDocumentId
          ) {
            const { rows } = await getDbExec().execute({
              sql: `SELECT ${idColumn}, ${seedColumn} FROM ${table}`,
            });
            for (const row of rows as Record<string, unknown>[]) {
              const rawSourceId = row[idColumn];
              if (
                rawSourceId === null ||
                rawSourceId === undefined ||
                (typeof rawSourceId !== "string" &&
                  typeof rawSourceId !== "number" &&
                  typeof rawSourceId !== "bigint")
              ) {
                throw new Error(
                  `[collab] ${table}.${idColumn} for a legacy lazy seed is unreadable`,
                );
              }
              const sourceId = String(rawSourceId);
              if (!sourceId) {
                throw new Error(
                  `[collab] ${table}.${idColumn} for a legacy lazy seed is unreadable`,
                );
              }
              if (legacyResolveCollabDocumentId(sourceId) !== docId) continue;
              return readSource(row, sourceId);
            }
            return null;
          }

          const sourceId = resolveSourceIdFromCollabDocumentId(docId);
          const { rows } = await getDbExec().execute({
            sql: `SELECT ${seedColumn} FROM ${table} WHERE ${idColumn} = ?`,
            args: [sourceId],
          });
          if (rows.length === 0) return null;
          return readSource(rows[0] as Record<string, unknown>, sourceId);
        },
        seed: async (docId, source, client) => {
          if (!isJson) {
            if (client) {
              await seedFromText(docId, source, "content", client);
            } else {
              await seedFromText(docId, source);
            }
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(source);
          } catch (error) {
            throw new Error(
              `[collab] ${table}.${seedColumn} for ${docId} contains invalid JSON`,
              { cause: error },
            );
          }
          const type = Array.isArray(parsed) ? "array" : "map";
          if (client) {
            await seedFromJson(docId, parsed, "data", type, client);
          } else {
            await seedFromJson(docId, parsed, "data", type);
          }
        },
        withLock: async (docId, run) => {
          const client = getDbExec();
          if (typeof client.transaction !== "function") return run();
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const acquired = await client.transaction(async (tx) => {
              const { rows } = await tx.execute({
                sql: "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0)) AS acquired",
                args: [`${table}:${docId}`],
                timeoutMs: 1_000,
              });
              const result = rows[0]?.acquired;
              const acquired =
                result === true || result === "t"
                  ? true
                  : result === false || result === "f"
                    ? false
                    : null;
              if (acquired === null) {
                throw new Error(
                  `[collab] advisory lock result for ${docId} is unreadable`,
                );
              }
              if (!acquired) return false;
              await withDbExec(tx, () => run(tx));
              return true;
            });
            if (acquired) return;

            await new Promise<void>((resolve) =>
              setTimeout(resolve, Math.min(200, 25 * (attempt + 1))),
            );
          }
          throw new Error(
            `[collab] timed out waiting to seed ${docId}; retry the request`,
          );
        },
      })
    : async () => {};

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
        recordChange(event);
        return;
      }

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
          return;
        }

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
          return;
        }

        const ownerEmail =
          typeof resource.ownerEmail === "string"
            ? resource.ownerEmail
            : undefined;
        const orgId =
          typeof resource.orgId === "string" ? resource.orgId : undefined;

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

        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "Authentication required" };
        }

        const orgCtx = await getOrgContext(event).catch(() => null);
        const userEmail = session.email;
        const orgId = orgCtx?.orgId ?? undefined;

        return runWithRequestContext({ userEmail, orgId }, async () => {
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
              const access = await assertAccess(
                resourceType,
                resourceId,
                "editor",
                undefined,
                { skipResourceBody: true },
              );
              const resource = access.resource;
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
              const access = await resolveAccess(
                resourceType,
                resourceId,
                undefined,
                { skipResourceBody: true },
              );
              if (!access) {
                setResponseStatus(event, 404);
                return { error: "Not found" };
              }
              const resource = access.resource;
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
            if (event.context) {
              event.context._collabMaxPayloadBytes = maxPayloadBytes;
            }
          }

          const needsSeed =
            (action === "state" && method === "GET") ||
            (action === "update" && method === "POST") ||
            (action === "text" && method === "POST") ||
            (action === "search-replace" && method === "POST") ||
            (action === "json" && (method === "GET" || method === "POST")) ||
            (action === "patch" && method === "POST");
          if (needsSeed) await ensureDocumentSeeded(docId);

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

    // Source rows are seeded lazily by the request path above. A cold-start
    // scan here stampedes serverless instances and does work for documents no
    // caller will ever open.
  };
}
