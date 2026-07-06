/**
 * Registry of shareable resources.
 *
 * Each template registers its ownable resource(s) once on module load so the
 * framework-level share actions (`share-resource`, `list-resource-shares`,
 * etc.) can dispatch to the correct tables.
 *
 *   import { registerShareableResource } from "@agent-native/core/sharing";
 *   import * as schema from "./schema.js";
 *
 *   registerShareableResource({
 *     type: "document",
 *     resourceTable: schema.documents,
 *     sharesTable: schema.documentShares,
 *     displayName: "Document",
 *     titleColumn: "title",
 *   });
 */

export interface ShareableResourceRegistration {
  /** Stable identifier used across actions, UI, and analytics. e.g. "document". */
  type: string;
  /** Drizzle table for the parent resource (must have ownableColumns()). */
  resourceTable: any;
  /** Drizzle table produced by createSharesTable(). */
  sharesTable: any;
  /** Human-readable singular label shown in the share dialog. */
  displayName: string;
  /**
   * Column on the resource table that holds a human-readable title for
   * display in the share UI. Default: "title".
   */
  titleColumn?: string;
  /**
   * Optional app-relative path to this resource. Used by share notifications
   * when the caller does not pass a more specific resourceUrl.
   */
  getResourcePath?: (resource: any) => string | undefined;
  /**
   * Drizzle DB accessor from the template's server/db/index.ts. Required —
   * the framework-level share actions and access helpers call this to reach
   * the right DB instance (schema is template-specific).
   */
  getDb: () => any;
  /**
   * When `false`, `visibility: "public"` is rejected by `set-resource-visibility`,
   * and `accessFilter` / `resolveAccess` treat any stored public row as private
   * (defense in depth — only owner + explicit shares grant access).
   *
   * Use this for resources that execute code or expose privileged data and must
   * never be reachable by a random authenticated user. Extensions set this:
   * extension HTML runs inside an iframe that calls actions / DB / proxied APIs
   * as the *viewer*, so a public extension would be arbitrary code with the
   * viewer's credentials.
   *
   * Default: `true` (matches the historical behavior — most resources can be public).
   */
  allowPublic?: boolean;
  /**
   * Optional role granted by a public-by-link read. Most resources should omit
   * this so public visibility remains viewer-only. Use narrowly for local or
   * otherwise constrained resources where the resource owner intentionally wants
   * unauthenticated link holders to do more than view.
   */
  publicAccessRole?:
    | "viewer"
    | "editor"
    | "admin"
    | ((
        resource: any,
        ctx: { userEmail?: string; orgId?: string },
      ) =>
        | "viewer"
        | "editor"
        | "admin"
        | Promise<"viewer" | "editor" | "admin">);
  /**
   * When `true`, individual user shares (`principalType: "user"`) must target
   * an email that is already a member of the same org as the resource, OR has
   * a pending invitation to that org. Cross-org user shares are rejected.
   *
   * Pair with `allowPublic: false` for resources that need a hard "this org
   * only" trust boundary. Extensions set this so a malicious caller can't
   * widen reach by sharing a code-executing extension to an outsider email.
   *
   * Default: `false` (matches the historical behavior — any email can be granted).
   */
  requireOrgMemberForUserShares?: boolean;
  /**
   * Optional per-resource access-context adapter. Most resources should use the
   * request user/org unchanged. Templates with an intentional alternate local
   * identity can normalize here so the generic framework sharing actions and
   * access helpers stay in sync with template-owned actions.
   */
  resolveAccessContext?: (ctx: { userEmail?: string; orgId?: string }) => {
    userEmail?: string;
    orgId?: string;
  };
  /**
   * When true, direct ownership is recognized by owner_email regardless of the
   * caller's active org. Use this only for resource types where the template's
   * own actions already treat owner_email as the cross-org authority and list
   * views add their own org filters.
   *
   * Default: `false`.
   */
  ownerAccessIgnoresOrg?: boolean;
  /**
   * Optional external-agent read handoff. When set, the framework-level
   * `create-agent-resource-link` action can mint a short-lived, read-only
   * `agent_access` URL for this resource. The context endpoint is owned by the
   * template so it can expose the same intentionally shareable shape as the
   * public page, not a generic raw database row.
   */
  agentReadable?:
    | false
    | {
        /** Token scope. Include the app name to avoid cross-app collisions. */
        resourceKind: string;
        /** App-relative JSON endpoint that accepts `id` + `agent_access`. */
        getContextPath: (resource: any) => string | undefined;
        /** Optional override for the page URL. Defaults to getResourcePath. */
        getPagePath?: (resource: any) => string | undefined;
        /** Optional override for the default two-hour token lifetime. */
        ttlSeconds?: number;
      };
}

// Stash the registry on globalThis so it survives SSR bundle duplication.
// Vite SSR's `noExternal: /^(?!node:)/` policy means @agent-native/core gets
// inlined into every server bundle that imports it — and each bundle gets its
// own module-level state. A plain `new Map()` here would create one Map per
// bundle, so the template's `registerShareableResource()` (called from the
// Nitro plugin graph) wouldn't be visible to the framework's auto-mounted
// share-resource action (loaded via `import("../sharing/actions/...js")` in a
// different module instance). Using globalThis collapses them back to one Map.
const REGISTRY_KEY = "__agentNativeShareableResources__";
type RegistryStore = Map<string, ShareableResourceRegistration>;
const globalRegistry: { [K in typeof REGISTRY_KEY]?: RegistryStore } =
  globalThis as any;

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST === "1"
  );
}

function registrationCameFromTestFile(): boolean {
  const stack = new Error().stack ?? "";
  return /[./\\](?:[^/\\]+[.-])(?:test|spec)\.[cm]?[jt]sx?(?::\d+)?(?::\d+)?/.test(
    stack,
  );
}

function getRegistry(): RegistryStore {
  let r = globalRegistry[REGISTRY_KEY];
  if (!r) {
    r = new Map<string, ShareableResourceRegistration>();
    globalRegistry[REGISTRY_KEY] = r;
  }
  return r;
}

export function registerShareableResource(
  entry: ShareableResourceRegistration,
): void {
  if (!isTestRuntime() && registrationCameFromTestFile()) return;
  getRegistry().set(entry.type, entry);
}

export function getShareableResource(
  type: string,
): ShareableResourceRegistration | undefined {
  return getRegistry().get(type);
}

export function requireShareableResource(
  type: string,
): ShareableResourceRegistration {
  const reg = getRegistry();
  const entry = reg.get(type);
  if (!entry) {
    throw new Error(
      `Unknown shareable resource type: "${type}". Did you forget registerShareableResource()?`,
    );
  }
  return entry;
}

export function listShareableResources(): ShareableResourceRegistration[] {
  return Array.from(getRegistry().values());
}
