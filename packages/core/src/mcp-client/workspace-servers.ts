import crypto from "node:crypto";

import { getDbExec } from "../db/client.js";
import type { SecretScope } from "../secrets/register.js";
import { readAppSecret } from "../secrets/storage.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import type { McpHttpServerConfig, McpServerConfig } from "./config.js";
import {
  hashEmail,
  normalizeServerName,
  validateRemoteUrl,
} from "./remote-store.js";

const WORKSPACE_MCP_KIND = "mcp-server";
const WORKSPACE_MCP_PATH_PREFIX = "mcp-servers/";
const KEY_REFERENCE_REGEX = /\$\{keys\.([A-Za-z0-9_-]+)\}/g;

interface WorkspaceMcpResourceRow {
  id: string;
  owner_email: string;
  org_id: string | null;
  name: string;
  description: string | null;
  path: string;
  content: string;
  scope: string;
  updated_at: number;
  grant_id?: string | null;
  app_id?: string | null;
}

interface ParsedWorkspaceMcpServer {
  name: string;
  config: Record<string, unknown>;
}

function normalizeWorkspaceAppId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = trimmed.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(candidate)) return null;
  return candidate;
}

function currentWorkspaceAppId(explicit?: string | null): string | null {
  if (explicit !== undefined) return normalizeWorkspaceAppId(explicit);
  return (
    normalizeWorkspaceAppId(process.env.AGENT_NATIVE_WORKSPACE_APP_ID) ??
    normalizeWorkspaceAppId(process.env.APP_NAME) ??
    normalizeWorkspaceAppId(process.env.AGENT_APP) ??
    normalizeWorkspaceAppId(process.env.APP_BASE_PATH) ??
    normalizeWorkspaceAppId(process.env.VITE_APP_BASE_PATH)
  );
}

function sanitizeOrgId(orgId: string): string {
  return orgId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function resourceServerKey(row: WorkspaceMcpResourceRow, serverName: string) {
  const scopePrefix = row.org_id
    ? `org_${sanitizeOrgId(row.org_id)}`
    : `user_${hashEmail(row.owner_email)}`;
  const name = normalizeServerName(serverName) || "server";
  const discriminator = crypto
    .createHash("sha256")
    .update(`${row.id}:${serverName}`)
    .digest("hex")
    .slice(0, 8);
  return `${scopePrefix}_workspace-${name}-${discriminator}`;
}

function secretCandidates(row: WorkspaceMcpResourceRow): Array<{
  scope: SecretScope;
  scopeId: string;
}> {
  if (row.org_id) {
    return [
      { scope: "org", scopeId: row.org_id },
      { scope: "workspace", scopeId: row.org_id },
    ];
  }
  return [
    { scope: "user", scopeId: row.owner_email },
    { scope: "workspace", scopeId: `solo:${row.owner_email}` },
  ];
}

async function resolveKeyReferencesForRow(
  text: string,
  row: WorkspaceMcpResourceRow,
): Promise<string> {
  const matches = Array.from(text.matchAll(KEY_REFERENCE_REGEX));
  if (matches.length === 0) return text;

  const values = new Map<string, string>();
  for (const match of matches) {
    const key = match[1];
    if (values.has(key)) continue;
    let value: string | null = null;
    for (const ref of secretCandidates(row)) {
      const secret = await readAppSecret({ key, ...ref });
      if (secret) {
        value = secret.value;
        break;
      }
    }
    if (value === null) {
      throw new Error(
        `Referenced key "${key}" is not defined for this workspace MCP server scope.`,
      );
    }
    values.set(key, value);
  }

  return text.replace(KEY_REFERENCE_REGEX, (_match, key: string) => {
    const value = values.get(key);
    if (value === undefined) {
      throw new Error(`Referenced key "${key}" was not resolved.`);
    }
    return value;
  });
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function defaultNameFromPath(path: string): string {
  const file = path.split("/").pop() || "server";
  return file.replace(/\.json$/i, "") || "server";
}

function parseWorkspaceMcpServers(
  row: WorkspaceMcpResourceRow,
): ParsedWorkspaceMcpServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.content);
  } catch {
    throw new Error("Workspace MCP server resource must contain valid JSON.");
  }
  const record = objectRecord(parsed);
  if (!record) {
    throw new Error("Workspace MCP server resource must be a JSON object.");
  }

  const servers = objectRecord(record.servers);
  if (servers) {
    return Object.entries(servers)
      .map(([name, config]) => {
        const serverConfig = objectRecord(config);
        return serverConfig ? { name, config: serverConfig } : null;
      })
      .filter((entry): entry is ParsedWorkspaceMcpServer => !!entry);
  }

  const nestedServer = objectRecord(record.server);
  if (nestedServer) {
    return [
      {
        name:
          typeof record.name === "string"
            ? record.name
            : defaultNameFromPath(row.path),
        config: nestedServer,
      },
    ];
  }

  return [
    {
      name:
        typeof record.name === "string"
          ? record.name
          : defaultNameFromPath(row.path),
      config: record,
    },
  ];
}

