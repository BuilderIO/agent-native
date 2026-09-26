import { randomUUID } from "node:crypto";

import { ensureAuditTables } from "../audit/store.js";
import type { DbExec } from "../db/client.js";
import {
  resolveIdentityColumns,
  sessionUserColumn,
  type IdentityColumn,
} from "./rekey.js";

export type OffboardMemberOptions = {
  transferTo: string;
  orgId?: string | null;
  actorEmail?: string;
};

export type OffboardMemberResult = {
  removedMemberships: number;
  removedAppRoles: number;
  transferredRows: number;
  revokedSessions: number;
};

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const ATTRIBUTION_COLUMNS = new Set([
  "created_by",
  "updated_by",
  "invited_by",
  "author_email",
  "actor_email",
]);

/**
 * What offboarding does to one registered column. App declarations state it;
 * framework entries derive it from their mode. `separate` columns have a
 * dedicated step in offboardMember (owner sweep, groups, OAuth, roles,
 * memberships) instead of the generic loop.
 */
function offboardAction(
  entry: IdentityColumn,
): "transfer" | "delete" | "retain" | "separate" {
  if (entry.column === "owner_email")
    return entry.offboard === "delete" ? "delete" : "separate";
  if (entry.offboard) return entry.offboard;
  if (
    entry.table === "user" ||
    entry.mode === "group-json" ||
    entry.mode === "unsupported-oauth" ||
    entry.table === "org_members" ||
    entry.table === "app_member_roles" ||
    entry.table === "workspace_connection_grants"
  )
    return "separate";
  if (ATTRIBUTION_COLUMNS.has(entry.column)) return "retain";
  switch (entry.mode) {
    case "user-share":
    case "viewer-consent":
    case "user-scope":
    case "secret-scope":
    case "state-session":
      return "delete";
    case "email-user-id":
    case "owner":
    case "typed-scope":
    case "custom-scope":
    case "scope-key":
      return "transfer";
    default:
      return "retain";
  }
}

