import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { requireOrgMember } from "../actions.js";

export default defineAction({
  description:
    "List the workspace applications and their organization access mode.",
  http: { method: "GET" },
  schema: z.object({}),
  run: async (_args, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const result = await getDbExec().execute({
      sql: `SELECT id, name, description, path, visibility, org_enabled
            FROM workspace_apps
            WHERE org_id = ?
            ORDER BY LOWER(name), id`,
      args: [caller.orgId],
    });
    return {
      apps: result.rows.map((row) => ({
        id: String(row.id ?? ""),
        name: String(row.name ?? row.id ?? ""),
        description:
          typeof row.description === "string" ? row.description : null,
        path: String(row.path ?? ""),
        mode:
          row.org_enabled === false ||
          row.org_enabled === 0 ||
          row.org_enabled === "false" ||
          row.org_enabled === "0"
            ? "disabled"
            : row.visibility === "private"
              ? "restricted"
              : "all",
      })),
    };
  },
});
