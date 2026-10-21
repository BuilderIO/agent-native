import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  upsert: vi.fn(),
  userEmail: "member@example.com" as string | undefined,
  orgId: "org-example" as string | undefined,
  assertWorkflowsEnabled: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {
    builderConnectUrl?: string;
  },
  indexBuilderDesignSystem: (...args: unknown[]) => mocks.index(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mocks.orgId,
  getRequestUserEmail: () => mocks.userEmail,
}));
vi.mock("../server/lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: (...args: unknown[]) => mocks.upsert(...args),
}));
vi.mock("../server/lib/design-system-workflows.js", () => ({
  assertDesignSystemWorkflowsEnabled: (...args: unknown[]) =>
    mocks.assertWorkflowsEnabled(...args),
}));

import action from "./index-uploaded-design-system-files.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userEmail = "member@example.com";
  mocks.orgId = "org-example";
  mocks.index.mockResolvedValue({
    ok: true,
    source: "builder",
    projectId: "project-1",
    jobId: "job-1",
    designSystemId: "design-system-1",
    suggestedTitle: "Brand",
    builderUrl: "https://builder.io/design-system/design-system-1",
    status: "in-progress",
  });
  mocks.upsert.mockResolvedValue({ localDesignSystemId: "local-system-1" });
});

describe("index-uploaded-design-system-files", () => {
  it("indexes uploaded tokens and scopes the saved proxy to the caller", async () => {
    const result = await action.run({
      projectName: "Brand",
      uploadTokens: ["upload-1", "upload-2"],
    });

    expect(mocks.assertWorkflowsEnabled).toHaveBeenCalledOnce();
    expect(mocks.index).toHaveBeenCalledWith({
      sources: [
        { kind: "file", uploadToken: "upload-1" },
        { kind: "file", uploadToken: "upload-2" },
      ],
      projectName: "Brand",
    });
    expect(mocks.upsert).toHaveBeenCalledWith({
      result: expect.objectContaining({ jobId: "job-1" }),
      ownerEmail: "member@example.com",
      orgId: "org-example",
      projectName: "Brand",
      sourceKind: "figma",
    });
    expect(result).toMatchObject({
      localDesignSystemId: "local-system-1",
      uploadedFileCount: 2,
    });
  });

  it("rejects anonymous requests before provider or persistence work", async () => {
    mocks.userEmail = undefined;

    await expect(
      action.run({ projectName: "Brand", uploadTokens: ["upload-1"] }),
    ).rejects.toMatchObject({ statusCode: 401, errorCode: "unauthorized" });
    expect(mocks.assertWorkflowsEnabled).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
