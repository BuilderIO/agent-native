import { z } from "zod";

import {
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_DATA_SOURCE_NAME,
} from "../../shared/sample-data-contract.js";

/**
 * The connection entry shape the client renders, plus the one connection that is
 * not a warehouse at all: the bundled sample source. Kept in its own module so a
 * rule can be tested without opening a database or a credential store.
 */
export const dataConnectionOutput = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean(),
  isDraft: z.boolean(),
  isDemo: z.boolean().optional(),
  shared: z.boolean(),
  canQuery: z.string(),
  canView: z.string(),
  // Canonical effective AI policy for this connection (form/header/labels).
  aiUsage: z.enum(["included", "excluded"]),
  /**
   * The original marks a connection whose dbt metadata is configured with a
   * "(dbt)" badge in the connection header (tooltip "dbt metadata is configured",
   * placement bottom), so the flag travels with the connection.
   */
  hasDbtMetadata: z.boolean().default(false),
  requestId: z.string().optional(),
});

/**
 * The built-in sample source, presented as a connection.
 *
 * `browse-sample-data` already ships a read-only synthetic source, but the query
 * cell's picker only knew about warehouse connections, so the demo source could
 * not be selected and the first tutorial query had nothing to run on
 * (sprint-analytics-2#492). It is a real entry in the list, not a stub: queries
 * against this id are answered from the bundled sample tables.
 */
export function builtinSampleConnection() {
  return {
    id: SAMPLE_DATA_SOURCE_ID,
    name: SAMPLE_DATA_SOURCE_NAME,
    type: "sample",
    description:
      "Read-only sample data bundled with the app. No warehouse needed.",
    isDefault: false,
    isDraft: false,
    isDemo: true,
    shared: true,
    canQuery: "read",
    canView: "read",
    aiUsage: "included" as const,
  };
}

export function isBuiltinSampleConnection(
  connectionId: string | null | undefined,
): boolean {
  return connectionId === SAMPLE_DATA_SOURCE_ID;
}

/**
 * The connection header's dbt marker, exactly as the original renders it: a
 * "(dbt)" chip whose tooltip names what is configured, and nothing at all for a
 * connection without dbt metadata.
 */
export function connectionDbtBadge(
  connection: { hasDbtMetadata?: boolean } | null | undefined,
): { label: "(dbt)"; tooltip: string } | null {
  if (!connection?.hasDbtMetadata) return null;
  return { label: "(dbt)", tooltip: "dbt metadata is configured" };
}
