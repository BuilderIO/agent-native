import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initDataPrograms: vi.fn(),
  pipelineAction: { run: vi.fn() },
}));

vi.mock("@agent-native/core/data-programs", () => ({
  initDataPrograms: mocks.initDataPrograms,
}));

vi.mock("../server/lib/provider-api.js", () => ({
  CRM_APP_ID: "crm",
}));

vi.mock("./get-crm-pipeline-data.js", () => ({
  default: mocks.pipelineAction,
}));

describe("CRM data-program action registry", () => {
  beforeEach(() => {
    mocks.initDataPrograms.mockReset();
  });

  it("registers the pipeline aggregate action for the CRM data-program runtime", async () => {
    const { getCrmDataProgramActions, initCrmDataPrograms } =
      await import("./_crm-data-program-actions.js");

    expect(getCrmDataProgramActions()).toEqual({
      "get-crm-pipeline-data": mocks.pipelineAction,
    });

    initCrmDataPrograms();

    expect(mocks.initDataPrograms).toHaveBeenCalledWith({
      appId: "crm",
      getActions: getCrmDataProgramActions,
    });
  });
});
