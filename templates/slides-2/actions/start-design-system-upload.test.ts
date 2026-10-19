import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockFeatureNotConfiguredError extends Error {
    builderConnectUrl?: string;
  }

  return {
    FeatureNotConfiguredError: MockFeatureNotConfiguredError,
    enabled: vi.fn(),
    upload: vi.fn(),
    userEmail: "member@example.com" as string | null,
    orgId: "org-example" as string | null,
  };
});

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: mocks.FeatureNotConfiguredError,
  startBuilderDesignSystemUpload: (...args: unknown[]) => mocks.upload(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.userEmail,
  getRequestOrgId: () => mocks.orgId,
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: (...args: unknown[]) => mocks.enabled(...args),
}));

import { DESIGN_SYSTEM_WORKFLOWS } from "../shared/design-flags.js";
import action from "./start-design-system-upload.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userEmail = "member@example.com";
  mocks.orgId = "org-example";
  mocks.enabled.mockResolvedValue(true);
  mocks.upload.mockResolvedValue([
    {
      idx: 0,
      uploadUrl: "https://storage.example/upload",
      uploadToken: "token",
    },
  ]);
});

describe("start-design-system-upload", () => {
  it("creates upload slots for authenticated, feature-enabled requests", async () => {
    const attachments = [
      { name: " brand.fig ", mimetype: " image/fig ", declaredSize: 123 },
    ];
    const parsed = action.schema.parse({ attachments });

    const result = await action.run(parsed);

    expect(mocks.enabled).toHaveBeenCalledWith(DESIGN_SYSTEM_WORKFLOWS, {
      userEmail: "member@example.com",
      orgId: "org-example",
    });
    expect(mocks.upload).toHaveBeenCalledWith([
      { name: "brand.fig", mimetype: "image/fig", declaredSize: 123 },
    ]);
    expect(result.uploads).toEqual([
      {
        idx: 0,
        uploadUrl: "https://storage.example/upload",
        uploadToken: "token",
      },
    ]);
  });

  it("requires an authenticated caller before checking the workflow flag", async () => {
    mocks.userEmail = null;

    await expect(
      action.run({
        attachments: [
          { name: "brand.fig", mimetype: "image/fig", declaredSize: 123 },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 401, errorCode: "unauthorized" });

    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps the workflow disabled before creating upload slots", async () => {
    mocks.enabled.mockResolvedValue(false);

    await expect(
      action.run({
        attachments: [
          { name: "brand.fig", mimetype: "image/fig", declaredSize: 123 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "design_system_workflows_disabled",
    });

    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("preserves the 512 MB per-file upload limit", async () => {
    await expect(
      action.run({
        attachments: [
          {
            name: "large.fig",
            mimetype: "image/fig",
            declaredSize: 512 * 1024 * 1024 + 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 413, errorCode: "file_too_large" });

    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps the Builder connection action details typed", async () => {
    const error = new mocks.FeatureNotConfiguredError("Connect Builder");
    error.builderConnectUrl = "/_agent-native/builder/connect";
    mocks.upload.mockRejectedValue(error);

    await expect(
      action.run({
        attachments: [
          { name: "brand.fig", mimetype: "image/fig", declaredSize: 123 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 412,
      errorCode: "builder_not_configured",
      details: { builderConnectUrl: "/_agent-native/builder/connect" },
    });
  });
});
