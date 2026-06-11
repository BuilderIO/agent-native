import { defineAction, embedApp } from "@agent-native/core";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { ensureDemoDashboardsForUser } from "../server/lib/demo-dashboards";
import { cliBoolean } from "./schema-helpers";

export default defineAction({
  description:
    "Install the built-in private demo dashboards for the current Analytics user. " +
    "The dashboards use sample-only demo data and do not configure or consume real data-source credentials. " +
    "Use reset=true only when the user explicitly asks to restore/reinstall deleted demo dashboards.",
  schema: z.object({
    reset: cliBoolean
      .optional()
      .default(false)
      .describe("true to reinstall demos that the user previously deleted"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Demo dashboards",
      description: "Open the installed demo dashboards in Analytics.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open demo dashboard",
      height: 680,
    }),
  },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return ensureDemoDashboardsForUser(
      { email, orgId: getRequestOrgId() || null },
      { reset: args.reset },
    );
  },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as { defaultDashboardId?: string | null }).defaultDashboardId
        : null;
    if (!dashboardId) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      label: "Open demo dashboard",
      view: "adhoc",
    };
  },
});
