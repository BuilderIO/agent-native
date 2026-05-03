import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSettingMock = vi.hoisted(() => vi.fn());
const runBuilderAgentMock = vi.hoisted(() => vi.fn());
const grantSecretsToAppMock = vi.hoisted(() => vi.fn());
const listSecretsMock = vi.hoisted(() => vi.fn());
const originalNodeEnv = process.env.NODE_ENV;

vi.mock("@agent-native/core/settings", () => ({
  getSetting: getSettingMock,
  putSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getBuilderBranchProjectId: vi.fn(() => null),
  resolveBuilderCredentials: vi.fn(async () => null),
  runBuilderAgent: runBuilderAgentMock,
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: vi.fn(() => null),
  currentOwnerEmail: vi.fn(() => "dispatch-test@example.com"),
  recordAudit: vi.fn(),
}));

vi.mock("./vault-store.js", () => ({
  grantSecretsToApp: grantSecretsToAppMock,
  listSecrets: listSecretsMock,
}));

describe("startWorkspaceAppCreation", () => {
  beforeEach(() => {
    vi.resetModules();
    getSettingMock.mockReset();
    runBuilderAgentMock.mockReset();
    grantSecretsToAppMock.mockReset();
    listSecretsMock.mockReset();
    getSettingMock.mockResolvedValue({ builderProjectId: "builder-project" });
    runBuilderAgentMock.mockResolvedValue({
      branchName: "branch",
      url: "https://builder.io/branch",
      status: "started",
    });
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("rejects reserved workspace app ids before Builder branch creation", async () => {
    const { startWorkspaceAppCreation } =
      await import("./app-creation-store.js");

    await expect(
      startWorkspaceAppCreation({
        prompt: "make a dispatch app",
        appId: "dispatch",
      }),
    ).rejects.toThrow("reserved workspace route");

    expect(getSettingMock).not.toHaveBeenCalled();
    expect(runBuilderAgentMock).not.toHaveBeenCalled();
    expect(grantSecretsToAppMock).not.toHaveBeenCalled();
  });
});
