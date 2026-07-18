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
import { callClipsAction, syncCaptureJob } from "./clips-api";

describe("mobile Clips action client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps POST as the default action method", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ result: { ok: true } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callClipsAction("add-comment", { content: "Nice" }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clips.agent-native.com/_agent-native/actions/add-comment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "Nice" }),
      }),
    );
  });

  it("encodes GET action params without putting a token in the URL", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ result: { recordings: [] } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callClipsAction(
      "list-recordings",
      {
        view: "library",
        tags: ["product", "demo"],
        empty: undefined,
      },
      { method: "GET" },
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/_agent-native/actions/list-recordings");
    expect(parsed.searchParams.get("view")).toBe("library");
    expect(parsed.searchParams.getAll("tags[]")).toEqual(["product", "demo"]);
    expect(parsed.searchParams.has("empty")).toBe(false);
    expect(parsed.search).not.toContain("test-token");
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        body: undefined,
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("sends DELETE action params in an authenticated JSON body", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ result: { id: "vocab_1" } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callClipsAction(
      "remove-vocabulary-term",
      { id: "vocab_1" },
      { method: "DELETE" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clips.agent-native.com/_agent-native/actions/remove-vocabulary-term",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ id: "vocab_1" }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});

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

  it("exhausts a retryable capture after the configured attempt ceiling", async () => {
    const job = await enqueueCaptureJob({
      id: "exhausted-mobile-upload",
      localUri: "file:///capture.mp4",
      kind: "video",
      durationMs: 1_000,
      mimeType: "video/mp4",
      title: "Capture",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("Offline"))),
    );

    const result = await syncCaptureJob(job.id, {
      force: true,
      maxAttempts: 1,
    });

    expect(result.status).toBe("exhausted");
    expect(result.job.state).toBe("exhausted");
    expect(result.job.resume.retryable).toBe(false);
  });
});
