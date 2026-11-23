import { ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";

const mocks = vi.hoisted(() => ({
  getOrgSetting: vi.fn(),
  defaultDataConnectionId: vi.fn(),
  readDataConnection: vi.fn(),
  listDataConnections: vi.fn(),
  organizationSourceAccess: vi.fn(),
  isBuiltinSampleConnection: vi.fn(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
}));
vi.mock("./data-connections.js", () => ({
  defaultDataConnectionId: mocks.defaultDataConnectionId,
  readDataConnection: mocks.readDataConnection,
  listDataConnections: mocks.listDataConnections,
  organizationSourceAccess: mocks.organizationSourceAccess,
  isBuiltinSampleConnection: mocks.isBuiltinSampleConnection,
}));
import { readWorkspaceContextSetup } from "./context-setup.js";

describe("context setup connection status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getOrgSetting.mockResolvedValue(null);
    mocks.defaultDataConnectionId.mockResolvedValue("selected");
    mocks.readDataConnection.mockResolvedValue({ config: {} });
    mocks.listDataConnections.mockRejectedValue(
      new Error("unrelated connection unavailable"),
    );
  });
  it("reads only the selected connection instead of the full annotated catalog", async () => {
    const setup = await readWorkspaceContextSetup("org");
    expect(setup.completedSteps).toContain("connect");
    expect(mocks.readDataConnection).toHaveBeenCalledWith("selected");
    expect(mocks.listDataConnections).not.toHaveBeenCalled();
  });
  it("treats an unset default and draft default as incomplete", async () => {
    mocks.defaultDataConnectionId.mockResolvedValueOnce(null);
    expect(
      (await readWorkspaceContextSetup("org")).completedSteps,
    ).not.toContain("connect");
    expect(mocks.readDataConnection).not.toHaveBeenCalled();
    mocks.readDataConnection.mockResolvedValueOnce({ config: { draft: true } });
    expect(
      (await readWorkspaceContextSetup("org")).completedSteps,
    ).not.toContain("connect");
  });
  it("handles removed and virtual organization defaults", async () => {
    mocks.readDataConnection.mockRejectedValueOnce(
      new ActionContractError("missing", {
        errorCode: "data_connection_not_found",
        statusCode: 404,
      }),
    );
    expect(
      (await readWorkspaceContextSetup("org")).completedSteps,
    ).not.toContain("connect");
    mocks.defaultDataConnectionId.mockResolvedValue(
      ORGANIZATION_BIGQUERY_SOURCE_ID,
    );
    mocks.organizationSourceAccess
      .mockResolvedValueOnce({ configured: true })
      .mockResolvedValueOnce({ configured: false });
    expect((await readWorkspaceContextSetup("org")).completedSteps).toContain(
      "connect",
    );
    expect(
      (await readWorkspaceContextSetup("org")).completedSteps,
    ).not.toContain("connect");
  });
  it("treats a default connection this member cannot read as incomplete", async () => {
    mocks.readDataConnection.mockRejectedValueOnce(
      new ActionContractError("unavailable", {
        errorCode: "data_connection_unavailable",
        statusCode: 403,
      }),
    );
    expect(
      (await readWorkspaceContextSetup("org")).completedSteps,
    ).not.toContain("connect");
  });
  it("keeps the shell readable when the default connection is unavailable after an archive or retry", async () => {
    for (const statusCode of [403, 503]) {
      mocks.readDataConnection.mockRejectedValueOnce(
        new ActionContractError(
          "The selected data connection is unavailable.",
          {
            errorCode: "data_connection_unavailable",
            statusCode,
          },
        ),
      );
      await expect(readWorkspaceContextSetup("org")).resolves.toMatchObject({
        completedSteps: [],
      });
    }
  });
  it("still surfaces connection errors that are not availability failures", async () => {
    mocks.readDataConnection.mockRejectedValueOnce(
      new ActionContractError("Admin required.", {
        errorCode: "data_connection_admin_required",
        statusCode: 403,
      }),
    );
    await expect(readWorkspaceContextSetup("org")).rejects.toMatchObject({
      errorCode: "data_connection_admin_required",
    });
  });
  it("does not treat the bundled sample as a default", async () => {
    mocks.isBuiltinSampleConnection.mockReturnValue(true);
    expect(
      (await readWorkspaceContextSetup("org")).completedSteps,
    ).not.toContain("connect");
    expect(mocks.readDataConnection).not.toHaveBeenCalled();
  });
  it("preserves a selected non-draft connection even if disabled", async () => {
    mocks.readDataConnection.mockResolvedValue({
      status: "disabled",
      config: {},
    });
    expect((await readWorkspaceContextSetup("org")).completedSteps).toContain(
      "connect",
    );
  });
  it("surfaces unavailable organization credentials", async () => {
    mocks.defaultDataConnectionId.mockResolvedValue(
      ORGANIZATION_BIGQUERY_SOURCE_ID,
    );
    mocks.organizationSourceAccess.mockRejectedValue(
      new Error("credential store unavailable"),
    );
    await expect(readWorkspaceContextSetup("org")).rejects.toThrow(
      "credential store unavailable",
    );
  });
  it("surfaces an unreadable selected connection", async () => {
    mocks.readDataConnection.mockRejectedValue(new Error("store unavailable"));
    await expect(readWorkspaceContextSetup("org")).rejects.toThrow(
      "store unavailable",
    );
  });
});
