import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./recording-backup", () => ({
  getRecordingBackupMeta: vi.fn(),
  getRecordingBackupChunks: vi.fn(),
  deleteRecordingBackup: vi.fn(async () => {}),
}));

import {
  deleteRecordingBackup,
  getRecordingBackupChunks,
  getRecordingBackupMeta,
} from "./recording-backup";
import { retryRecordingUploadFromBackup } from "./recording-retry";

const meta = {
  recordingId: "rec-1",
  mimeType: "video/webm",
  durationMs: 5_000,
  width: 1280,
  height: 720,
  hasAudio: true,
  hasCamera: false,
  bytes: 30,
  chunkCount: 2,
  savedAt: new Date().toISOString(),
};

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
      new Blob(["a"]),
      new Blob(["b"]),
    ]);

    const requests: Array<{ url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        requests.push({ url });
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
    expect(requests[1]?.url).toContain("index=0");
    expect(requests[1]?.url).toContain("uploadGenerationId=gen-1");
    expect(requests[2]?.url).toContain("index=1");
    expect(requests[2]?.url).toContain("isFinal=1");
    expect(result).toEqual({ status: "ready", videoUrl: "u" });
    expect(deleteRecordingBackup).toHaveBeenCalledWith("rec-1");
  });

  it("keeps the local backup when the retry lands in processing/verification", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue(meta);
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([new Blob(["a"])]);
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

  it("throws with the server error when reset-chunks fails", async () => {
    vi.mocked(getRecordingBackupMeta).mockResolvedValue(meta);
    vi.mocked(getRecordingBackupChunks).mockResolvedValue([new Blob(["a"])]);
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
