import { randomUUID } from "node:crypto";

import { ensureAuditTables } from "../audit/store.js";
import type { DbExec } from "../db/client.js";
import {
  assertIdentityColumnRows,
  IDENTITY_REKEY_COLUMNS,
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

    const schema = await tx.execute({
      sql: `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, column_name`,
    });
    assertIdentityColumnRows(schema.rows as Array<Record<string, unknown>>);
    const tableColumns = new Map<string, Set<string>>();
    for (const row of schema.rows) {
      const table = String(row.table_name ?? "");
      const column = String(row.column_name ?? "");
      if (!table || !column) continue;
      const columns = tableColumns.get(table) ?? new Set<string>();
      columns.add(column);
      tableColumns.set(table, columns);
    }

    await tx.execute({
      sql: `DELETE FROM workspace_connection_grants
            WHERE (LOWER(owner_email) = ? OR LOWER(granted_by_email) = ?)${
              orgId ? " AND org_id = ?" : ""
            }`,
      args: orgId ? [oldEmail, oldEmail, orgId] : [oldEmail, oldEmail],
    });

    const ownerEntries = new Map<string, IdentityColumn>();
    for (const entry of IDENTITY_REKEY_COLUMNS) {
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
        table === "workspace_connection_grants"
      )
        continue;
      const columns = tableColumns.get(table) ?? new Set<string>();
      if (!columns.has(entry.column)) continue;
      const hasOrgId = columns.has("org_id");
      if (orgId && !hasOrgId) continue;
      const where =
        hasOrgId && orgId
          ? `LOWER("owner_email") = ? AND "org_id" = ?`
          : `LOWER("owner_email") = ?`;
      const args = hasOrgId && orgId ? [oldEmail, orgId] : [oldEmail];
      const result = await tx.execute({
        sql: `UPDATE ${quote(table)} SET ${quote(entry.column)} = ? WHERE ${where}`,
        args: [transferTo, oldEmail, ...args.slice(1)],
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

    for (const entry of IDENTITY_REKEY_COLUMNS) {
      const columns = tableColumns.get(entry.table);
      if (
        !columns?.has(entry.column) ||
        entry.table === "user" ||
        entry.column === "owner_email" ||
        entry.mode === "group-json" ||
        entry.mode === "unsupported-oauth" ||
        entry.table === "org_members" ||
        entry.table === "app_member_roles" ||
        entry.table === "workspace_connection_grants" ||
        [
          "created_by",
          "updated_by",
          "invited_by",
          "author_email",
          "actor_email",
        ].includes(entry.column)
      )
        continue;
      const hasOrgId = columns.has("org_id");
      if (orgId && !hasOrgId) continue;
      const scoped = hasOrgId && orgId ? ` AND "org_id" = ?` : "";
      const scopeArgs = hasOrgId && orgId ? [orgId] : [];
      let result: { rowsAffected: number } | undefined;
      if (entry.mode === "user-share" || entry.mode === "viewer-consent") {
        result = await tx.execute({
          sql: `DELETE FROM ${quote(entry.table)}
                WHERE LOWER(${quote(entry.column)}) = ?${
                  entry.mode === "user-share" && columns.has("principal_type")
                    ? ` AND principal_type = 'user'`
                    : ""
                }${scoped}`,
          args: [oldEmail, ...scopeArgs],
        });
      } else if (entry.mode === "user-scope") {
        result = await tx.execute({
          sql: `DELETE FROM ${quote(entry.table)}
                WHERE LOWER("scope") = 'user' AND LOWER(${quote(entry.column)}) = ?${scoped}`,
          args: [oldEmail, ...scopeArgs],
        });
      } else if (entry.mode === "secret-scope") {
        result = await tx.execute({
          sql: `DELETE FROM ${quote(entry.table)}
                WHERE LOWER("secret_scope") = 'user'
                  AND LOWER(${quote(entry.column)}) IN (?, ?)
                  ${scoped}`,
          args: [oldEmail, `user:${oldEmail}`, ...scopeArgs],
        });
      } else if (entry.mode === "state-session") {
        result = await tx.execute({
          sql: `DELETE FROM ${quote(entry.table)}
                WHERE LOWER(${quote(entry.column)}) = ?${scoped}`,
          args: [oldEmail, ...scopeArgs],
        });
      } else if (entry.mode === "email-user-id") {
        result = await tx.execute({
          sql: `UPDATE ${quote(entry.table)} SET ${quote(entry.column)} = ?
                WHERE LOWER(${quote(entry.column)}) = ?${scoped}`,
          args: [transferTo, oldEmail, ...scopeArgs],
        });
        transferredRows += result.rowsAffected;
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
                SET ${quote(entry.column)} = CASE
                  WHEN LOWER(${quote(entry.column)}) = ? THEN ?
                  ELSE 'user:' || ?
                END
                WHERE ${scopePredicate}(LOWER(${quote(entry.column)}) = ? OR LOWER(${quote(entry.column)}) = ?)${scoped}`,
          args: [
            oldEmail,
            transferTo,
            transferTo,
            oldEmail,
            `user:${oldEmail}`,
            ...scopeArgs,
          ],
        });
        transferredRows += result.rowsAffected;
      }
      if (result && result.rowsAffected > 0) {
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
    const roles = await tx.execute({
      sql: `DELETE FROM app_member_roles WHERE LOWER(email) = ?${
        orgId ? " AND org_id = ?" : ""
      }`,
      args: orgId ? [oldEmail, orgId] : [oldEmail],
    });
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
    const sessions = revokeSessions
      ? await tx.execute({
          sql: `DELETE FROM "session" WHERE "userId" IN
                (SELECT id FROM "user" WHERE LOWER("email") = ?)`,
          args: [oldEmail],
        })
      : { rowsAffected: 0 };
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
