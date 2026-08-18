import { randomUUID } from "node:crypto";

import {
  getDbExec,
  intType,
  isPostgres,
  retryOnDdlRace,
  safeJsonParse,
  type DbExec,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { isOrgMember } from "../org/membership.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";

export interface WorkspaceUserGroup {
  id: string;
  orgId: string;
  name: string;
  memberEmails: string[];
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkspaceUserGroupInput {
  id?: string;
  name: string;
  memberEmails: string[];
  orgId?: string | null;
  createdByEmail?: string;
}

export interface UpdateWorkspaceUserGroupMembersInput {
  id: string;
  memberEmails: string[];
  operation: "add" | "remove";
  orgId?: string | null;
}

function workspaceUserGroupsTable(): string {
  return isPostgres()
    ? "public.workspace_user_groups"
    : "workspace_user_groups";
}

function isDuplicateObjectError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? "");
  const message = String((err as { message?: unknown })?.message ?? err)
    .toLowerCase()
    .trim();
  return (
    code === "42710" ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
}

function normalizeMemberEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function normalizeWorkspaceUserGroupIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeGroupName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("Workspace user group name is required.");
  if (name.length > 80) {
    throw new Error(
      "Workspace user group names must be 80 characters or less.",
    );
  }
  return name;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date(0).toISOString();
}

function requireWorkspaceUserGroupScope(): {
  orgId: string;
  userEmail: string;
} {
  const orgId = getRequestOrgId()?.trim();
  const userEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!orgId) {
    throw new Error("Workspace user groups require an active workspace.");
  }
  if (!userEmail) {
    throw new Error("Workspace user groups require an authenticated user.");
  }
  return { orgId, userEmail };
}

function parseRow(row: Record<string, unknown>): WorkspaceUserGroup {
  return {
    id: String(row.id ?? ""),
    orgId: String(row.org_id ?? ""),
    name: String(row.name ?? ""),
    memberEmails: normalizeMemberEmails(
      safeJsonParse<unknown>(row.member_emails_json, []),
    ),
    createdByEmail: String(row.created_by_email ?? ""),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function ensureWorkspaceUserGroupColumns(
  client: DbExec,
  table: string,
): Promise<void> {
  const columns = [
    ["org_id", "TEXT NOT NULL DEFAULT ''"],
    ["name", "TEXT NOT NULL DEFAULT ''"],
    ["member_emails_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["created_by_email", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", `${intType()} NOT NULL DEFAULT 0`],
    ["updated_at", `${intType()} NOT NULL DEFAULT 0`],
  ] as const;
  for (const [name, definition] of columns) {
    try {
      await retryOnDdlRace(() =>
        client.execute(
          isPostgres()
            ? `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`
            : `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`,
        ),
      );
    } catch (error) {
      if (!isDuplicateObjectError(error)) throw error;
    }
  }
}

let initPromise: Promise<void> | undefined;

export async function ensureWorkspaceUserGroupsTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const client = getDbExec();
      const table = workspaceUserGroupsTable();
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          member_emails_json TEXT NOT NULL DEFAULT '[]',
          created_by_email TEXT NOT NULL DEFAULT '',
          created_at ${intType()} NOT NULL DEFAULT 0,
          updated_at ${intType()} NOT NULL DEFAULT 0
        )
      `;

      if (isPostgres()) {
        await ensureTableExists("workspace_user_groups", createSql);
        await ensureWorkspaceUserGroupColumns(client, table);
        await ensureIndexExists(
          "idx_workspace_user_groups_org_updated",
          `CREATE INDEX IF NOT EXISTS idx_workspace_user_groups_org_updated ON ${table} (org_id, updated_at)`,
        );
        return;
      }

      await retryOnDdlRace(() => client.execute(createSql));
      await ensureWorkspaceUserGroupColumns(client, table);
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_workspace_user_groups_org_updated ON ${table} (org_id, updated_at)`,
        ),
      );
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

