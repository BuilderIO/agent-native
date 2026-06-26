import { getDbExec } from "@agent-native/core/db";

/**
 * Guards destructive bulk writes (seed/replace) on the org-shared curated
 * tables (strategic accounts, coverage contacts, implementation blockers).
 *
 * Per-row edits already go through `assertAccess(..., "editor", ...)`, but the
 * atomic replace path wipes and rewrites the WHOLE scope. Without this check
 * any ordinary org member could erase the shared roster. We require an org
 * owner/admin for org-scoped writes; in solo mode (no org) the caller only ever
 * touches their own org-less rows, so authentication alone is sufficient.
 */
export async function assertCanManageOrgRoster(ctx: {
  email: string;
  orgId: string | null;
}): Promise<void> {
  if (!ctx.email) throw new Error("no authenticated user");
  // Solo / org-less scope: the writable scope is the caller's own rows only.
  if (!ctx.orgId) return;

  const exec = getDbExec();
  const { rows } = await exec.execute({
    sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [ctx.orgId, ctx.email.toLowerCase()],
  });
  const role = rows[0]?.role ? String(rows[0].role) : null;
  if (role !== "owner" && role !== "admin") {
    throw new Error(
      "Only organization owners or admins can seed or replace shared roster data.",
    );
  }
}
