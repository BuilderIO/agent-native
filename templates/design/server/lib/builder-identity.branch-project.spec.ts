import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.BUILDER_IDENTITY = "1";

const mocks = vi.hoisted(() => ({
  provider: null as null | (() => Promise<string | undefined>),
  navigation: null as Record<string, unknown> | null,
  assertAccess: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  registerDelegatedBuilderCredentials: vi.fn(),
  registerBuilderBranchProject: vi.fn(
    (provider: () => Promise<string | undefined>) => {
      mocks.provider = provider;
    },
  ),
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: vi.fn(async () => mocks.navigation),
}));
vi.mock("@agent-native/core/sharing", () => ({
  registerHostAccessResolver: vi.fn(),
  assertAccess: mocks.assertAccess,
}));
vi.mock("@agent-native/core/labs/server", () => ({
  registerHostLabOverrides: vi.fn(),
}));

await import("./builder-identity.js");

function designWithApp(projectId: string) {
  return {
    resource: {
      data: JSON.stringify({
        fusionApp: { projectId, branchName: "main", status: "ready" },
      }),
    },
  };
}

describe("Builder branch project from the open design", () => {
  beforeEach(() => {
    mocks.navigation = { view: "editor", designId: "design-1" };
    mocks.assertAccess.mockReset();
  });

  it("names the Builder project the open design is bound to", async () => {
    mocks.assertAccess.mockResolvedValue(designWithApp("project-abc"));

    await expect(mocks.provider!()).resolves.toBe("project-abc");
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "viewer",
    );
  });

  it("names nothing when no design is open", async () => {
    mocks.navigation = { view: "list" };

    await expect(mocks.provider!()).resolves.toBeUndefined();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("names nothing for a local launch session", async () => {
    mocks.assertAccess.mockResolvedValue(designWithApp("local"));

    await expect(mocks.provider!()).resolves.toBeUndefined();
  });

  it("names nothing for a design that is not bound to a Builder app", async () => {
    mocks.assertAccess.mockResolvedValue({ resource: { data: "{}" } });

    await expect(mocks.provider!()).resolves.toBeUndefined();
  });

  it("does not name a project for a design the user cannot read", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("forbidden"));

    await expect(mocks.provider!()).rejects.toThrow("forbidden");
  });
});
