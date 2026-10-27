import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetResumableSession = vi.hoisted(() => vi.fn());
const mockDeleteResumableSession = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockResolveProvider = vi.hoisted(() => vi.fn());
const mockAbortSession = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
}));
vi.mock("./resumable-session.js", () => ({
  getResumableSession: (...args: unknown[]) => mockGetResumableSession(...args),
  deleteResumableSession: (...args: unknown[]) =>
    mockDeleteResumableSession(...args),
}));
vi.mock("./resumable-upload-provider.js", () => ({
  resolveResumableUploadProvider: (...args: unknown[]) =>
    mockResolveProvider(...args),
}));

import { abortRecordingResumableSession } from "./resumable-upload-cleanup";

const session = {
  providerId: "clips-hosted",
  sessionId: "upload-1",
  meta: { objectKey: "clips/rec_1.webm" },
  bytesUploaded: 10,
};

describe("abortRecordingResumableSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockGetResumableSession.mockResolvedValue(session);
    mockReadAppState.mockResolvedValue({ status: "uploading" });
    mockAbortSession.mockResolvedValue(undefined);
    mockResolveProvider.mockResolvedValue({
      resumable: { abortSession: mockAbortSession },
    });
  });

  it("has nothing to clean when the recording has no session", async () => {
    mockGetResumableSession.mockResolvedValue(null);

    await expect(
      abortRecordingResumableSession("rec_1", null, {
        hasPersistedMediaUrl: false,
      }),
    ).resolves.toEqual({ ok: true });
    expect(mockAbortSession).not.toHaveBeenCalled();
  });

  it("aborts an in-flight upload's session and then drops its handle", async () => {
    await expect(
      abortRecordingResumableSession("rec_1", "gen_1", {
        hasPersistedMediaUrl: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(mockAbortSession).toHaveBeenCalledWith({
      sessionId: "upload-1",
      meta: session.meta,
    });
    expect(mockDeleteResumableSession).toHaveBeenCalledWith("rec_1", "gen_1");
  });

  it("keeps the handle and reports failure when the provider cannot abort", async () => {
    mockAbortSession.mockRejectedValue(new Error("provider down"));

    await expect(
      abortRecordingResumableSession("rec_1", null, {
        hasPersistedMediaUrl: false,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
  });

  it("refuses to treat a processing upload with no media URL as cleaned", async () => {
    mockReadAppState.mockResolvedValue({ status: "processing" });

    await expect(
      abortRecordingResumableSession("rec_1", null, {
        hasPersistedMediaUrl: false,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(mockAbortSession).not.toHaveBeenCalled();
    expect(mockDeleteResumableSession).not.toHaveBeenCalled();
  });

  it("aborts a leftover session once the media URL is persisted and deleted", async () => {
    mockReadAppState.mockResolvedValue({ status: "processing" });

    await expect(
      abortRecordingResumableSession("rec_1", null, {
        hasPersistedMediaUrl: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(mockAbortSession).toHaveBeenCalled();
  });
});
