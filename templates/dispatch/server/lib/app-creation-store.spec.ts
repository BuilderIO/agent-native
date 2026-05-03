import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSettingMock = vi.hoisted(() => vi.fn());
const putSettingMock = vi.hoisted(() => vi.fn());
const runBuilderAgentMock = vi.hoisted(() => vi.fn());
const createRequestMock = vi.hoisted(() => vi.fn());
const grantSecretsToAppMock = vi.hoisted(() => vi.fn());
const listSecretsMock = vi.hoisted(() => vi.fn());
const isIntegrationCallerRequestMock = vi.hoisted(() => vi.fn());
const currentOwnerEmailMock = vi.hoisted(() => vi.fn());
const originalNodeEnv = process.env.NODE_ENV;
const originalWorkspaceAppsJson = process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON;
const originalAppUrl = process.env.APP_URL;

vi.mock("@agent-native/core/settings", () => ({
  getSetting: getSettingMock,
  putSetting: putSettingMock,
}));

vi.mock("@agent-native/core/server", () => ({
  getBuilderBranchProjectId: vi.fn(() => null),
  isIntegrationCallerRequest: isIntegrationCallerRequestMock,
  resolveBuilderCredentials: vi.fn(async () => null),
  runBuilderAgent: runBuilderAgentMock,
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: vi.fn(() => null),
  currentOwnerEmail: currentOwnerEmailMock,
  recordAudit: vi.fn(),
}));

vi.mock("./vault-store.js", () => ({
  createRequest: createRequestMock,
  grantSecretsToApp: grantSecretsToAppMock,
  listSecrets: listSecretsMock,
}));

