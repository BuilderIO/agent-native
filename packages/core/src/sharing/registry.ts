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

const registry = new Map<string, ShareableResourceRegistration>();

export function registerShareableResource(
  entry: ShareableResourceRegistration,
): void {
  registry.set(entry.type, entry);
}

export function getShareableResource(
  type: string,
): ShareableResourceRegistration | undefined {
  return registry.get(type);
}

export function requireShareableResource(
  type: string,
): ShareableResourceRegistration {
  const entry = registry.get(type);
  if (!entry) {
    throw new Error(
      `Unknown shareable resource type: "${type}". Did you forget registerShareableResource()?`,
    );
  }
  return entry;
}

export function listShareableResources(): ShareableResourceRegistration[] {
  return Array.from(registry.values());
}