export async function listWorkspaceUserGroupsForOrg(
  orgId: string,
  groupIds?: string[],
): Promise<WorkspaceUserGroup[]> {
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return [];
  await ensureWorkspaceUserGroupsTable();
  const client = getDbExec();
  const table = workspaceUserGroupsTable();
  const normalizedIds = normalizeWorkspaceUserGroupIds(groupIds);
  const args: unknown[] = [normalizedOrgId];
  let filter = "org_id = ?";
  if (normalizedIds.length > 0) {
    filter += ` AND id IN (${normalizedIds.map(() => "?").join(", ")})`;
    args.push(...normalizedIds);
  }
  const { rows } = await client.execute({
    sql: `SELECT * FROM ${table} WHERE ${filter} ORDER BY updated_at DESC, name ASC`,
    args,
  });
  return rows.map((row) => parseRow(row as Record<string, unknown>));
}

export async function listWorkspaceUserGroups(): Promise<WorkspaceUserGroup[]> {
  const { orgId } = requireWorkspaceUserGroupScope();
  return listWorkspaceUserGroupsForOrg(orgId);
}

export async function assertWorkspaceUserGroupIds(
  groupIds: string[] | undefined,
  orgId: string | null | undefined,
): Promise<string[] | undefined> {
  if (groupIds === undefined) return undefined;
  const normalized = normalizeWorkspaceUserGroupIds(groupIds);
  if (normalized.length === 0) return normalized;
  const normalizedOrgId = orgId?.trim();
  if (!normalizedOrgId) {
    throw new Error(
      "User groups require a workspace. Personal connections are only available to you.",
    );
  }
  const groups = await listWorkspaceUserGroupsForOrg(
    normalizedOrgId,
    normalized,
  );
  const found = new Set(groups.map((group) => group.id));
  const missing = normalized.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `User groups were not found in this workspace: ${missing.join(", ")}.`,
    );
  }
  return normalized;
}

export async function assertWorkspaceUserGroupManager(
  orgId: string | null | undefined,
  userEmail: string | undefined,
): Promise<void> {
  const role = await workspaceUserGroupRole(orgId, userEmail);
  if (role === "owner" || role === "admin") return;
  throw new Error("Only workspace admins can manage user groups.");
}

export async function workspaceUserGroupRole(
  orgId: string | null | undefined,
  userEmail: string | undefined,
): Promise<"owner" | "admin" | "member" | null> {
  const normalizedOrgId = orgId?.trim();
  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!normalizedOrgId || !normalizedEmail) {
    return null;
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [normalizedOrgId, normalizedEmail],
  });
  const role = String(
    (rows[0] as Record<string, unknown> | undefined)?.role ?? "",
  );
  return role === "owner" || role === "admin" || role === "member"
    ? role
    : null;
}

