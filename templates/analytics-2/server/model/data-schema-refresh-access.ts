import { fail } from "@agent-native/core/action";
import type { WorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";

import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import { readBrowsableDataConnection } from "./data-connections.js";

/**
 * One canonical answer to "may this actor refresh this connection's schema?".
 * Both the permission read and the refresh itself resolve access here so they
 * can never disagree.
 *
 * This reads connection metadata only: no provider call and no credential or
 * vault resolution, so the answer never depends on the warehouse being up.
 */

type CurrentWorkspace = Awaited<ReturnType<typeof requireCurrentWorkspace>>;
type WorkspaceCapabilities = Awaited<
  ReturnType<typeof currentWorkspaceCapabilities>
>;

/** An unreadable lookup is a typed refusal, never `allowed: false`. */
export const SCHEMA_REFRESH_ACCESS_ERRORS = {
  data_schema_refresh_access_unavailable: {
    status: 503,
    message: "Refresh permission could not be read. Please try again.",
  },
} as const;

function accessUnavailable(): never {
  const entry =
    SCHEMA_REFRESH_ACCESS_ERRORS.data_schema_refresh_access_unavailable;
  return fail(entry.message, {
    statusCode: entry.status,
    errorCode: "data_schema_refresh_access_unavailable",
  });
}

/** Why the actor was refused. Internal only; never returned to a caller. */
export type SchemaRefreshDenial =
  | "workspace_capability"
  | "connection_inactive"
  | "admin_only";

export interface SchemaRefreshAccess {
  allowed: boolean;
  via?: "manager" | "connection";
  denial?: SchemaRefreshDenial;
}

export interface SchemaRefreshAccessResolution extends SchemaRefreshAccess {
  current: CurrentWorkspace;
  capabilities: WorkspaceCapabilities;
}

function isDraftOrDisabled(connection: WorkspaceConnectionForApp) {
  return connection.status !== "connected" || connection.config.draft === true;
}

/**
 * Managers pass whatever the connection-level flag says; everyone else also
 * needs that flag not disabled (absent means allowed). Every actor needs
 * workspace data access and a readable, active connection — the connection read
 * applies the same per-user grant filter that query execution uses, so it is the
 * canonical query-grant check.
 */
export async function resolveSchemaRefreshAccess(
  connectionId: string,
  resolved?: {
    current: CurrentWorkspace;
    capabilities: WorkspaceCapabilities;
  },
): Promise<SchemaRefreshAccessResolution> {
  const current = resolved?.current ?? (await requireCurrentWorkspace());
  const capabilities =
    resolved?.capabilities ?? (await currentWorkspaceCapabilities(current));
  if (!capabilities.allows("context-studio"))
    return {
      allowed: false,
      denial: "workspace_capability",
      current,
      capabilities,
    };

  let connection: WorkspaceConnectionForApp;
  try {
    connection = await readBrowsableDataConnection(connectionId);
  } catch (error) {
    const code = (error as { errorCode?: unknown } | null)?.errorCode;
    // A missing or unreadable connection keeps its real 404.
    if (code === "data_connection_not_found") throw error;
    return accessUnavailable();
  }

  if (isDraftOrDisabled(connection))
    return {
      allowed: false,
      denial: "connection_inactive",
      current,
      capabilities,
    };
  if (capabilities.isManagerOrAbove)
    return { allowed: true, via: "manager", current, capabilities };
  if (connection.config.canQueryCanRefreshSchema === false)
    return { allowed: false, denial: "admin_only", current, capabilities };
  return { allowed: true, via: "connection", current, capabilities };
}
