import { defineActionErrors } from "@agent-native/core/action";
import { currentAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { getDb, schema } from "../server/db/index.js";
import { DEFAULT_WORKSPACE_NAME } from "../shared/form-contract.js";

export const formsErrors = defineActionErrors(
  "unauthenticated",
  "not_found",
  "invalid_input",
  "conflict",
);

export function failNotFound(message: string): never {
  return formsErrors.noWrite(message, "not_found", { statusCode: 404 });
}

export type Access = { userEmail: string; orgId: string };

// Outside an org each user is their own tenant. A shared null key let every org-less user read and delete every other one's rows.
export const personalTenant = (userEmail: string) =>
  `user:${userEmail.trim().toLowerCase()}`;

/** The tenant key is ours; framework services that take an org id need the real one, or none. */
export const frameworkOrgId = (tenant: string | null): string | null =>
  tenant && !tenant.startsWith("user:") ? tenant : null;

export function formsAccess(): Access {
  const { userEmail, orgId } = currentAccess();
  if (!userEmail)
    return formsErrors.noWrite("Sign in to use Forms.", "unauthenticated", {
      statusCode: 401,
    });
  return { userEmail, orgId: orgId ?? personalTenant(userEmail) };
}

export const nowIso = () => new Date().toISOString();

/** The first row, typed as possibly absent whatever the index-access settings. */
export const firstRow = <T>(rows: T[]): T | undefined => rows[0];

/** Rows of a tenant-scoped table for one tenant. Null only matches rows written before personal tenants existed. */
export function orgScope(
  table: { orgId: PgColumn },
  orgId: string | null,
): SQL {
  return orgId ? eq(table.orgId, orgId) : isNull(table.orgId);
}

/** Every org member sees every workspace; outside an org, only the creator. */
export function workspaceScope(orgId: string | null, userEmail: string): SQL {
  const { workspaces } = schema;
  return orgId
    ? orgScope(workspaces, orgId)
    : (and(
        orgScope(workspaces, null),
        eq(workspaces.createdBy, userEmail),
      ) as SQL);
}

/**
 * The scope's default workspace, created on the first authenticated read. The
 * id is derived from the scope so concurrent first reads insert one row, and
 * a scope that has deleted every workspace is not given a new one.
 */
export async function ensureDefaultWorkspace(access: Access): Promise<void> {
  const db = getDb();
  const { workspaces } = schema;
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(workspaceScope(access.orgId, access.userEmail))
    .limit(1);
  if (existing.length > 0) return;
  const now = nowIso();
  const key = access.orgId ? `org:${access.orgId}` : `user:${access.userEmail}`;
  await db
    .insert(workspaces)
    .values({
      id: `ws-default-${await shortHash(key)}`,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name: DEFAULT_WORKSPACE_NAME,
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

async function shortHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type FormRow = typeof schema.forms.$inferSelect;
type WorkspaceRow = typeof schema.workspaces.$inferSelect;

/** A form the caller can reach through its workspace, or a 404. */
export async function requireForm(
  access: Access,
  id: string,
  options: { deleted?: "exclude" | "only" | "include" } = {},
): Promise<{ form: FormRow; workspace: WorkspaceRow }> {
  const { forms, workspaces } = schema;
  const rows = await getDb()
    .select({ form: forms, workspace: workspaces })
    .from(forms)
    .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
    .where(
      and(
        eq(forms.id, id),
        orgScope(forms, access.orgId),
        workspaceScope(access.orgId, access.userEmail),
      ),
    )
    .limit(1);
  const row = firstRow(rows);
  if (!row) return failNotFound("Form not found.");
  const mode = options.deleted ?? "exclude";
  const gone = row.form.status === "deleted";
  if (mode === "exclude" && (gone || row.workspace.deletedAt))
    return failNotFound("Form not found.");
  if (mode === "only" && !gone) return failNotFound("Form not found.");
  return row;
}

export async function requireWorkspace(
  access: Access,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<WorkspaceRow> {
  const { workspaces } = schema;
  const rows = await getDb()
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, id),
        workspaceScope(access.orgId, access.userEmail),
      ),
    )
    .limit(1);
  const row = firstRow(rows);
  if (!row || (row.deletedAt && !options.includeDeleted))
    return failNotFound("Workspace not found.");
  return row;
}
