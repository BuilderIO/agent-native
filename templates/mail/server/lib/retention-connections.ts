import { getDbExec } from "@agent-native/core/db";
import { isMissingOrganizationTableError } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";

import { getConnectedAccountsWithErrors } from "./google-auth.js";
import type { ConnectedAccountsResult } from "./inbox-retention.js";

function isMissingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isMissingOrganizationTableError(error) ||
    /does not exist|no such table|undefined_table/i.test(message)
  );
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
  try {
    orgIds = await readOrgIds(owner);
    hasManaged = await hasGmailWorkspaceConnection(owner, orgIds);
  } catch {
    return unverified("Could not read the owner's organizations.");
  }

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
  if (errors.length > 0)
    return { accounts: [...accounts], errors, verified: false };
  if (hasManaged && accounts.size === 0) {
    return unverified(
      "The owner has a Gmail workspace connection but the lookup found none.",
    );
  }
  return { accounts: [...accounts], errors: [], verified: true };
}
