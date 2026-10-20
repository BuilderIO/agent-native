import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ storageMode: "own" | "hosted" | null }>,
  uploadFile: vi.fn(),
  hostedUpload: vi.fn(),
  deleteHosted: vi.fn(),
  addAllowance: vi.fn(),
  accountAdditionalAllowance: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  ownerEmailMatches: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getAppConfig: () => ({ clips: { hostedStorage: { maxClipBytes: 1024 } } }),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => mocks.and(...args),
  eq: (...args: unknown[]) => mocks.eq(...args),
}));
vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        limit: async () => mocks.rows,
      };
      return query;
    },
  }),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      storageMode: "recordings.storageMode",
    },
  },
}));
vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (...args: unknown[]) => mocks.ownerEmailMatches(...args),
}));
vi.mock("./s3-upload-provider.js", () => ({
  deleteS3ObjectByUrl: (...args: unknown[]) => mocks.deleteHosted(...args),
  clipsHostedFileUploadProvider: {
    upload: (...args: unknown[]) => mocks.hostedUpload(...args),
  },
}));
vi.mock("./video-storage.js", () => ({
  accountHostedClipAdditionalRecordingBytes: (...args: unknown[]) =>
    mocks.accountAdditionalAllowance(...args),
  addHostedClipRecordingBytes: (...args: unknown[]) =>
    mocks.addAllowance(...args),
}));

import {
  HostedDerivativeTooLargeError,
  uploadRecordingMedia,
} from "./upload-recording-media.js";

describe("uploadRecordingMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [{ storageMode: null }];
    mocks.uploadFile.mockResolvedValue({
      url: "https://files.example.com/media.jpg",
      provider: "builder",
    });
    mocks.hostedUpload.mockResolvedValue({
      url: "https://clips.example.com/media.jpg",
      provider: "clips-hosted",
    });
    mocks.addAllowance.mockResolvedValue({
      ok: true,
      allowance: { quotaBytes: 10 },
    });
    mocks.accountAdditionalAllowance.mockResolvedValue({
      ok: true,
      allowance: { quotaBytes: 10 },
    });
    mocks.deleteHosted.mockResolvedValue(true);
  });

  it("keeps nullable legacy recordings on the active user provider", async () => {
    const input = {
      recordingId: "recording-1",
      ownerEmail: "owner@example.com",
      data: new Uint8Array([1, 2, 3]),
      filename: "thumb-recording-1.jpg",
      mimeType: "image/jpeg",
      recordAsset: false,
    };

    await uploadRecordingMedia(input);

    expect(mocks.uploadFile).toHaveBeenCalledWith({
      data: input.data,
      filename: input.filename,
      mimeType: input.mimeType,
      ownerEmail: input.ownerEmail,
      recordAsset: false,
    });
    expect(mocks.hostedUpload).not.toHaveBeenCalled();
  });

  it("uses the pinned hosted provider and recording-scoped object names", async () => {
    mocks.rows = [{ storageMode: "hosted" }];

    await uploadRecordingMedia({
      recordingId: "recording-1",
      ownerEmail: "owner@example.com",
      data: new Uint8Array([1, 2, 3]),
      filename: "thumb-recording-1.jpeg",
      mimeType: "image/jpeg",
      stableUrl: true,
      recordAsset: false,
    });

    expect(mocks.hostedUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "recording-1.jpeg",
        ownerEmail: "owner@example.com",
        mimeType: "image/jpeg",
      }),
    );
    expect(mocks.addAllowance).toHaveBeenCalledWith({
      recordingId: "recording-1",
      ownerEmail: "owner@example.com",
      additionalBytes: 3,
    });
    expect(mocks.hostedUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addAllowance.mock.invocationCallOrder[0],
    );
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects a hosted derivative above the per-clip limit before uploading", async () => {
    mocks.rows = [{ storageMode: "hosted" }];

    await expect(
      uploadRecordingMedia({
        recordingId: "recording-1",
        ownerEmail: "owner@example.com",
        data: new Uint8Array(1025),
        filename: "thumb-recording-1.jpeg",
        mimeType: "image/jpeg",
        recordAsset: false,
      }),
    ).rejects.toBeInstanceOf(HostedDerivativeTooLargeError);

    expect(mocks.hostedUpload).not.toHaveBeenCalled();
    expect(mocks.addAllowance).not.toHaveBeenCalled();
  });

  it("deletes an over-cap derivative through the pinned hosted provider", async () => {
    mocks.rows = [{ storageMode: "hosted" }];
    mocks.addAllowance.mockResolvedValue({
      ok: false,
      reason: "global_storage_cap",
    });

    await expect(
      uploadRecordingMedia({
        recordingId: "recording-1",
        ownerEmail: "owner@example.com",
        data: new Uint8Array([1, 2, 3]),
        filename: "poster.jpg",
      }),
    ).rejects.toThrow(/storage is full.*derivative was removed/i);

    expect(mocks.deleteHosted).toHaveBeenCalledWith(
      "https://clips.example.com/media.jpg",
      { storageMode: "hosted", recordingId: "recording-1" },
    );
    expect(mocks.accountAdditionalAllowance).not.toHaveBeenCalled();
  });

  it("accounts an over-cap derivative if hosted cleanup cannot confirm deletion", async () => {
    mocks.rows = [{ storageMode: "hosted" }];
    mocks.addAllowance.mockResolvedValue({
      ok: false,
      reason: "global_storage_cap",
    });
    mocks.deleteHosted.mockResolvedValue(false);

    await expect(
      uploadRecordingMedia({
        recordingId: "recording-1",
        ownerEmail: "owner@example.com",
        data: new Uint8Array([1, 2, 3]),
        filename: "poster.jpg",
      }),
    ).rejects.toThrow(/could not be deleted.*recorded conservatively/i);

    expect(mocks.accountAdditionalAllowance).toHaveBeenCalledWith({
      recordingId: "recording-1",
      ownerEmail: "owner@example.com",
      additionalBytes: 3,
    });
  });

  it("cleans up and preserves byte accounting when the atomic write throws", async () => {
    mocks.rows = [{ storageMode: "hosted" }];
    mocks.addAllowance.mockRejectedValue(new Error("ledger unavailable"));
    mocks.deleteHosted.mockResolvedValue(false);

    await expect(
      uploadRecordingMedia({
        recordingId: "recording-1",
        ownerEmail: "owner@example.com",
        data: new Uint8Array([1, 2, 3]),
        filename: "poster.jpg",
      }),
    ).rejects.toThrow(
      /accounting failed: ledger unavailable.*recorded conservatively/i,
    );

    expect(mocks.deleteHosted).toHaveBeenCalledWith(
      "https://clips.example.com/media.jpg",
      { storageMode: "hosted", recordingId: "recording-1" },
    );
    expect(mocks.accountAdditionalAllowance).toHaveBeenCalledWith({
      recordingId: "recording-1",
      ownerEmail: "owner@example.com",
      additionalBytes: 3,
    });
  });

  it("fails loudly when the recording row cannot be found", async () => {
    mocks.rows = [];

    await expect(
      uploadRecordingMedia({
        recordingId: "missing",
        ownerEmail: "owner@example.com",
        data: new Uint8Array([1]),
      }),
    ).rejects.toThrow("Recording not found: missing");
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.hostedUpload).not.toHaveBeenCalled();
  });
});
