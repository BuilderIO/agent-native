import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { listAnalyses } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "List all saved ad-hoc analyses. Returns their IDs, names, descriptions, and last updated timestamps.",
  schema: z.object({
    hidden: z.enum(["visible", "hidden", "all"]).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: () => ({
    url: buildDeepLink({ app: "analytics", view: "analyses" }),
    label: "Open analyses in Analytics",
    view: "analyses",
  }),
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const rows = await listAnalyses(
      { email, orgId },
      { hidden: args.hidden ?? "visible" },
    );
    return rows
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        dataSources: a.dataSources,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        author: a.author,
        ownerEmail: a.ownerEmail,
        visibility: a.visibility,
        hiddenAt: a.hiddenAt,
        hiddenBy: a.hiddenBy,
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  },
});
