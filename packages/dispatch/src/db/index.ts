import { createGetDb } from "@agent-native/core/db";
import { readOrgMemberRole } from "@agent-native/core/server";
import { registerShareableResource } from "@agent-native/core/sharing";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema.js";

type DispatchDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export const getDb = createGetDb(schema) as () => DispatchDatabase;

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
    const role = await readOrgMemberRole(ctx.orgId, ctx.userEmail);
    return role === "owner" || role === "admin";
  },
});

export function db() {
  return getDb();
}

export { schema };
export * from "./schema.js";
export * from "./migrations.js";
