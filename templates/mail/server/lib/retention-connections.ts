import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

import { getConnectedAccountsWithErrors } from "./google-auth.js";
import type { ConnectedAccountsResult } from "./inbox-retention.js";

// Only Postgres' undefined-table error (SQLSTATE 42P01, or its exact relation
// message when the driver drops the code) means "this deployment has no such
// table". A missing column or any other schema error is not absence: it fails
// closed as an unverified lookup.
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (typeof code === "string") return code === "42P01";
  const message = error instanceof Error ? error.message.trim() : "";
  return /^relation "[^"]+" does not exist$/i.test(message);
}

// Changes whenever the owner reconnects, disconnects or edits a Gmail
// connection: row counts and newest update stamps of their OAuth grants and of
// the workspace Gmail connections in their scopes.
async function readConnectionFingerprint(
  owner: string,
  orgIds: readonly string[],
): Promise<string> {
  // Membership is part of the fingerprint: joining an org adds a scope in which
  // a managed connection could now resolve.
  const parts: string[] = [`orgs=${[...orgIds].sort().join(",")}`];
  const read = async (sql: string, args: unknown[]) => {
    try {
      const { rows } = await getDbExec().execute({ sql, args });
      const row = (rows as any[])[0] ?? {};
      parts.push(`${row.n ?? 0}/${row.u ?? 0}/${row.r ?? 0}`);
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      parts.push("none");
    }
  };
  await read(
    `SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS u, COALESCE(MAX(revision), 0) AS r
      FROM public.oauth_tokens WHERE provider = 'google' AND LOWER(owner) = $1`,
    [owner],
  );
  const placeholders = orgIds.map((_, index) => `$${index + 2}`);
  await read(
    `SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS u, 0 AS r
      FROM public.workspace_connections
      WHERE provider = 'gmail'
        AND (LOWER(owner_email) = $1${
          placeholders.length > 0
            ? ` OR org_id IN (${placeholders.join(", ")})`
            : ""
        })`,
    [owner, ...orgIds],
  );
  await read(
    `SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS u, 0 AS r
      FROM public.workspace_connection_grants
      WHERE provider = 'gmail'
        AND (LOWER(owner_email) = $1${
          placeholders.length > 0
            ? ` OR org_id IN (${placeholders.join(", ")})`
            : ""
        })`,
    [owner, ...orgIds],
  );
  return parts.join("|");
}

// Orgs the owner belongs to. A missing org table means the deployment has no
// orgs; any other failure propagates so the lookup is reported unverified.
async function readOrgIds(owner: string): Promise<string[]> {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT org_id FROM org_members WHERE LOWER(email) = $1`,
      args: [owner],
    });
    return (rows as any[]).map((row) => String(row.org_id));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

// Whether the owner has a Gmail workspace connection in their own scope or any
// of their orgs, whatever its status. Only used to refuse an empty answer.
async function hasGmailWorkspaceConnection(
  owner: string,
  orgIds: readonly string[],
): Promise<boolean> {
  const placeholders = orgIds.map((_, index) => `$${index + 2}`);
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT 1 FROM public.workspace_connections
        WHERE provider = 'gmail'
          AND (LOWER(owner_email) = $1${
            placeholders.length > 0
              ? ` OR org_id IN (${placeholders.join(", ")})`
              : ""
          })
        LIMIT 1`,
      args: [owner, ...orgIds],
    });
    return rows.length > 0;
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

/**
 * The connected-account lookup retention relies on before it deletes anything.
 * A cron sweep has no org in its request context, and a managed workspace
 * connection only resolves inside the org that owns it, so the lookup runs once
 * in the owner's personal scope and once per org they belong to. It reports
 * `verified: true` only if every one of those lookups ran cleanly, and never
 * when an owner with a Gmail workspace connection gets an empty answer.
 */
export async function resolveConnectedAccountsForRetention(
  ownerEmail: string,
): Promise<ConnectedAccountsResult> {
  const owner = ownerEmail.trim().toLowerCase();
  const unverified = (error: string): ConnectedAccountsResult => ({
    accounts: [],
    errors: [{ email: "workspace", error }],
    verified: false,
  });

  let orgIds: string[];
  let hasManaged: boolean;
  let fingerprint: string;
  try {
    orgIds = await readOrgIds(owner);
    hasManaged = await hasGmailWorkspaceConnection(owner, orgIds);
    // Taken before the lookup, so any change after it shows at the clear.
    fingerprint = await readConnectionFingerprint(owner, orgIds);
  } catch {
    return unverified("Could not read the owner's organizations.");
  }
  // Re-checked inside the destructive transaction: a reconnect since the
  // lookup (or a failure to tell) aborts the clear.
  const stillCurrent = async () => {
    try {
      // Membership is re-read fresh, not taken from the lookup.
      const currentOrgIds = await readOrgIds(owner);
      return (
        (await readConnectionFingerprint(owner, currentOrgIds)) === fingerprint
      );
    } catch (error) {
      // Fail closed: not being able to tell counts as changed, so no clear.
      console.warn("[inbox-retention] connection re-check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const accounts = new Set<string>();
  const errors: ConnectedAccountsResult["errors"] = [];
  for (const orgId of [undefined, ...orgIds]) {
    try {
      const result = await runWithRequestContext(
        { userEmail: owner, ...(orgId ? { orgId } : {}) },
        () => getConnectedAccountsWithErrors(owner),
      );
      for (const email of result.accounts) accounts.add(email.toLowerCase());
      errors.push(...result.errors);
    } catch {
      return unverified("The connected-account lookup failed.");
    }
  }
  if (errors.length > 0) {
    return { accounts: [...accounts], errors, verified: false };
  }
  if (hasManaged && accounts.size === 0) {
    return unverified(
      "The owner has a Gmail workspace connection but the lookup found none.",
    );
  }
  return { accounts: [...accounts], errors: [], verified: true, stillCurrent };
}
