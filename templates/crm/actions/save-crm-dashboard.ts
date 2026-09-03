import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  crmDashboardStore,
  type CrmDashboardConfig,
} from "../server/db/index.js";
import { requireDashboardAccess } from "./_crm-dashboard.js";

const configSchema = z.object({
  version: z.literal(1),
  panels: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(160),
        source: z.literal("program"),
        query: z.string().trim().min(1).max(2_000),
        chartType: z.enum(["metric", "bar", "table"]),
      }),
    )
    .min(1)
    .max(12)
    .refine(
      (panels) =>
        new Set(panels.map((panel) => panel.id)).size === panels.length,
      "Dashboard panel IDs must be unique.",
    ),
});

export default defineAction({
  description:
    "Create or update an access-scoped CRM pipeline dashboard. Pass expectedUpdatedAt to reject an overwrite when the dashboard changed since it was read.",
  schema: z.object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(160),
    config: configSchema,
    expectedUpdatedAt: z.string().datetime().optional(),
  }),
  run: ({ id, title, config, expectedUpdatedAt }, ctx?: ActionRunContext) =>
    crmDashboardStore.write(
      {
        id,
        kind: "pipeline",
        title,
        config: config as CrmDashboardConfig,
        expectedUpdatedAt,
      },
      requireDashboardAccess(ctx),
    ),
});
