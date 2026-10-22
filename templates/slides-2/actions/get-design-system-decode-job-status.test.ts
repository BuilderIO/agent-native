import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  fetchStatus: vi.fn(),
  parseReference: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {
    builderConnectUrl?: string;
  },
  fetchBuilderDesignSystemDecodeJobStatus: (...args: unknown[]) =>
    mocks.fetchStatus(...args),
  parseBuilderDesignSystemProxyReference: (...args: unknown[]) =>
    mocks.parseReference(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

import action from "./get-design-system-decode-job-status.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertAccess.mockResolvedValue({
    resource: { id: "local-system-1", data: "stored-builder-reference" },
  });
  mocks.parseReference.mockReturnValue({ builderJobId: "job-1" });
  mocks.fetchStatus.mockResolvedValue({
    jobId: "job-1",
    status: "processing",
    framesProcessed: 2,
    totalFrames: 5,
    branchName: null,
    branchUrl: null,
    error: null,
    createdAt: 1,
    updatedAt: 2,
  });
});

describe("get-design-system-decode-job-status", () => {
  it("reads the Builder job attached to an accessible local design system", async () => {
    const result = await action.run({ designSystemId: "local-system-1" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design-system",
      "local-system-1",
      "viewer",
    );
    expect(mocks.parseReference).toHaveBeenCalledWith(
      "stored-builder-reference",
    );
    expect(mocks.fetchStatus).toHaveBeenCalledWith("job-1");
    expect(result).toMatchObject({ status: "processing", totalFrames: 5 });
  });

  it("does not query Builder for a non-Builder design system", async () => {
    mocks.parseReference.mockReturnValue(null);

    await expect(
      action.run({ designSystemId: "local-system-1" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "not_builder_design_system",
    });
    expect(mocks.fetchStatus).not.toHaveBeenCalled();
  });
});