describe("startWorkspaceAppCreation", () => {
  beforeEach(() => {
    vi.resetModules();
    getSettingMock.mockReset();
    putSettingMock.mockReset();
    runBuilderAgentMock.mockReset();
    createRequestMock.mockReset();
    grantSecretsToAppMock.mockReset();
    listSecretsMock.mockReset();
    isIntegrationCallerRequestMock.mockReset();
    currentOwnerEmailMock.mockReset();
    getSettingMock.mockResolvedValue({ builderProjectId: "builder-project" });
    runBuilderAgentMock.mockResolvedValue({
      branchName: "branch",
      url: "https://builder.io/branch",
      status: "started",
    });
    createRequestMock.mockResolvedValue({ status: "pending" });
    listSecretsMock.mockResolvedValue([]);
    isIntegrationCallerRequestMock.mockReturnValue(false);
    currentOwnerEmailMock.mockReturnValue("dispatch-test@example.com");
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://workspace.example.test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalWorkspaceAppsJson === undefined) {
      delete process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON;
    } else {
      process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = originalWorkspaceAppsJson;
    }
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
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

  it("does not expose preparedPrompt in the app creation action schema", async () => {
    const action = (
      await import("../../actions/start-workspace-app-creation.js")
    ).default;

    expect(action.tool.parameters.properties).not.toHaveProperty(
      "preparedPrompt",
    );
  });

  it("tracks Builder-created apps as pending until the workspace manifest includes them", async () => {
    const { startWorkspaceAppCreation } =
      await import("./app-creation-store.js");

    const result = await startWorkspaceAppCreation({
      prompt: "make a QA dashboard",
      appId: "qa-dashboard",
    });

    expect(result).toMatchObject({
      mode: "builder",
      appId: "qa-dashboard",
      path: "/qa-dashboard",
      url: "https://builder.io/branch",
      workspaceUrl: expect.stringContaining("/qa-dashboard"),
    });
    expect(putSettingMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pendingApps: [
          expect.objectContaining({
            id: "qa-dashboard",
            path: "/qa-dashboard",
            builderUrl: "https://builder.io/branch",
            branchName: "branch",
            projectId: "builder-project",
          }),
        ],
      }),
    );
    expect(runBuilderAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Branch readiness requirements"),
      }),
    );
    const builderPrompt = runBuilderAgentMock.mock.calls[0]?.[0]?.prompt;
    expect(builderPrompt).toContain(
      "workspace-apps.json or .agent-native/workspace-apps.json",
    );
    expect(builderPrompt).toContain("manifest/package/deploy metadata");
    expect(builderPrompt).toContain("agent card/A2A metadata");
  });

  it("blocks remote Builder starts for synthetic integration owners", async () => {
    currentOwnerEmailMock.mockReturnValue(
      "dispatch+abc123def4567890@integration.local",
    );
    isIntegrationCallerRequestMock.mockReturnValue(true);

    const { startWorkspaceAppCreation } =
      await import("./app-creation-store.js");

    const result = await startWorkspaceAppCreation({
      prompt: "make a QA dashboard",
      appId: "qa-dashboard",
    });

    expect(result).toMatchObject({
      mode: "builder-unavailable",
      appId: "qa-dashboard",
      message: expect.stringContaining("needs a trusted Dispatch owner"),
    });
    expect(getSettingMock).not.toHaveBeenCalled();
    expect(runBuilderAgentMock).not.toHaveBeenCalled();
    expect(grantSecretsToAppMock).not.toHaveBeenCalled();
  });

  it("keeps local dev app creation ergonomic for synthetic integration owners", async () => {
    process.env.NODE_ENV = "development";
    currentOwnerEmailMock.mockReturnValue(
      "dispatch+abc123def4567890@integration.local",
    );
    isIntegrationCallerRequestMock.mockReturnValue(true);

    const { startWorkspaceAppCreation } =
      await import("./app-creation-store.js");

    const result = await startWorkspaceAppCreation({
      prompt: "make a QA dashboard",
      appId: "qa-dashboard",
    });

    expect(result).toMatchObject({
      mode: "local-agent",
      appId: "qa-dashboard",
      prompt: expect.stringContaining("Branch readiness requirements"),
    });
    expect(getSettingMock).not.toHaveBeenCalled();
    expect(runBuilderAgentMock).not.toHaveBeenCalled();
  });

  it("creates pending vault requests for selected keys in local app creation", async () => {
    process.env.NODE_ENV = "development";
    listSecretsMock.mockResolvedValue([
      { id: "secret-1", credentialKey: "OPENAI_API_KEY" },
      { id: "secret-2", credentialKey: "STRIPE_SECRET_KEY" },
    ]);

    const { startWorkspaceAppCreation } =
      await import("./app-creation-store.js");

    const result = await startWorkspaceAppCreation({
      prompt: "make a QA dashboard",
      appId: "qa-dashboard",
      secretIds: ["secret-1", "secret-2"],
    });

    expect(result).toMatchObject({
      mode: "local-agent",
      appId: "qa-dashboard",
      prompt: expect.stringContaining(
        "Dispatch vault keys selected for this app: OPENAI_API_KEY, STRIPE_SECRET_KEY",
      ),
    });
    expect(result).toMatchObject({
      prompt: expect.stringContaining("pending vault requests"),
    });
    expect(String(result.prompt)).not.toContain(
      "Grant the selected Dispatch vault keys",
    );
    expect(createRequestMock).toHaveBeenCalledTimes(2);
    expect(createRequestMock).toHaveBeenNthCalledWith(1, {
      appId: "qa-dashboard",
      credentialKey: "OPENAI_API_KEY",
      reason: "Requested during workspace app creation for qa-dashboard.",
    });
    expect(createRequestMock).toHaveBeenNthCalledWith(2, {
      appId: "qa-dashboard",
      credentialKey: "STRIPE_SECRET_KEY",
      reason: "Requested during workspace app creation for qa-dashboard.",
    });
    expect(grantSecretsToAppMock).not.toHaveBeenCalled();
    expect(runBuilderAgentMock).not.toHaveBeenCalled();
  });

  it("creates pending vault requests for selected keys after Builder app creation is accepted", async () => {
    listSecretsMock.mockResolvedValue([
      { id: "secret-1", credentialKey: "OPENAI_API_KEY" },
      { id: "secret-2", credentialKey: "STRIPE_SECRET_KEY" },
    ]);

    const { startWorkspaceAppCreation } =
      await import("./app-creation-store.js");

    const result = await startWorkspaceAppCreation({
      prompt: "make a QA dashboard",
      appId: "qa-dashboard",
      secretIds: ["secret-1", "secret-2"],
    });

    expect(result).toMatchObject({
      mode: "builder",
      appId: "qa-dashboard",
    });
    expect(createRequestMock).toHaveBeenCalledTimes(2);
    expect(createRequestMock).toHaveBeenNthCalledWith(1, {
      appId: "qa-dashboard",
      credentialKey: "OPENAI_API_KEY",
      reason: "Requested during workspace app creation for qa-dashboard.",
    });
    expect(createRequestMock).toHaveBeenNthCalledWith(2, {
      appId: "qa-dashboard",
      credentialKey: "STRIPE_SECRET_KEY",
      reason: "Requested during workspace app creation for qa-dashboard.",
    });
    expect(grantSecretsToAppMock).not.toHaveBeenCalled();
    expect(createRequestMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      runBuilderAgentMock.mock.invocationCallOrder[0],
    );
    expect(createRequestMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      putSettingMock.mock.invocationCallOrder[0],
    );
  });

  it("does not fail accepted app creation when vault request creation fails", async () => {
    listSecretsMock.mockResolvedValue([
      { id: "secret-1", credentialKey: "OPENAI_API_KEY" },
    ]);
    createRequestMock.mockRejectedValue(new Error("vault write failed"));

    const { startWorkspaceAppCreation } =
      await import("./app-creation-store.js");

    await expect(
      startWorkspaceAppCreation({
        prompt: "make a QA dashboard",
        appId: "qa-dashboard",
        secretIds: ["secret-1"],
      }),
    ).resolves.toMatchObject({
      mode: "builder",
      appId: "qa-dashboard",
    });
    expect(createRequestMock).toHaveBeenCalledTimes(1);
    expect(grantSecretsToAppMock).not.toHaveBeenCalled();
  });

  it("lists pending Builder apps without duplicating apps that are already ready", async () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [
        {
          id: "dispatch",
          name: "Dispatch",
          path: "/dispatch",
          isDispatch: true,
        },
        {
          id: "ready-app",
          name: "Ready App",
          path: "/ready-app",
        },
      ],
    });
    getSettingMock.mockResolvedValue({
      pendingApps: [
        {
          id: "pending-app",
          path: "/pending-app",
          builderUrl: "https://builder.io/pending",
          branchName: "pending-branch",
          createdAt: "2026-05-03T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        },
        {
          id: "ready-app",
          path: "/ready-app",
          builderUrl: "https://builder.io/ready",
          branchName: "ready-branch",
          createdAt: "2026-05-03T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    });

    const { listWorkspaceApps } = await import("./app-creation-store.js");
    const apps = await listWorkspaceApps();

    expect(apps.map((app) => app.id)).toEqual([
      "dispatch",
      "ready-app",
      "pending-app",
    ]);
    expect(apps.find((app) => app.id === "ready-app")?.status).toBe("ready");
    expect(apps.find((app) => app.id === "pending-app")).toMatchObject({
      status: "pending",
      statusLabel: "Building in Builder",
      url: "https://builder.io/pending",
      branchName: "pending-branch",
    });
  });
});
