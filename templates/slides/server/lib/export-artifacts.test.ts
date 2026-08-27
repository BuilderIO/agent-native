import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  putPrivateBlob: vi.fn(),
  deletePrivateBlob: vi.fn(),
  readPrivateBlob: vi.fn(),
  insertValues: vi.fn(),
  deleteWhere: vi.fn(),
  selectRows: [] as unknown[],
}));

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: mocks.putPrivateBlob,
  deletePrivateBlob: mocks.deletePrivateBlob,
  readPrivateBlob: mocks.readPrivateBlob,
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectRows,
        }),
        limit: async () => mocks.selectRows,
      }),
    }),
    insert: () => ({ values: mocks.insertValues }),
    delete: () => ({ where: mocks.deleteWhere }),
  }),
}));

vi.mock("nanoid", () => ({ nanoid: () => "artifact-id" }));

import { verifyShortLivedToken } from "@agent-native/core/server";

import {
  collectExpiredExportArtifacts,
  createExportArtifact,
  EXPORT_DOWNLOAD_TTL_SECONDS,
} from "./export-artifacts.js";

const handle = {
  id: "opaque-blob-id",
  provider: "test",
  opaque: true as const,
  encrypted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
  process.env.OAUTH_STATE_SECRET = "test-secret-do-not-use-in-prod";
  mocks.selectRows = [];
  mocks.putPrivateBlob.mockResolvedValue(handle);
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.deleteWhere.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe("export artifacts", () => {
  it("persists a private blob and returns only the durable download contract", async () => {
    const result = await createExportArtifact({
      data: new TextEncoder().encode("deck"),
      filename: "deck.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ownerEmail: "owner@example.com",
      downloadBaseUrl: "https://slides.example.test/slides",
    });

    expect(result).toEqual({
      downloadUrl: expect.stringContaining("/api/exports/download?"),
      filename: "deck.pptx",
      expiresAt: new Date(
        Date.now() + EXPORT_DOWNLOAD_TTL_SECONDS * 1000,
      ).toISOString(),
    });
    expect(Object.keys(result ?? {}).sort()).toEqual([
      "downloadUrl",
      "expiresAt",
      "filename",
    ]);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "export-artifact-id",
        filename: "deck.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        blobHandle: JSON.stringify(handle),
      }),
    );
    const url = new URL(result!.downloadUrl);
    expect(
      verifyShortLivedToken(
        url.searchParams.get("token")!,
        "export-artifact-id",
      ),
    ).toEqual({ ok: true });
  });

  it("deletes an expired row only after its private blob deletion succeeds", async () => {
    mocks.selectRows = [
      {
        id: "export-expired-id",
        filename: "deck.html",
        mimeType: "text/html; charset=utf-8",
        expiresAt: "2026-08-27T11:59:00.000Z",
        blobHandle: JSON.stringify(handle),
      },
    ];
    mocks.deletePrivateBlob.mockResolvedValue({
      deleted: true,
      provider: "test",
    });

    await collectExpiredExportArtifacts();

    expect(mocks.deletePrivateBlob).toHaveBeenCalledWith(handle);
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("leaves an expired row for a later retry when blob deletion fails", async () => {
    mocks.selectRows = [
      {
        id: "export-expired-id",
        filename: "deck.html",
        mimeType: "text/html; charset=utf-8",
        expiresAt: "2026-08-27T11:59:00.000Z",
        blobHandle: JSON.stringify(handle),
      },
    ];
    mocks.deletePrivateBlob.mockResolvedValue({
      deleted: false,
      provider: "test",
      reason: "unavailable",
    });

    await expect(collectExpiredExportArtifacts()).rejects.toThrow(
      "Could not delete expired export artifact export-expired-id",
    );
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });
});
