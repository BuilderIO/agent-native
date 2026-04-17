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
   * Drizzle DB accessor from the template's server/db/index.ts. Required —
   * the framework-level share actions and access helpers call this to reach
   * the right DB instance (schema is template-specific).
   */
  getDb: () => any;
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
