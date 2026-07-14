import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMaxFigBytes = vi.hoisted(() => 200 * 1024 * 1024);
const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetRequestHeader = vi.hoisted(() => vi.fn());
const mockReadMultipartFormData = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockStartBuilderDesignSystemIndex = vi.hoisted(() => vi.fn());
const mockUpsertBuilderProxyDesignSystem = vi.hoisted(() => vi.fn());
const MockFeatureNotConfiguredError = vi.hoisted(
  () =>
    class FeatureNotConfiguredError extends Error {
      builderConnectUrl?: string;

      constructor(opts: { message?: string; builderConnectUrl?: string } = {}) {
        super(opts.message);
        this.builderConnectUrl = opts.builderConnectUrl;
      }
    },
);

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: (...args: unknown[]) => mockGetRequestHeader(...args),
  readMultipartFormData: (...args: unknown[]) =>
    mockReadMultipartFormData(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: MockFeatureNotConfiguredError,
  getSession: (...args: unknown[]) => mockGetSession(...args),
  startBuilderDesignSystemIndex: (...args: unknown[]) =>
    mockStartBuilderDesignSystemIndex(...args),
}));

vi.mock("../lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: (...args: unknown[]) =>
    mockUpsertBuilderProxyDesignSystem(...args),
}));

import { indexDesignSystemWithBuilder } from "./index-design-system-with-builder";

describe("indexDesignSystemWithBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org-1",
    });
    mockGetRequestHeader.mockReturnValue(null);
    mockReadMultipartFormData.mockResolvedValue([
      {
        name: "file",
        filename: "brand.fig",
        data: Buffer.from([
          0x66, 0x69, 0x67, 0x2d, 0x6b, 0x69, 0x77, 0x69, 0, 0, 0, 0,
        ]),
      },
    ]);
    mockStartBuilderDesignSystemIndex.mockResolvedValue({
      ok: true,
      source: "builder",
      suggestedTitle: "brand",
      projectId: "project-1",
      jobId: "job-1",
      designSystemId: "ds-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      status: "in-progress",
    });
    mockUpsertBuilderProxyDesignSystem.mockResolvedValue({
      localDesignSystemId: "builder-ds-1",
      instructions: "Builder design-system indexing has started.",
    });
  });

  it("rejects oversized requests before multipart parsing", async () => {
    mockGetRequestHeader.mockReturnValue(
      String(mockMaxFigBytes + 1024 * 1024 + 1),
    );

    const result = await indexDesignSystemWithBuilder({} as any);

    expect(mockReadMultipartFormData).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(result).toEqual({ error: "File too large (max 200 MB)." });
  });

  it("returns a clear error when multipart parsing fails", async () => {
    mockReadMultipartFormData.mockRejectedValue(new Error("bad multipart"));

    const result = await indexDesignSystemWithBuilder({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(result).toEqual({ error: "Upload too large or malformed." });
  });

  it("rejects oversized parsed multipart payloads", async () => {
    mockReadMultipartFormData.mockResolvedValue([
      {
        name: "file",
        filename: "brand.fig",
        data: { length: mockMaxFigBytes + 1 },
      },
    ]);

    const result = await indexDesignSystemWithBuilder({} as any);

    expect(mockStartBuilderDesignSystemIndex).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(result).toEqual({ error: "File too large (max 200 MB)." });
  });

  it("passes uploaded fig bytes to Builder indexing", async () => {
    const data = Buffer.from([
      0x66, 0x69, 0x67, 0x2d, 0x6b, 0x69, 0x77, 0x69, 0, 0, 0, 0,
    ]);
    mockReadMultipartFormData.mockResolvedValue([
      { name: "fig", filename: "brand.fig", data },
    ]);

    const result = await indexDesignSystemWithBuilder({} as any);

    expect(mockStartBuilderDesignSystemIndex).toHaveBeenCalledWith({
      projectName: "brand",
      files: [
        {
          name: "brand.fig",
          data,
          mimeType: "application/octet-stream",
        },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      source: "builder",
      designSystemId: "ds-1",
      jobId: "job-1",
      localDesignSystemId: "builder-ds-1",
      uploadedFileCount: 1,
    });
    expect(mockUpsertBuilderProxyDesignSystem).toHaveBeenCalledWith({
      result: expect.objectContaining({
        designSystemId: "ds-1",
        jobId: "job-1",
      }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      projectName: "brand",
    });
  });

  it("returns Builder connection errors as precondition failures", async () => {
    mockStartBuilderDesignSystemIndex.mockRejectedValue(
      new MockFeatureNotConfiguredError({
        message: "Connect Builder.io before indexing a design system.",
        builderConnectUrl: "/_agent-native/builder/connect",
      }),
    );

    const result = await indexDesignSystemWithBuilder({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 412);
    expect(result).toEqual({
      error: "Connect Builder.io before indexing a design system.",
      builderConnectUrl: "/_agent-native/builder/connect",
    });
  });

  it("returns Builder errors as upstream failures", async () => {
    mockStartBuilderDesignSystemIndex.mockRejectedValue(
      new Error("Builder queue unavailable"),
    );

    const result = await indexDesignSystemWithBuilder({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 502);
    expect(result).toEqual({
      error: "Builder queue unavailable",
    });
  });
});
