import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  listDashboards,
  type DashboardArchiveFilter,
  type DashboardHiddenFilter,
} from "../server/lib/dashboards-store";

function parseArchivedFilter(raw: unknown): DashboardArchiveFilter {
  if (raw === "archived" || raw === "only") return "archived";
  if (raw === "all") return "all";
  return "active";
}

function parseHiddenFilter(raw: unknown): DashboardHiddenFilter {
  if (raw === "hidden" || raw === "only") return "hidden";
  if (raw === "all") return "all";
  return "visible";
}

export default defineAction({
  description:
    "List all explorer (BigQuery explorer) dashboards accessible to the current user. " +
    "Returns each dashboard's id, name, visibility, archive state, and timestamps.",
  schema: z.object({
    archived: z
      .enum(["active", "archived", "all"])
      .optional()
      .default("active")
      .describe("Filter by archive state (default: active)"),
    hidden: z
      .enum(["visible", "hidden", "all"])
      .optional()
      .default("visible")
      .describe("Filter by hidden state (default: visible)"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };
    const archived = parseArchivedFilter(args.archived);
    const hidden = parseHiddenFilter(args.hidden);
    const rows = await listDashboards(ctx, {
      kind: "explorer",
      archived,
      hidden,
    });
    return {
      dashboards: rows.map((d) => ({
        id: d.id,
        ...(d.config as Record<string, unknown>),
        ownerEmail: d.ownerEmail,
        orgId: d.orgId,
        visibility: d.visibility,
        archivedAt: d.archivedAt,
        hiddenAt: d.hiddenAt,
        hiddenBy: d.hiddenBy,
      })),
    };
  },
});