/** Remove a member and transfer owned rows atomically within one app database. */
export async function offboardMember(
  db: DbExec,
  email: string,
  options: OffboardMemberOptions,
): Promise<OffboardMemberResult> {
  const oldEmail = email.trim().toLowerCase();
  const transferTo = options.transferTo.trim().toLowerCase();
  if (!oldEmail || !transferTo || oldEmail === transferTo)
    throw new Error(
      "A different successor is required before offboarding a member",
    );

  // Ensure the append-only audit table exists before starting the transaction.
  // The insert itself uses the transaction executor below, so the event commits
  // or rolls back with the membership and ownership changes.
  await ensureAuditTables();

  const run = async (tx: DbExec): Promise<OffboardMemberResult> => {
    const orgId = options.orgId?.trim() || null;
    const successor = await tx.execute({
      sql: orgId
        ? `SELECT 1 FROM org_members
             WHERE org_id = ? AND LOWER(email) = ?
               AND federation_removal_pending_at IS NULL
             LIMIT 1`
        : `SELECT 1 FROM "user" WHERE LOWER("email") = ? LIMIT 1`,
      args: orgId ? [orgId, transferTo] : [transferTo],
    });
    if (successor.rows.length === 0)
      throw new Error(
        orgId
          ? "Transfer target must be an active member of the organization"
          : "Transfer target does not exist",
      );

    // Validate the complete identity surface before any destructive query.
    // Reusing the rekey guard keeps offboarding from silently skipping a new
    // identity-bearing column and leaving a partial transfer behind.
    const schema = await tx.execute({
      sql: `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, column_name`,
    });
    const identityColumns = resolveIdentityColumns(
      schema.rows as Array<Record<string, unknown>>,
    );
    const tableColumns = new Map<string, Set<string>>();
    for (const row of schema.rows) {
      const table = String(row.table_name ?? "");
      const column = String(row.column_name ?? "");
      if (!table || !column) continue;
      const columns = tableColumns.get(table) ?? new Set<string>();
      columns.add(column);
      tableColumns.set(table, columns);
    }

    // A member removal scoped to one organization must not touch
    // account-owned rows from another organization (or personal mode).
    // Tables with no way to find the organization's rows are skipped (null).
    const orgPredicate = (
      entry: IdentityColumn,
      columns: Set<string>,
    ): { sql: string; args: unknown[] } | null => {
      if (!orgId) return { sql: "", args: [] };
      const scope = entry.orgScope;
      if (!scope)
        return columns.has("org_id")
          ? { sql: ` AND "org_id" = ?`, args: [orgId] }
          : null;
      if (!columns.has(scope.column))
        throw new Error(
          `${entry.table}.${scope.column} is missing; refusing an offboard that cannot be limited to the organization.`,
        );
      if (!("references" in scope))
        return { sql: ` AND ${quote(scope.column)} = ?`, args: [orgId] };
      const { table, column, orgColumn } = scope.references;
      const referenced = tableColumns.get(table);
      if (!referenced?.has(column) || !referenced.has(orgColumn))
        throw new Error(
          `${table}.${column}/${orgColumn} is missing; refusing an offboard that cannot be limited to the organization.`,
        );
      return {
        sql: ` AND ${quote(scope.column)} IN (SELECT ${quote(column)} FROM ${quote(table)} WHERE ${quote(orgColumn)} = ?)`,
        args: [orgId],
      };
    };

    // Grants are revocations, not ownership that should follow the successor.
    // They must be removed before the owner_email transfer below; otherwise a
    // grant owned by the departing member but created by somebody else would
    // be rewritten to the successor and escape the old-owner predicate.
    // Workspace connections migrate only in apps that mount them, so a
    // database without the table has no grants to revoke.
    if (tableColumns.has("workspace_connection_grants")) {
      await tx.execute({
        sql: `DELETE FROM workspace_connection_grants
            WHERE (LOWER(owner_email) = ? OR LOWER(granted_by_email) = ?)${
              orgId ? " AND org_id = ?" : ""
            }`,
        args: orgId ? [oldEmail, oldEmail, orgId] : [oldEmail, oldEmail],
      });
    }

    // The registry is shared with identity rekey. The information_schema
    // sweep retains the extension escape hatch used by rekey for app-owned
    // owner_email tables.
    const ownerEntries = new Map<string, IdentityColumn>();
    for (const entry of identityColumns) {
      if (entry.column === "owner_email") ownerEntries.set(entry.table, entry);
    }
    for (const [table, columns] of tableColumns) {
      if (columns.has("owner_email") && !ownerEntries.has(table)) {
        ownerEntries.set(table, { table, column: "owner_email" });
      }
    }
    let transferredRows = 0;
    for (const [table, entry] of ownerEntries) {
      if (
        !/^[A-Za-z0-9_]+$/.test(table) ||
        table === "agent_audit_log" ||
        table === "tool_history" ||
        table === "workspace_connection_grants" ||
        (entry.offboard && entry.offboard !== "transfer")
      )
        continue;
      const columns = tableColumns.get(table) ?? new Set<string>();
      if (!columns.has(entry.column)) continue;
      const scope = orgPredicate(entry, columns);
      if (!scope) continue;
      const result = await tx.execute({
        sql: `UPDATE ${quote(table)} SET ${quote(entry.column)} = ? WHERE LOWER("owner_email") = ?${scope.sql}`,
        args: [transferTo, oldEmail, ...scope.args],
      });
      transferredRows += result.rowsAffected;
    }

    const cleanupCounts: Record<string, number> = {};
    const hasGroups = tableColumns.get("workspace_user_groups") ?? new Set();
    if (
      hasGroups.has("id") &&
      hasGroups.has("member_emails_json") &&
      (!orgId || hasGroups.has("org_id"))
    ) {
      const groupRows = await tx.execute({
        sql: `SELECT "id", "member_emails_json" FROM workspace_user_groups${
          orgId && hasGroups.has("org_id") ? ` WHERE "org_id" = ?` : ""
        }`,
        args: orgId && hasGroups.has("org_id") ? [orgId] : [],
      });
      for (const row of groupRows.rows) {
        let members: unknown;
        try {
          members = JSON.parse(String(row.member_emails_json ?? "[]"));
        } catch {
          throw new Error(
            `Invalid workspace_user_groups.member_emails_json for ${String(row.id)}`,
          );
        }
        if (
          !Array.isArray(members) ||
          members.some((member) => typeof member !== "string")
        ) {
          throw new Error(
            `Unexpected workspace_user_groups.member_emails_json for ${String(row.id)}`,
          );
        }
        const next = members.filter(
          (member) => member.toLowerCase() !== oldEmail,
        );
        if (next.length !== members.length) {
          await tx.execute({
            sql: `UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = ?`,
            args: [JSON.stringify(next), row.id],
          });
        }
      }
    }

    for (const entry of identityColumns) {
      const columns = tableColumns.get(entry.table);
      if (!columns?.has(entry.column)) continue;
      const action = offboardAction(entry);
      if (action === "retain" || action === "separate") continue;
      const scope = orgPredicate(entry, columns);
      if (!scope) continue;
      const column = quote(entry.column);
      let result: { rowsAffected: number };
      if (action === "delete") {
        const match =
          entry.mode === "user-share" && columns.has("principal_type")
            ? {
                sql: `LOWER(${column}) = ? AND principal_type = 'user'`,
                args: [oldEmail],
              }
            : entry.mode === "user-scope"
              ? {
                  sql: `LOWER("scope") = 'user' AND LOWER(${column}) = ?`,
                  args: [oldEmail],
                }
              : entry.mode === "secret-scope"
                ? {
                    sql: `LOWER("secret_scope") = 'user' AND LOWER(${column}) IN (?, ?)`,
                    args: [oldEmail, `user:${oldEmail}`],
                  }
                : { sql: `LOWER(${column}) = ?`, args: [oldEmail] };
        result = await tx.execute({
          sql: `DELETE FROM ${quote(entry.table)} WHERE ${match.sql}${scope.sql}`,
          args: [...match.args, ...scope.args],
        });
      } else if (
        entry.mode === "owner" ||
        entry.mode === "typed-scope" ||
        entry.mode === "custom-scope" ||
        entry.mode === "scope-key"
      ) {
        const scopePredicate =
          entry.mode === "typed-scope"
            ? `LOWER("scope_type") = 'user' AND `
            : entry.mode === "custom-scope"
              ? `LOWER("scope") = 'user' AND `
              : "";
        result = await tx.execute({
          sql: `UPDATE ${quote(entry.table)}
                SET ${column} = CASE
                  WHEN LOWER(${column}) = ? THEN ?
                  ELSE 'user:' || ?
                END
                WHERE ${scopePredicate}(LOWER(${column}) = ? OR LOWER(${column}) = ?)${scope.sql}`,
          args: [
            oldEmail,
            transferTo,
            transferTo,
            oldEmail,
            `user:${oldEmail}`,
            ...scope.args,
          ],
        });
        transferredRows += result.rowsAffected;
      } else {
        result = await tx.execute({
          sql: `UPDATE ${quote(entry.table)} SET ${column} = ?
                WHERE LOWER(${column}) = ?${scope.sql}`,
          args: [transferTo, oldEmail, ...scope.args],
        });
        transferredRows += result.rowsAffected;
      }
      if (result.rowsAffected > 0) {
        cleanupCounts[`${entry.table}.${entry.column}`] = result.rowsAffected;
      }
    }

    const oauthColumns = tableColumns.get("oauth_tokens");
    if (!orgId && oauthColumns?.has("owner")) {
      const revoked = await tx.execute({
        sql: `DELETE FROM oauth_tokens
              WHERE LOWER(owner) = ? OR LOWER(owner) = ?`,
        args: [oldEmail, `user:${oldEmail}`],
      });
      if (revoked.rowsAffected > 0)
        cleanupCounts["oauth_tokens.owner"] = revoked.rowsAffected;
    }
    const roles = tableColumns.has("app_member_roles")
      ? await tx.execute({
          sql: `DELETE FROM app_member_roles WHERE LOWER(email) = ?${
            orgId ? " AND org_id = ?" : ""
          }`,
          args: orgId ? [oldEmail, orgId] : [oldEmail],
        })
      : { rowsAffected: 0 };
    let revokeSessions = true;
    if (orgId) {
      const remainingMemberships = await tx.execute({
        sql: `SELECT COUNT(*) AS count FROM org_members
              WHERE LOWER(email) = ? AND org_id <> ?
                AND federation_removal_pending_at IS NULL`,
        args: [oldEmail, orgId],
      });
      revokeSessions =
        Number((remainingMemberships.rows[0] as any)?.count ?? 0) === 0;
    }
    const sessionUser = sessionUserColumn(
      tableColumns.get("session") ?? new Set(),
    );
    const sessions =
      revokeSessions && sessionUser
        ? await tx.execute({
            sql: `DELETE FROM "session" WHERE ${quote(sessionUser)} IN
                (SELECT id FROM "user" WHERE LOWER("email") = ?)`,
            args: [oldEmail],
          })
        : { rowsAffected: 0 };
    // Delete the membership after all scoped ownership, role, and session
    // cleanup has succeeded. This keeps a retryable membership marker until
    // the last destructive step in the transaction.
    const memberships = await tx.execute({
      sql: `DELETE FROM org_members WHERE LOWER(email) = ?${
        orgId ? " AND org_id = ?" : ""
      }`,
      args: orgId ? [oldEmail, orgId] : [oldEmail],
    });
    const counts = {
      removedMemberships: memberships.rowsAffected,
      removedAppRoles: roles.rowsAffected,
      transferredRows,
      revokedSessions: sessions.rowsAffected,
    };
    await tx.execute({
      sql: `INSERT INTO agent_audit_log
        (id, created_at, action, caller, actor_kind, actor_email, org_id,
         target_type, target_id, status, summary, input, owner_email, visibility)
        VALUES (?, ?, 'org.member.offboarded', ?, ?, ?, ?,
                'identity', ?, 'success', ?, ?, ?, 'org')`,
      args: [
        randomUUID(),
        Date.now(),
        options.actorEmail ?? "system",
        options.actorEmail ? "user" : "system",
        options.actorEmail ?? null,
        orgId,
        oldEmail,
        `Offboarded ${oldEmail} and transferred ownership to ${transferTo}.`,
        JSON.stringify({ oldEmail, transferTo, counts, cleanupCounts }),
        transferTo,
      ],
    });
    return counts;
  };
  return db.transaction ? db.transaction(run) : run(db);
}
