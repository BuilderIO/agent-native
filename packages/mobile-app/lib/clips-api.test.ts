// @ts-expect-error Vitest is provided by the repository test workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

vi.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: "read-only" },
  File: class {
    exists = true;
    size = 4;

    open() {
      let offset = 0;
      return {
        get offset() {
          return offset;
        },
        set offset(value: number) {
          offset = value;
        },
        readBytes(length: number) {
          offset += length;
          return new Uint8Array(length);
        },
        close() {},
      };
    }
  },
}));

vi.mock("./clips-session", () => ({
  getClipsSession: vi.fn(async () => ({
    token: "test-token",
    ownerKey: "test-owner",
  })),
  clearClipsSession: vi.fn(async () => {}),
}));

vi.mock("./persist-capture", () => ({
  removePersistedCaptureFile: vi.fn(),
}));

import {
  enqueueCaptureJob,
  markCaptureJobFailed,
  updateCaptureJobResume,
} from "./capture-queue";
import { syncCaptureJob } from "./clips-api";

describe("mobile Clips upload recovery", () => {
  beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  it("resets a failed remote recording and restarts from the first chunk", async () => {
    const job = await enqueueCaptureJob({
      id: "failed-mobile-upload",
      localUri: "file:///capture.mp4",
      kind: "video",
      durationMs: 1_000,
      mimeType: "video/mp4",
      title: "Capture",
    });
    await updateCaptureJobResume(job.id, {
      recordingId: "remote-recording",
      uploadChunkUrl: "/api/uploads/remote-recording/chunk",
      uploadMode: "buffered",
      uploadMimeType: "video/mp4",
      fileSizeBytes: 4,
      chunkSizeBytes: 2,
      totalChunks: 2,
      nextChunkIndex: 1,
      uploadedBytes: 2,
    });
    await markCaptureJobFailed(job.id, "Remote processing failed", {
      retryable: true,
    });

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/status")) {
          return new Response(
            JSON.stringify({
              recording: {
                id: "remote-recording",
                status: "failed",
                verificationPending: false,
              },
            }),
          );
        }
        if (url.endsWith("/reset-chunks")) {
          return new Response(
            JSON.stringify({ ok: true, uploadMode: "buffered" }),
          );
        }
        const chunkIndex = new URL(url).searchParams.get("index");
        return new Response(
          JSON.stringify({
            ok: true,
            finalized: chunkIndex === "1",
            index: Number(chunkIndex),
            bytes: 2,
            ...(chunkIndex === "1"
              ? { status: "ready", videoUrl: "https://clips.test/video" }
              : {}),
          }),
        );
      }),
    );

    const result = await syncCaptureJob(job.id, {
      force: true,
      chunkSizeBytes: 2,
    });

    expect(result.status).toBe("completed");
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/api/uploads/remote-recording/status",
      "/api/uploads/remote-recording/reset-chunks",
      "/api/uploads/remote-recording/chunk",
      "/api/uploads/remote-recording/chunk",
    ]);
    expect(new URL(requests[2]!.url).searchParams.get("index")).toBe("0");
    expect(new URL(requests[3]!.url).searchParams.get("index")).toBe("1");
    expect(requests[1]!.init?.body).toBe(
      JSON.stringify({ requestStreaming: true, mimeType: "video/mp4" }),
    );
  });
});
