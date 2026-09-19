import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { upsertDataProgram } from "@agent-native/core/data-programs";
import { z } from "zod";

import { crmDashboardStore } from "../server/db/index.js";
import { CRM_APP_ID } from "../server/lib/provider-api.js";
import {
  createPipelineDashboardConfig,
  crmPipelineDashboardId,
  CRM_PIPELINE_PROGRAM_CODE,
  CRM_PIPELINE_PROGRAM_COLUMNS,
  CRM_PIPELINE_PROGRAM_NAME,
  CRM_PIPELINE_PROGRAM_TITLE,
  CRM_PIPELINE_REFRESH_TTL_MS,
  CRM_PIPELINE_DASHBOARD_TITLE,
  requireDashboardAccess,
} from "./_crm-dashboard.js";
import getCrmPipelineData from "./get-crm-pipeline-data.js";

export default defineAction({
  description:
    "Install or update your CRM Pipeline dashboard and its owned data program. Safe to rerun: it verifies the access-scoped source first, upserts the program by owner and name, then revision-writes the dashboard.",
  schema: z.object({}),
  run: async (_args, ctx?: ActionRunContext) => {
    const access = requireDashboardAccess(ctx);
    const preview = await getCrmPipelineData.run({}, ctx);

    const program = await upsertDataProgram({
      appId: CRM_APP_ID,
      name: CRM_PIPELINE_PROGRAM_NAME,
      title: CRM_PIPELINE_PROGRAM_TITLE,
      description:
        "Access-scoped opportunity totals by stage for the CRM Pipeline dashboard.",
      code: CRM_PIPELINE_PROGRAM_CODE,
      outputColumns: JSON.stringify(CRM_PIPELINE_PROGRAM_COLUMNS),
      refreshMode: "ttl",
      refreshTtlMs: CRM_PIPELINE_REFRESH_TTL_MS,
      background: false,
      ownerEmail: access.userEmail,
      orgId: access.orgId ?? null,
    });
    if (
      program.appId !== CRM_APP_ID ||
      program.name !== CRM_PIPELINE_PROGRAM_NAME
    ) {
      throw new Error(
        "CRM Pipeline data program could not be verified after saving.",
      );
    }

    const dashboardId = crmPipelineDashboardId(access);
    const existing = await crmDashboardStore.get(dashboardId, access);
    const dashboard = await crmDashboardStore.write(
      {
        id: dashboardId,
        kind: "pipeline",
        title: CRM_PIPELINE_DASHBOARD_TITLE,
        config: createPipelineDashboardConfig(program.id),
        ...(existing ? { expectedUpdatedAt: existing.updatedAt } : {}),
      },
      access,
    );
    if (dashboard.config.panels.length !== 3) {
      throw new Error(
        "CRM Pipeline dashboard could not be verified after saving.",
      );
    }

    return {
      dashboard,
      dashboardId: dashboard.id,
      programId: program.id,
      created: !existing,
      programPreview: {
        rowCount: preview.rows.length,
        columns: CRM_PIPELINE_PROGRAM_COLUMNS,
        truncated: preview.truncated,
      },
    };
  },
});
