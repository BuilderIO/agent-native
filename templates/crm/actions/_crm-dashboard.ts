import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import type { AccessContext } from "@agent-native/core/sharing";

import type { CrmDashboardConfig } from "../server/db/index.js";

export const CRM_PIPELINE_DASHBOARD_TITLE = "Pipeline";
export const CRM_PIPELINE_PROGRAM_NAME = "crm-pipeline-by-stage";
export const CRM_PIPELINE_PROGRAM_TITLE = "CRM pipeline by stage";
export const CRM_PIPELINE_REFRESH_TTL_MS = 5 * 60_000;

export const CRM_PIPELINE_PROGRAM_COLUMNS = [
  { name: "stage", type: "string" },
  { name: "pipelineValue", type: "number" },
  { name: "opportunities", type: "number" },
] as const;

export const CRM_PIPELINE_PROGRAM_CODE = `const result = await appAction("get-crm-pipeline-data");
emit(result.rows, ${JSON.stringify(CRM_PIPELINE_PROGRAM_COLUMNS, null, 2)});`;

export function requireDashboardAccess(
  ctx?: ActionRunContext,
): AccessContext & { userEmail: string } {
  const userEmail = ctx?.userEmail?.trim().toLowerCase();
  if (!userEmail) {
    throw new Error("CRM dashboards require an authenticated user.");
  }
  return { userEmail, orgId: ctx?.orgId ?? undefined };
}

export function crmPipelineDashboardId(ctx: AccessContext): string {
  const owner = ctx.userEmail?.trim().toLowerCase();
  if (!owner) throw new Error("CRM dashboards require an authenticated user.");
  const scope = `${ctx.orgId ?? "personal"}:${owner}`;
  return `crm-pipeline-${createHash("sha256").update(scope).digest("hex").slice(0, 24)}`;
}

export function createPipelineDashboardConfig(
  programId: string,
): CrmDashboardConfig {
  const query = JSON.stringify({ programId });
  return {
    version: 1,
    panels: [
      {
        id: "pipeline-total",
        title: "Pipeline value",
        source: "program",
        query,
        chartType: "metric",
      },
      {
        id: "pipeline-by-stage",
        title: "Pipeline by stage",
        source: "program",
        query,
        chartType: "bar",
      },
      {
        id: "pipeline-table",
        title: "Stage detail",
        source: "program",
        query,
        chartType: "table",
      },
    ],
  };
}
