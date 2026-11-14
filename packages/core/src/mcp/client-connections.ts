import { z } from "zod";

import { getDbExec } from "../db/client.js";
import type { McpClientConnections } from "../shared/mcp-client-connections.js";
import {
  MCP_CONNECT_GUIDES,
  resolveMcpConnectGuideId,
} from "../shared/mcp-connect-content.js";
import { ensureConnectTables } from "./connect-store.js";
import { ensureOAuthTables } from "./oauth-store.js";
import {
  MCP_DIRECTORY_ROUTE_PREFIX,
  MCP_LEGACY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
} from "./route-paths.js";

const timestamp = z.coerce.number().int().nonnegative().safe().nullable();
const oauthRow = z.object({
  client_name: z.string().nullable(),
  active: z.boolean(),
  unknown: z.boolean(),
  last_used_at: timestamp,
});
const tokenRow = z.object({
  client_name: z.string().nullable(),
  active: z.boolean(),
  unknown: z.boolean(),
  last_used_at: timestamp,
});
const MAX_CONNECTIONS = 200;

export async function listMcpClientConnections({
  email,
  orgId,
  issuer,
}: {
  email: string;
  orgId: string | null;
  issuer: string;
}): Promise<McpClientConnections> {
  await Promise.all([ensureConnectTables(), ensureOAuthTables()]);
  const owner = email.trim().toLowerCase();
  const now = Date.now();
  const resources = [
    MCP_PUBLIC_ROUTE_PREFIX,
    MCP_LEGACY_ROUTE_PREFIX,
    MCP_DIRECTORY_ROUTE_PREFIX,
  ].map((path) => `${issuer.replace(/\/+$/, "")}${path}`);
  const db = getDbExec();
  const [oauth, tokens] = await Promise.all([
    db.execute({
      sql: `SELECT c.client_name,
        BOOL_OR(r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at > ?)
          AND COALESCE(LOWER(r.issued_for_email) = ?, FALSE)) AS active,
        BOOL_OR(r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at > ?)
          AND r.issued_for_email IS NULL) AS unknown,
        MAX(r.last_used_at) AS last_used_at
      FROM mcp_oauth_refresh_tokens r LEFT JOIN mcp_oauth_clients c ON c.client_id = r.client_id
      WHERE LOWER(r.owner_email) = ? AND r.org_id IS NOT DISTINCT FROM ?
        AND r.resource IN (?, ?, ?)
      GROUP BY r.client_id, c.client_name
      ORDER BY r.client_id LIMIT ?`,
      args: [now, owner, now, owner, orgId, ...resources, MAX_CONNECTIONS + 1],
    }),
    db.execute({
      sql: `SELECT client_name,
        COALESCE(BOOL_OR(revoked_at IS NULL AND expires_at > ? AND resource IS NOT NULL), FALSE) AS active,
        COALESCE(BOOL_OR(revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
          AND (expires_at IS NULL OR resource IS NULL)), FALSE) AS unknown,
        MAX(last_used_at) AS last_used_at
      FROM mcp_connect_tokens
      WHERE LOWER(owner_email) = ? AND org_id IS NOT DISTINCT FROM ? AND kind = 'personal'
        AND (resource IN (?, ?, ?) OR resource IS NULL)
      GROUP BY client_name ORDER BY client_name LIMIT ?`,
      args: [now, now, owner, orgId, ...resources, MAX_CONNECTIONS + 1],
    }),
  ]);
  if (
    oauth.rows.length > MAX_CONNECTIONS ||
    tokens.rows.length > MAX_CONNECTIONS
  )
    throw new Error(
      "MCP connection metadata exceeds the supported result limit.",
    );
  const summaries = new Map(
    MCP_CONNECT_GUIDES.map((guide) => [
      guide.id,
      {
        client: guide.id,
        status: "disconnected" as "connected" | "disconnected" | "unknown",
        lastUsedAt: null as number | null,
      },
    ]),
  );
  const add = (
    name: string | null,
    status: "connected" | "disconnected" | "unknown",
    lastUsedAt: number | null,
  ) => {
    const client = resolveMcpConnectGuideId(name || "other");
    const summary = summaries.get(client);
    if (!summary) throw new Error("Unknown MCP client group.");
    if (
      status === "connected" ||
      (status === "unknown" && summary.status !== "connected")
    )
      summary.status = status;
    if (
      lastUsedAt !== null &&
      (summary.lastUsedAt === null || lastUsedAt > summary.lastUsedAt)
    )
      summary.lastUsedAt = lastUsedAt;
  };
  for (const raw of oauth.rows) {
    const row = oauthRow.parse(raw);
    add(
      row.client_name,
      row.active ? "connected" : row.unknown ? "unknown" : "disconnected",
      row.last_used_at,
    );
  }
  for (const raw of tokens.rows) {
    const row = tokenRow.parse(raw);
    add(
      row.client_name,
      row.active ? "connected" : row.unknown ? "unknown" : "disconnected",
      row.last_used_at,
    );
  }
  return { connections: [...summaries.values()] };
}
