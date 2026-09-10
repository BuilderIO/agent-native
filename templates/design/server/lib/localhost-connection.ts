/**
 * Server-side helpers for localhost design connections: the org scope every
 * query against `design_localhost_connections` must use, and a classified
 * resolver for the bridge transport.
 *
 * Scope
 * =====
 * Connection rows are keyed by (ownerEmail, orgId). `getRequestOrgId()` is
 * undefined outside a request store — `pnpm action connect-localhost`, cron,
 * any CLI caller — and is also null for a request whose org membership read
 * failed, so those callers wrote and read under a different scope than the same
 * user's browser session: the connection rendered in the UI and every
 * server-side read of it missed. Resolve the scope through
 * `resolveLocalhostConnectionScope()` rather than reading the request org
 * directly, so both sides land on the same partition.
 *
 * Errors
 * ======
 * Every miss is classified and thrown with a 4xx `statusCode`, because the
 * action HTTP surface echoes a message only for explicit client errors — an
 * unclassified throw reaches the browser as `{"error":"Internal server error"}`
 * with the real cause server-log-only. Messages name the connection and the
 * fix; the bridge token is never echoed.
 */

import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const CONNECT_HINT = "npx @agent-native/core@latest design connect";

export interface LocalhostConnectionScope {
  ownerEmail: string;
  orgId: string | null;
}

/** Owner + org partition for connection and write-grant rows. */
export async function resolveLocalhostConnectionScope(): Promise<LocalhostConnectionScope> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const requestOrgId = getRequestOrgId();
  return {
    ownerEmail,
    // resolveOrgIdForEmail honors an explicit Personal selection, so this
    // cannot promote a caller into an org they left.
    orgId: requestOrgId ?? (await resolveOrgIdForEmail(ownerEmail)),
  };
}

export type LocalhostConnectionErrorCode =
  | "connection-not-found"
  | "connection-scope-mismatch"
  | "bridge-not-running"
  | "bridge-token-missing"
  | "bridge-unreachable"
  | "bridge-auth-rejected"
  | "bridge-request-failed";

export class LocalhostConnectionError extends Error {
  readonly errorCode: LocalhostConnectionErrorCode;
  readonly statusCode: number;

  constructor(
    errorCode: LocalhostConnectionErrorCode,
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "LocalhostConnectionError";
    this.errorCode = errorCode;
    this.statusCode = statusCode;
  }
}

export interface LocalhostBridgeConnection {
  bridgeUrl: string;
  bridgeToken: string | null;
  rootPath: string | null;
}

function describeScope(orgId: string | null): string {
  return orgId ? "an organization workspace" : "the personal workspace";
}

/**
 * Load the bridge transport for one connection in the caller's scope.
 *
 * Throws a classified `LocalhostConnectionError` instead of returning a
 * partial row: "invisible in this scope", "never existed", and "bridge not
 * running" have different fixes, and collapsing them into one miss is what
 * made this surface as an opaque 500.
 */
export async function resolveLocalhostBridgeConnection(args: {
  connectionId: string;
  ownerEmail: string;
  orgId: string | null;
}): Promise<LocalhostBridgeConnection> {
  const { connectionId, ownerEmail, orgId } = args;
  const db = getDb();
  const [connection] = await db
    .select({
      bridgeUrl: schema.designLocalhostConnections.bridgeUrl,
      bridgeToken: schema.designLocalhostConnections.bridgeToken,
      rootPath: schema.designLocalhostConnections.rootPath,
    })
    .from(schema.designLocalhostConnections)
    .where(
      and(
        eq(schema.designLocalhostConnections.id, connectionId),
        eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
        orgId
          ? eq(schema.designLocalhostConnections.orgId, orgId)
          : isNull(schema.designLocalhostConnections.orgId),
      ),
    )
    .limit(1);

  if (!connection) {
    const [outOfScope] = await db
      .select({ orgId: schema.designLocalhostConnections.orgId })
      .from(schema.designLocalhostConnections)
      .where(
        and(
          eq(schema.designLocalhostConnections.id, connectionId),
          eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (outOfScope) {
      throw new LocalhostConnectionError(
        "connection-scope-mismatch",
        `Local connection "${connectionId}" is registered in ` +
          `${describeScope(outOfScope.orgId ?? null)} but this request runs in ` +
          `${describeScope(orgId)}, so it cannot be read back. Reconnect the ` +
          `local app from this workspace (\`${CONNECT_HINT}\`) and retry.`,
        409,
      );
    }

    throw new LocalhostConnectionError(
      "connection-not-found",
      `No local connection "${connectionId}" for this account. Connect the ` +
        `local app first (\`${CONNECT_HINT}\`), then retry.`,
      404,
    );
  }

  if (!connection.bridgeUrl) {
    throw new LocalhostConnectionError(
      "bridge-not-running",
      `Local connection "${connectionId}" has no bridge URL — the design ` +
        `bridge is not running for it. Start it with \`${CONNECT_HINT}\` and retry.`,
      424,
    );
  }

  return connection as LocalhostBridgeConnection;
}

/**
 * POST one bridge operation. A dead bridge rejects `fetch` with a bare
 * TypeError, which is unclassified and therefore reaches the client as a
 * generic 500 — the same opaque failure a missing connection row used to be.
 */
export async function fetchLocalhostBridge(args: {
  bridgeUrl: string;
  operation: string;
  bridgeToken: string;
  body: unknown;
}): Promise<Response> {
  const { bridgeUrl, operation, bridgeToken, body } = args;
  try {
    return await fetch(`${bridgeUrl}/${operation}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": bridgeToken,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new LocalhostConnectionError(
      "bridge-unreachable",
      `Could not reach the design bridge at ${bridgeUrl} for ${operation} ` +
        `(${cause instanceof Error ? cause.message : String(cause)}). It is ` +
        `registered but not accepting connections — restart it with ` +
        `\`${CONNECT_HINT}\` and retry.`,
      424,
    );
  }
}

/**
 * Classify a non-2xx bridge response. 401/403 means the bridge rejected the
 * token: every bridge start mints a fresh one, so a restart leaves the stored
 * token stale while the connection row still looks healthy.
 */
export function localhostBridgeRequestError(
  operation: string,
  status: number,
  errText: string,
): LocalhostConnectionError {
  if (status === 401 || status === 403) {
    return new LocalhostConnectionError(
      "bridge-auth-rejected",
      `The design bridge rejected authentication for ${operation} (${status}). ` +
        "The stored bridge token is stale — each bridge start mints a fresh " +
        `token, so reconnect with \`${CONNECT_HINT}\` (and re-grant write ` +
        "consent if you were writing), then retry.",
      409,
    );
  }
  return new LocalhostConnectionError(
    "bridge-request-failed",
    `Bridge ${operation} failed (${status}): ${errText}`,
    424,
  );
}

/** Bridge token for callers that have no other source for one. */
export function requireLocalhostBridgeToken(
  connectionId: string,
  bridgeToken: string | null,
): string {
  if (!bridgeToken) {
    throw new LocalhostConnectionError(
      "bridge-token-missing",
      `Local connection "${connectionId}" has no bridge token. Reconnect the ` +
        `local app (\`${CONNECT_HINT}\`) and retry.`,
      424,
    );
  }
  return bridgeToken;
}
