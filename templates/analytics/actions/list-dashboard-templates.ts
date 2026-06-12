import { defineAction } from "@agent-native/core";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { listDashboardCatalog } from "../server/lib/dashboard-catalog";

export default defineAction({
  description:
    "List source-controlled dashboard templates in the Analytics catalog, including whether each template is already installed as a SQL dashboard.",
  schema: z.object({
    category: z
      .enum(["Acquisition", "Product", "Observability", "Operations"])
      .optional()
      .describe("Optional template category filter"),
    dataSource: z
      .enum(["demo", "first-party", "ga4", "prometheus"])
      .optional()
      .describe("Optional data source filter"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: () => ({
    url: buildDeepLink({ app: "analytics", view: "catalog" }),
    label: "Open template catalog in Analytics",
    view: "catalog",
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const templates = await listDashboardCatalog({
      email,
      orgId: getRequestOrgId() || null,
    });
    return templates.filter((template) => {
      if (args.category && template.category !== args.category) return false;
      if (args.dataSource && !template.dataSources.includes(args.dataSource)) {
        return false;
      }
      return true;
    });
  },
});
