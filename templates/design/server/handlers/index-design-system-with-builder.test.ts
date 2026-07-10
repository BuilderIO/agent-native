import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestHeader: vi.fn(),
  getSession: vi.fn(),
  readMultipartFormData: vi.fn(),
  setResponseStatus: vi.fn(),
  startBuilderDesignSystemIndex: vi.fn(),
  upsertBuilderProxyDesignSystem: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {},
  getSession: mocks.getSession,
  startBuilderDesignSystemIndex: mocks.startBuilderDesignSystemIndex,
}));

vi.mock("h3", () => ({
  defineEventHandler: <T>(handler: T) => handler,
  getRequestHeader: mocks.getRequestHeader,
  readMultipartFormData: mocks.readMultipartFormData,
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("../lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: mocks.upsertBuilderProxyDesignSystem,
}));

import { indexDesignSystemWithBuilder } from "./index-design-system-with-builder.js";

describe("Builder .fig multipart preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      email: "designer@example.com",
      orgId: null,
    });
    mocks.getRequestHeader.mockReturnValue("1024");
    mocks.readMultipartFormData.mockResolvedValue([
      {
        name: "file",
        filename: "brand.fig",
        data: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      },
    ]);
    mocks.startBuilderDesignSystemIndex.mockResolvedValue({
      ok: true,
      source: "builder",
      projectId: "project-1",
      jobId: "job-1",
      designSystemId: "system-1",
      status: "in-progress",
    });
    mocks.upsertBuilderProxyDesignSystem.mockResolvedValue({
      designSystemId: "local-1",
    });
  });

  it("requires Content-Length before buffering multipart data", async () => {
    mocks.getRequestHeader.mockReturnValue(undefined);

    const result = await indexDesignSystemWithBuilder({} as never);

    expect(result).toEqual({
      error: "A valid Content-Length header is required.",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      411,
    );
    expect(mocks.readMultipartFormData).not.toHaveBeenCalled();
  });

  it("rejects oversized declared bodies before multipart allocation", async () => {
    mocks.getRequestHeader.mockReturnValue(
      String(200 * 1024 * 1024 + 1024 * 1024 + 1),
    );

    const result = await indexDesignSystemWithBuilder({} as never);

    expect(result).toEqual({ error: "File too large (max 200 MB)." });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      413,
    );
    expect(mocks.readMultipartFormData).not.toHaveBeenCalled();
  });

  it("accepts a signature-valid .fig only after preflight", async () => {
    const result = await indexDesignSystemWithBuilder({} as never);

    expect(mocks.readMultipartFormData).toHaveBeenCalledTimes(1);
    expect(mocks.startBuilderDesignSystemIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "brand",
        files: [expect.objectContaining({ name: "brand.fig" })],
      }),
    );
    expect(result).toMatchObject({ uploadedFileCount: 1 });
  });

  it("rejects renamed non-Figma bytes", async () => {
    mocks.readMultipartFormData.mockResolvedValue([
      {
        name: "file",
        filename: "fake.fig",
        data: Buffer.from("not figma"),
      },
    ]);

    const result = await indexDesignSystemWithBuilder({} as never);

    expect(result).toEqual({
      error: "Uploaded file is not a valid .fig container.",
    });
    expect(mocks.startBuilderDesignSystemIndex).not.toHaveBeenCalled();
  });
});
