import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { requireOrgMember } from "../actions.js";
import {
  listConfiguredWorkspaceApps,
  unbuiltWorkspaceAppIds,
} from "../workspace-app-access.js";

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
    const apps = new Map(
      result.rows.map((row) => {
        const id = String(row.id ?? "");
        return [
          id,
          {
            id,
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
          },
        ];
      }),
    );
    const configuredApps = listConfiguredWorkspaceApps();
    // In a workspace deployment the deploy decides which apps exist. An org row for
    // any other app is a leftover from a build that no longer runs, and it shows up
    // as a dead link in the switcher — a hosted workspace still offered a removed app (404) after that
    // app was removed. Outside a workspace deployment the configured catalog is
    // empty and this changes nothing.
    for (const id of unbuiltWorkspaceAppIds(apps.keys(), configuredApps))
      apps.delete(id);
    // Deployment-configured workspace apps are shared by every organization, so
    // a new personal org still sees the workspace's own apps (see
    // checkWorkspaceAppAccess). Do not overwrite a per-org row.
    for (const configured of configuredApps) {
      if (apps.has(configured.id)) continue;
      apps.set(configured.id, {
        id: configured.id,
        name: configured.name,
        description: configured.description,
        path: configured.path,
        mode: "all",
      });
    }
    return {
      apps: [...apps.values()].sort((a, b) =>
        a.name.toLowerCase() < b.name.toLowerCase()
          ? -1
          : a.name.toLowerCase() > b.name.toLowerCase()
            ? 1
            : a.id.localeCompare(b.id),
      ),
    };
  },
});
