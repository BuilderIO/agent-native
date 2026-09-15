import { randomUUID } from "node:crypto";

import { ensureAuditTables } from "../audit/store.js";
import type { DbExec } from "../db/client.js";

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
    const successor = await tx.execute({
      sql: `SELECT 1 FROM "user" WHERE LOWER("email") = ? LIMIT 1`,
      args: [transferTo],
    });
    if (successor.rows.length === 0)
      throw new Error("Transfer target does not exist");

    const tables = await tx.execute({
      sql: `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'owner_email'
            ORDER BY table_name`,
    });
    let transferredRows = 0;
    const orgId = options.orgId?.trim() || null;
    for (const row of tables.rows) {
      const table = String(row.table_name ?? "");
      if (
        !/^[A-Za-z0-9_]+$/.test(table) ||
        table === "agent_audit_log" ||
        table === "tool_history"
      )
        continue;
      const columns = await tx.execute({
        sql: `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ?`,
        args: [table],
      });
      const hasOrgId = columns.rows.some(
        (column) => String(column.column_name ?? "") === "org_id",
      );
      const where =
        hasOrgId && orgId
          ? `LOWER("owner_email") = ? AND "org_id" = ?`
          : `LOWER("owner_email") = ?`;
      const args = hasOrgId && orgId ? [oldEmail, orgId] : [oldEmail];
      const result = await tx.execute({
        sql: `UPDATE ${quote(table)} SET "owner_email" = ? WHERE ${where}`,
        args: [transferTo, oldEmail, ...args.slice(1)],
      });
      transferredRows += result.rowsAffected;
    }

    const groupColumns = await tx.execute({
      sql: `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'workspace_user_groups'`,
    });
    const hasGroups = new Set(
      groupColumns.rows.map((column) => String(column.column_name ?? "")),
    );
    if (hasGroups.has("id") && hasGroups.has("member_emails_json")) {
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

    const roles = await tx.execute({
      sql: `DELETE FROM app_member_roles WHERE LOWER(email) = ?${
        orgId ? " AND org_id = ?" : ""
      }`,
      args: orgId ? [oldEmail, orgId] : [oldEmail],
    });
    await tx.execute({
      sql: `DELETE FROM workspace_connection_grants
            WHERE (LOWER(owner_email) = ? OR LOWER(granted_by_email) = ?)${
              orgId ? " AND org_id = ?" : ""
            }`,
      args: orgId ? [oldEmail, oldEmail, orgId] : [oldEmail, oldEmail],
    });
    const memberships = await tx.execute({
      sql: `DELETE FROM org_members WHERE LOWER(email) = ?${
        orgId ? " AND org_id = ?" : ""
      }`,
      args: orgId ? [oldEmail, orgId] : [oldEmail],
    });

    const sessions = await tx.execute({
      sql: `DELETE FROM "session" WHERE "userId" IN
            (SELECT id FROM "user" WHERE LOWER("email") = ?)`,
      args: [oldEmail],
    });
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
        JSON.stringify({ oldEmail, transferTo }),
        transferTo,
      ],
    });
    return {
      removedMemberships: memberships.rowsAffected,
      removedAppRoles: roles.rowsAffected,
      transferredRows,
      revokedSessions: sessions.rowsAffected,
    };
  };
  return db.transaction ? db.transaction(run) : run(db);
}