export async function upsertWorkspaceUserGroup(
  input: UpsertWorkspaceUserGroupInput,
): Promise<WorkspaceUserGroup> {
  const requestScope = requireWorkspaceUserGroupScope();
  const orgId = input.orgId?.trim() || requestScope.orgId;
  if (orgId !== requestScope.orgId) {
    throw new Error("User groups must belong to the active workspace.");
  }
  const name = normalizeGroupName(input.name);
  const memberEmails = normalizeMemberEmails(input.memberEmails);
  const missing = (
    await Promise.all(
      memberEmails.map(async (email) =>
        (await isOrgMember(orgId, email)) ? null : email,
      ),
    )
  ).filter((email): email is string => Boolean(email));
  if (missing.length > 0) {
    throw new Error(
      `Group members must belong to this workspace: ${missing.join(", ")}.`,
    );
  }

  await ensureWorkspaceUserGroupsTable();
  const client = getDbExec();
  const table = workspaceUserGroupsTable();
  const id = input.id?.trim() || randomUUID();
  const now = Date.now();
  const createdByEmail =
    input.createdByEmail?.trim().toLowerCase() || requestScope.userEmail;
  const update = await client.execute({
    sql: `UPDATE ${table}
      SET name = ?, member_emails_json = ?, updated_at = ?
      WHERE id = ? AND org_id = ?`,
    args: [name, JSON.stringify(memberEmails), now, id, orgId],
  });
  if (update.rowsAffected === 0) {
    await client.execute({
      sql: `INSERT INTO ${table}
        (id, org_id, name, member_emails_json, created_by_email, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        orgId,
        name,
        JSON.stringify(memberEmails),
        createdByEmail,
        now,
        now,
      ],
    });
  }
  const groups = await listWorkspaceUserGroupsForOrg(orgId, [id]);
  const group = groups[0];
  if (!group) throw new Error(`User group "${id}" was not found after upsert.`);
  return group;
}

export async function updateWorkspaceUserGroupMembers(
  input: UpdateWorkspaceUserGroupMembersInput,
): Promise<WorkspaceUserGroup> {
  const requestScope = requireWorkspaceUserGroupScope();
  const orgId = input.orgId?.trim() || requestScope.orgId;
  if (orgId !== requestScope.orgId) {
    throw new Error("User groups must belong to the active workspace.");
  }

  const id = input.id.trim();
  if (!id) throw new Error("A user group is required.");
  const group = (await listWorkspaceUserGroupsForOrg(orgId, [id]))[0];
  if (!group) throw new Error(`User group "${id}" was not found.`);

  const memberEmails = normalizeMemberEmails(input.memberEmails);
  const missing = (
    await Promise.all(
      memberEmails.map(async (email) =>
        (await isOrgMember(orgId, email)) ? null : email,
      ),
    )
  ).filter((email): email is string => Boolean(email));
  if (missing.length > 0) {
    throw new Error(
      `Group members must belong to this workspace: ${missing.join(", ")}.`,
    );
  }

  const existing = new Set(group.memberEmails);
  const nextMembers =
    input.operation === "add"
      ? Array.from(new Set([...existing, ...memberEmails]))
      : group.memberEmails.filter((email) => !memberEmails.includes(email));

  return upsertWorkspaceUserGroup({
    id: group.id,
    name: group.name,
    memberEmails: nextMembers,
    orgId,
    createdByEmail: requestScope.userEmail,
  });
}

export async function deleteWorkspaceUserGroup(
  id: string,
  orgId?: string | null,
): Promise<boolean> {
  const requestScope = requireWorkspaceUserGroupScope();
  const normalizedOrgId = orgId?.trim() || requestScope.orgId;
  if (normalizedOrgId !== requestScope.orgId) {
    throw new Error("User groups must belong to the active workspace.");
  }
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error("A user group is required.");

  await ensureWorkspaceUserGroupsTable();
  const result = await getDbExec().execute({
    sql: `DELETE FROM ${workspaceUserGroupsTable()} WHERE id = ? AND org_id = ?`,
    args: [normalizedId, normalizedOrgId],
  });
  return result.rowsAffected > 0;
}

export async function workspaceUserGroupsIncludeUser(
  orgId: string | null | undefined,
  groupIds: string[] | undefined,
  userEmail: string,
): Promise<boolean> {
  const normalizedOrgId = orgId?.trim();
  const normalizedEmail = userEmail.trim().toLowerCase();
  const normalizedIds = normalizeWorkspaceUserGroupIds(groupIds);
  if (!normalizedOrgId || !normalizedEmail || normalizedIds.length === 0) {
    return false;
  }
  // Group rows can outlive roster membership. A stale email in the JSON
  // member list must not keep granting access after that person leaves the
  // organization.
  if (!(await isOrgMember(normalizedOrgId, normalizedEmail))) return false;
  const groups = await listWorkspaceUserGroupsForOrg(
    normalizedOrgId,
    normalizedIds,
  );
  return groups.some((group) => group.memberEmails.includes(normalizedEmail));
}
