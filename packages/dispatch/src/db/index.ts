import { createGetDb, getDbExec } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);

registerShareableResource({
  type: "workspace-app",
  resourceTable: schema.workspaceApps,
  sharesTable: schema.workspaceAppShares,
  displayName: "Workspace app",
  titleColumn: "name",
  getResourcePath: (resource) =>
    typeof resource?.path === "string" ? resource.path : undefined,
  getDb,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  supportsGroupShares: true,
  canManageAccess: async (resource, ctx) => {
    if (!ctx.userEmail || !ctx.orgId || resource?.orgId !== ctx.orgId) {
      return false;
    }
    const result = await getDbExec().execute({
      sql: `SELECT 1 FROM org_members
            WHERE org_id = ? AND LOWER(email) = LOWER(?)
              AND role IN ('owner', 'admin') LIMIT 1`,
      args: [ctx.orgId, ctx.userEmail],
    });
    return result.rows.length > 0;
  },
});

export function db() {
  return getDb();
}

export { schema };
export * from "./schema.js";
export * from "./migrations.js";
