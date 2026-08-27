import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectExpiredExportArtifacts: vi.fn(),
  readExportArtifactBytes: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query: Record<string, unknown> }) => event.query,
  setResponseHeader: vi.fn(
    (
      event: { headers: Record<string, string> },
      key: string,
      value: string,
    ) => {
      event.headers[key] = value;
    },
  ),
  setResponseStatus: vi.fn((event: { status?: number }, status: number) => {
    event.status = status;
  }),
}));

vi.mock("../../../lib/export-artifacts.js", () => ({
  collectExpiredExportArtifacts: mocks.collectExpiredExportArtifacts,
  readExportArtifactBytes: mocks.readExportArtifactBytes,
}));

import { signShortLivedToken } from "@agent-native/core/server";

import handler from "./download.get.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OAUTH_STATE_SECRET = "test-secret-do-not-use-in-prod";
});

describe("GET /api/exports/download", () => {
  it("verifies the resource-bound token and returns a safe binary attachment", async () => {
    mocks.readExportArtifactBytes.mockResolvedValue({
      filename: "deck.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      data: new Uint8Array([1, 2, 3]),
    });
    const event = {
      query: {
        artifact: "export-artifact-id",
        token: signShortLivedToken({
          resourceId: "export-artifact-id",
          ttlSeconds: 60,
        }),
      },
      headers: {},
    };

    await expect(handler(event as never)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(event.headers).toMatchObject({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-disposition": 'attachment; filename="deck.pptx"',
    });
    expect(mocks.collectExpiredExportArtifacts).toHaveBeenCalledOnce();
    expect(mocks.readExportArtifactBytes).toHaveBeenCalledWith(
      "export-artifact-id",
    );
  });

  it("does not read an artifact when the token is invalid or resource-bound elsewhere", async () => {
    const event = {
      query: {
        artifact: "export-artifact-id",
        token: signShortLivedToken({ resourceId: "export-other-id" }),
      },
      headers: {},
      status: undefined as number | undefined,
    };

    await expect(handler(event as never)).resolves.toBe("Not found");
    expect(event.status).toBe(404);
    expect(mocks.readExportArtifactBytes).not.toHaveBeenCalled();
  });
});
