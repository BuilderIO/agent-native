import { describe, expect, it } from "vitest";

import {
  createPipelineDashboardConfig,
  crmPipelineDashboardId,
  CRM_PIPELINE_PROGRAM_CODE,
} from "./_crm-dashboard.js";

describe("CRM Pipeline dashboard pack", () => {
  it("creates three program-backed panels from one stored program", () => {
    const config = createPipelineDashboardConfig("dp_pipeline");

    expect(config).toEqual({
      version: 1,
      panels: expect.arrayContaining([
        expect.objectContaining({
          id: "pipeline-total",
          chartType: "metric",
          query: JSON.stringify({ programId: "dp_pipeline" }),
        }),
        expect.objectContaining({ chartType: "bar" }),
        expect.objectContaining({ chartType: "table" }),
      ]),
    });
    expect(new Set(config.panels.map((panel) => panel.id)).size).toBe(3);
  });

  it("keeps an owner-scoped dashboard id stable without embedding the email", () => {
    const scope = { userEmail: "owner@example.com", orgId: "org_1" };
    const id = crmPipelineDashboardId(scope);

    expect(crmPipelineDashboardId(scope)).toBe(id);
    expect(crmPipelineDashboardId({ ...scope, orgId: "org_2" })).not.toBe(id);
    expect(id).not.toContain("owner@example.com");
  });

  it("uses the bounded CRM aggregate action as the program source", () => {
    expect(CRM_PIPELINE_PROGRAM_CODE).toContain(
      'appAction("get-crm-pipeline-data")',
    );
    expect(CRM_PIPELINE_PROGRAM_CODE).toContain("emit(result.rows");
  });
});