async function normalizeWorkspaceMcpConfig(
  row: WorkspaceMcpResourceRow,
  parsed: ParsedWorkspaceMcpServer,
): Promise<McpHttpServerConfig | null> {
  const type = parsed.config.type;
  if (type && type !== "http") {
    throw new Error("Workspace MCP server resources only support HTTP MCP.");
  }
  const rawUrl = parsed.config.url;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("Workspace MCP server resource is missing a URL.");
  }
  const url = await resolveKeyReferencesForRow(rawUrl, row);
  const urlCheck = validateRemoteUrl(url);
  if (!urlCheck.ok) {
    throw new Error(
      urlCheck.error ?? "Workspace MCP server URL is not allowed.",
    );
  }

  const headersInput = objectRecord(parsed.config.headers);
  const headers: Record<string, string> = {};
  if (headersInput) {
    for (const [name, value] of Object.entries(headersInput)) {
      if (typeof value !== "string") continue;
      headers[name] = await resolveKeyReferencesForRow(value, row);
    }
  }

  const description =
    typeof parsed.config.description === "string"
      ? parsed.config.description
      : (row.description ?? undefined);

  return {
    type: "http",
    url: urlCheck.url!.toString(),
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    description,
  };
}

function isMissingWorkspaceResourceTable(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  return /workspace_resources|workspace_resource_grants|no such table|does not exist/i.test(
    message,
  );
}

async function selectWorkspaceMcpResourceRows(options?: {
  workspaceAppId?: string | null;
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<WorkspaceMcpResourceRow[]> {
  const appId = currentWorkspaceAppId(options?.workspaceAppId);
  const userEmail =
    options?.userEmail === undefined
      ? (getRequestUserEmail() ?? null)
      : options.userEmail;
  const orgId =
    options?.orgId === undefined ? (getRequestOrgId() ?? null) : options.orgId;
  const client = getDbExec();
  const allRows = await client.execute({
    sql: `
      SELECT
        wr.id,
        wr.owner_email,
        wr.org_id,
        wr.name,
        wr.description,
        wr.path,
        wr.content,
        wr.scope,
        wr.updated_at,
        NULL AS grant_id,
        NULL AS app_id
      FROM workspace_resources wr
      WHERE wr.kind = ?
        AND wr.scope = ?
        AND wr.path LIKE ?
        AND (
          (? IS NOT NULL AND wr.org_id = ?)
          OR (? IS NOT NULL AND wr.org_id IS NULL AND lower(wr.owner_email) = lower(?))
        )
    `,
    args: [
      WORKSPACE_MCP_KIND,
      "all",
      `${WORKSPACE_MCP_PATH_PREFIX}%`,
      orgId,
      orgId,
      userEmail,
      userEmail,
    ],
  });

  if (!appId) return allRows.rows as WorkspaceMcpResourceRow[];

  const selectedRows = await client.execute({
    sql: `
      SELECT
        wr.id,
        wr.owner_email,
        wr.org_id,
        wr.name,
        wr.description,
        wr.path,
        wr.content,
        wr.scope,
        wr.updated_at,
        wg.id AS grant_id,
        wg.app_id AS app_id
      FROM workspace_resources wr
      INNER JOIN workspace_resource_grants wg ON wg.resource_id = wr.id
      WHERE wr.kind = ?
        AND wr.scope = ?
        AND wr.path LIKE ?
        AND wg.status = ?
        AND wg.app_id = ?
        AND (
          (? IS NOT NULL AND wr.org_id = ?)
          OR (? IS NOT NULL AND wr.org_id IS NULL AND lower(wr.owner_email) = lower(?))
        )
        AND (
          (wr.org_id IS NOT NULL AND wg.org_id = wr.org_id)
          OR (wr.org_id IS NULL AND wg.org_id IS NULL AND wg.owner_email = wr.owner_email)
        )
    `,
    args: [
      WORKSPACE_MCP_KIND,
      "selected",
      `${WORKSPACE_MCP_PATH_PREFIX}%`,
      "active",
      appId,
      orgId,
      orgId,
      userEmail,
      userEmail,
    ],
  });

  return [
    ...(allRows.rows as WorkspaceMcpResourceRow[]),
    ...(selectedRows.rows as WorkspaceMcpResourceRow[]),
  ];
}

/**
 * Load Dispatch-managed workspace MCP server resources for this app.
 *
 * Resources live in Dispatch's `workspace_resources` table with
 * `kind = "mcp-server"` and paths under `mcp-servers/*.json`. All-app rows
 * are loaded everywhere; selected rows are loaded only when granted to the
 * current `AGENT_NATIVE_WORKSPACE_APP_ID`.
 */
export async function loadWorkspaceMcpServers(options?: {
  workspaceAppId?: string | null;
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<Record<string, McpServerConfig>> {
  let rows: WorkspaceMcpResourceRow[] = [];
  try {
    rows = await selectWorkspaceMcpResourceRows(options);
  } catch (error) {
    if (!isMissingWorkspaceResourceTable(error)) {
      console.warn(
        `[mcp-client] Failed to load workspace MCP server resources: ${
          (error as { message?: string })?.message ?? error
        }`,
      );
    }
    return {};
  }

  const servers: Record<string, McpServerConfig> = {};
  for (const row of rows) {
    try {
      for (const parsed of parseWorkspaceMcpServers(row)) {
        const config = await normalizeWorkspaceMcpConfig(row, parsed);
        if (!config) continue;
        servers[resourceServerKey(row, parsed.name)] = config;
      }
    } catch (error) {
      console.warn(
        `[mcp-client] Skipping workspace MCP server resource ${row.path}: ${
          (error as { message?: string })?.message ?? error
        }`,
      );
    }
  }

  return servers;
}
