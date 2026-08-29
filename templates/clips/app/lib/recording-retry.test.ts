import { UPLOAD_SLICE_BYTES } from "@shared/recording-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./recording-backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recording-backup")>();
  return {
    ...actual,
    getRecordingBackupMeta: vi.fn(),
    getRecordingBackupChunks: vi.fn(),
    deleteRecordingBackup: vi.fn(async () => {}),
  };
});

import {
  deleteRecordingBackup,
  getRecordingBackupChunks,
  getRecordingBackupMeta,
} from "./recording-backup";
import { retryRecordingUploadFromBackup } from "./recording-retry";

const savedAt = new Date().toISOString();
const meta = {
  recordingId: "rec-1",
  mimeType: "video/webm",
  durationMs: 5_000,
  width: 1280,
  height: 720,
  hasAudio: true,
  hasCamera: false,
  bytes: 2,
  chunkCount: 2,
  savedAt,
  completedAt: savedAt,
};

function backupChunk(index: number, contents: BlobPart) {
  const blob = new Blob([contents]);
  return {
    recordingId: "rec-1",
    index,
    blob,
    bytes: blob.size,
    createdAt: savedAt,
  };
}

describe("retryRecordingUploadFromBackup", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { pathname: "/" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("throws when this browser has no local backup for the recording", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue(null);
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([]);

    await expect(retryRecordingUploadFromBackup("rec-1")).rejects.toThrow(
      /can only be retried from the device/,
    );
  });

  it("resets, replays chunks in order, and deletes the backup once ready", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue(meta);
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([
      backupChunk(0, "a"),
      backupChunk(1, "b"),
    ]);

    const requests: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        const body =
          init?.body instanceof ArrayBuffer
            ? new TextDecoder().decode(init.body)
            : "";
        requests.push({ url, body });
        if (url.endsWith("/reset-chunks")) {
          return new Response(JSON.stringify({ uploadGenerationId: "gen-1" }), {
            status: 200,
          });
        }
        const isFinal = url.includes("isFinal=1");
        return new Response(
          JSON.stringify(isFinal ? { status: "ready", videoUrl: "u" } : {}),
          { status: 200 },
        );
      }),
    );

    const result = await retryRecordingUploadFromBackup("rec-1");

    expect(requests[0]?.url).toContain("/reset-chunks");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain("index=0");
    expect(requests[1]?.url).toContain("uploadGenerationId=gen-1");
    expect(requests[1]?.url).toContain("isFinal=1");
    expect(requests[1]?.body).toBe("ab");
    expect(result).toEqual({ status: "ready", videoUrl: "u" });
    expect(deleteRecordingBackup).toHaveBeenCalledWith("rec-1");
  });

  it("keeps the local backup when the retry lands in processing/verification", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue({
      ...meta,
      bytes: 1,
      chunkCount: 1,
    });
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([
      backupChunk(0, "a"),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url.endsWith("/reset-chunks")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(JSON.stringify({ status: "processing" }), {
          status: 202,
        });
      }),
    );

    const result = await retryRecordingUploadFromBackup("rec-1");

    expect(result.status).toBe("processing");
    expect(deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("rejects a backup that capture never marked complete", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue({
      ...meta,
      completedAt: null,
    });
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([
      backupChunk(0, "a"),
      backupChunk(1, "b"),
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(retryRecordingUploadFromBackup("rec-1")).rejects.toThrow(
      /backup is incomplete/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-contiguous backup before resetting the server", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue(meta);
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([
      backupChunk(0, "a"),
      backupChunk(2, "b"),
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(retryRecordingUploadFromBackup("rec-1")).rejects.toThrow(
      /backup is incomplete/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("splits a large saved blob into server-supported upload slices", async () => {
    const blob = new Blob([new Uint8Array(UPLOAD_SLICE_BYTES + 1)]);
    vi.mocked(getRecordingBackupMeta).mockResolvedValue({
      ...meta,
      bytes: blob.size,
      chunkCount: 1,
    });
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([
      backupChunk(0, blob),
    ]);

    const chunkRequests: Array<{ url: string; bytes: number }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith("/reset-chunks")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        const body = init?.body;
        chunkRequests.push({
          url,
          bytes: body instanceof ArrayBuffer ? body.byteLength : -1,
        });
        return new Response(
          JSON.stringify(url.includes("isFinal=1") ? { status: "ready" } : {}),
          { status: 200 },
        );
      }),
    );

    await retryRecordingUploadFromBackup("rec-1");

    expect(chunkRequests).toHaveLength(2);
    expect(chunkRequests[0]).toMatchObject({ bytes: UPLOAD_SLICE_BYTES });
    expect(chunkRequests[0]?.url).toContain("total=2");
    expect(chunkRequests[1]).toMatchObject({ bytes: 1 });
    expect(chunkRequests[1]?.url).toContain("isFinal=1");
  });

  it("throws with the server error when reset-chunks fails", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue({
      ...meta,
      bytes: 1,
      chunkCount: 1,
    });
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([
      backupChunk(0, "a"),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("still verifying", {
            status: 409,
            statusText: "Conflict",
          }),
      ),
    );

    await expect(retryRecordingUploadFromBackup("rec-1")).rejects.toThrow(
      /reset-chunks 409/,
    );
  });
});
