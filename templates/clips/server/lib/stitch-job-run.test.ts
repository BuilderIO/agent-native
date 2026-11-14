import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
  resolveStorage: vi.fn(),
  claim: vi.fn(),
  renew: vi.fn(),
  settle: vi.fn(),
  plan: vi.fn(),
  dbUpdate: vi.fn(),
  sources: [] as Array<Record<string, unknown>>,
}));

vi.mock("./public-agent-context.js", () => ({
  fetchRecordingMediaResponse: (...args: unknown[]) =>
    mocks.fetchMedia(...args),
  loadRecordingMediaBytes: vi.fn(),
}));

vi.mock("./video-storage.js", () => ({
  resolveClipsVideoStorage: (...args: unknown[]) =>
    mocks.resolveStorage(...args),
}));

vi.mock("./recording-media-lifecycle.js", () => ({
  withRecordingMediaProduction: (_input: unknown, work: () => unknown) =>
    work(),
}));

vi.mock("./video-remux.js", async (original) => ({
  ...(await original<typeof import("./video-remux.js")>()),
  isFfmpegAvailable: () => true,
}));

vi.mock("./post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(async () => {}),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => {}),
}));

vi.mock("./stitch-job-store.js", async (original) => ({
  ...(await original<typeof import("./stitch-job-store.js")>()),
  claimStitchJob: (...args: unknown[]) => mocks.claim(...args),
  renewStitchLease: (...args: unknown[]) => mocks.renew(...args),
  settleStitchJob: (...args: unknown[]) => mocks.settle(...args),
  planStitchRecovery: (...args: unknown[]) => mocks.plan(...args),
  pruneSettledStitchJobs: async () => 0,
}));

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return {
    schema,
    getDb: () => ({
      select: () => ({
        from: () => ({ where: async () => mocks.sources }),
      }),
      update: (...args: unknown[]) => {
        mocks.dbUpdate(...args);
        return { set: () => ({ where: async () => [] }) };
      },
    }),
  };
});

import { STITCH_LEASE_RENEW_MS } from "./stitch-job-store.js";
import {
  downloadStitchSource,
  resolveStitchDestinationProvider,
  runDurableStitchJob,
  StitchLimitError,
  uploadStitchedFile,
} from "./stitch-job.js";

function bodyResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers },
  );
}

/** A response whose body never sends a byte until the request is aborted. */
function hangingResponse(signal: AbortSignal): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (signal.aborted) controller.error(signal.reason);
        signal.addEventListener("abort", () => controller.error(signal.reason));
      },
    }),
  );
}

const recording = {
  id: "src-1",
  title: "Source one",
  videoUrl: "https://storage.example/clips/src-1.mp4",
  storageMode: "own" as const,
  videoSizeBytes: 10,
};

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), "stitch-run-test-"));
  mocks.sources = [];
  mocks.plan.mockResolvedValue({ dispatch: [], exhausted: [], orphaned: [] });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe("source downloads", () => {
  it("streams a source to disk and charges it to the stitch budget", async () => {
    mocks.fetchMedia.mockResolvedValue(
      bodyResponse([new Uint8Array(4), new Uint8Array(6)]),
    );
    const budget = { remaining: 100 };
    const path = join(dir, "a.mp4");
    await expect(downloadStitchSource(recording, path, budget)).resolves.toBe(
      10,
    );
    expect((await stat(path)).size).toBe(10);
    expect(budget.remaining).toBe(90);
    // A whole-transfer budget instead of the 30-second default.
    expect(mocks.fetchMedia).toHaveBeenCalledWith(
      recording.videoUrl,
      expect.objectContaining({
        recordingId: "src-1",
        timeoutMs: 30 * 60_000,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("refuses a source whose declared size is over its limit", async () => {
    mocks.fetchMedia.mockResolvedValue(
      bodyResponse([new Uint8Array(4)], { "content-length": "50" }),
    );
    await expect(
      downloadStitchSource(
        recording,
        join(dir, "a.mp4"),
        { remaining: 1_000 },
        {
          perSourceLimit: 20,
        },
      ),
    ).rejects.toThrow(StitchLimitError);
  });

  it("stops a source that grows past the stitch's remaining budget", async () => {
    mocks.fetchMedia.mockResolvedValue(
      bodyResponse([new Uint8Array(8), new Uint8Array(8)]),
    );
    const budget = { remaining: 12 };
    await expect(
      downloadStitchSource(recording, join(dir, "a.mp4"), budget, {
        perSourceLimit: 1_000,
      }),
    ).rejects.toThrow(/add up to more than/);
    expect(budget.remaining).toBe(12);
  });

  it("stops a download that stops sending data", async () => {
    mocks.fetchMedia.mockImplementation(
      async (_url: string, options: { signal: AbortSignal }) =>
        hangingResponse(options.signal),
    );
    await expect(
      downloadStitchSource(
        recording,
        join(dir, "a.mp4"),
        { remaining: 1_000 },
        { stallMs: 50 },
      ),
    ).rejects.toThrow(/stopped sending data/);
  });
});

describe("destination storage", () => {
  it("uploads with the provider the destination recording resolves to", async () => {
    const provider = { id: "s3", name: "S3" };
    mocks.resolveStorage.mockResolvedValue({ mode: "own", provider });
    await expect(
      resolveStitchDestinationProvider({
        recordingId: "dest",
        ownerEmail: "owner@example.com",
        expectedProviderId: "s3",
      }),
    ).resolves.toBe(provider);
    expect(mocks.resolveStorage).toHaveBeenCalledWith({
      intent: "existing",
      recordingId: "dest",
      email: "owner@example.com",
    });
  });

  it("refuses when the storage changed or is hosted", async () => {
    mocks.resolveStorage.mockResolvedValueOnce({
      mode: "own",
      provider: { id: "builder" },
    });
    await expect(
      resolveStitchDestinationProvider({
        recordingId: "dest",
        ownerEmail: "owner@example.com",
        expectedProviderId: "s3",
      }),
    ).rejects.toThrow(/storage changed/);
    mocks.resolveStorage.mockResolvedValueOnce({
      mode: "hosted",
      provider: { id: "clips-hosted" },
    });
    await expect(
      resolveStitchDestinationProvider({
        recordingId: "dest",
        ownerEmail: "owner@example.com",
        expectedProviderId: null,
      }),
    ).rejects.toThrow(/hosted Clips storage/);
  });
});

describe("uploads", () => {
  it("gives up on a part the provider never accepts and aborts the upload", async () => {
    const path = join(dir, "out.mp4");
    await writeFile(path, new Uint8Array(1024));
    const abortSession = vi.fn(async () => {});
    const provider = {
      id: "s3",
      name: "S3",
      resumable: {
        startSession: vi.fn(async () => ({ meta: {} })),
        relayChunk: vi.fn(() => new Promise(() => {})),
        completeSession: vi.fn(),
        abortSession,
      },
    };
    await expect(
      uploadStitchedFile({
        recordingId: "dest",
        ownerEmail: "owner@example.com",
        path,
        sizeBytes: 1024,
        provider: provider as never,
        partTimeoutMs: 30,
      }),
    ).rejects.toThrow(/did not accept part 1/);
    expect(abortSession).toHaveBeenCalledTimes(1);
    expect(provider.resumable.completeSession).not.toHaveBeenCalled();
  });

  it("refuses to buffer a large video for a provider without multipart upload", async () => {
    const upload = vi.fn();
    await expect(
      uploadStitchedFile({
        recordingId: "dest",
        ownerEmail: "owner@example.com",
        path: join(dir, "missing.mp4"),
        sizeBytes: 300 * 1024 * 1024,
        provider: { id: "custom", name: "Custom", upload } as never,
      }),
    ).rejects.toThrow(StitchLimitError);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("durable runner", () => {
  const job = {
    recordingId: "dest",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    sourceIdsJson: JSON.stringify(["src-1", "src-2"]),
    storageProviderId: "s3",
    state: "running",
    attempts: 1,
  };

  it("skips a job another worker holds", async () => {
    mocks.claim.mockResolvedValue({ claimed: false, reason: "leased" });
    await expect(runDurableStitchJob("dest")).resolves.toEqual({
      status: "skipped",
      reason: "leased",
    });
    expect(mocks.fetchMedia).not.toHaveBeenCalled();
  });

  it("fails a job whose attempts are used up", async () => {
    mocks.claim.mockResolvedValue({ claimed: false, reason: "exhausted" });
    mocks.settle.mockResolvedValue(true);
    await expect(runDurableStitchJob("dest")).resolves.toMatchObject({
      status: "failed",
    });
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: "dest", state: "failed" }),
    );
    expect(mocks.dbUpdate).toHaveBeenCalled();
  });

  it("stops the stitch and leaves the recording alone once the lease is lost", async () => {
    // Only the lease heartbeat runs on fake time; file and stream work stays real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mocks.claim.mockResolvedValue({ claimed: true, token: "t-1", job });
    mocks.sources = [
      {
        id: "src-1",
        title: "One",
        status: "ready",
        videoUrl: "https://storage.example/clips/src-1.mp4",
        videoFormat: "mp4",
        videoSizeBytes: 10,
      },
      {
        id: "src-2",
        title: "Two",
        status: "ready",
        videoUrl: "https://storage.example/clips/src-2.mp4",
        videoFormat: "mp4",
        videoSizeBytes: 10,
      },
    ];
    mocks.resolveStorage.mockResolvedValue({
      mode: "own",
      provider: { id: "s3" },
    });
    // The download hangs (and keeps refreshing its stall timer) until the
    // stitch is stopped.
    mocks.fetchMedia.mockImplementation(
      async (_url: string, options: { signal: AbortSignal }) =>
        hangingResponse(options.signal),
    );
    // Another worker took the job over.
    mocks.renew.mockResolvedValue(false);

    const run = runDurableStitchJob("dest");
    // Once the first source download is under way, the next heartbeat finds
    // the lease gone.
    await vi.waitFor(() => expect(mocks.fetchMedia).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(STITCH_LEASE_RENEW_MS + 10);

    await expect(run).resolves.toEqual({ status: "lost" });
    expect(mocks.renew).toHaveBeenCalledWith("dest", "t-1");
    // Neither the job nor the recording is touched: they belong to the
    // worker that holds the lease now.
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("does not fail the recording when the job was taken over before it failed", async () => {
    mocks.claim.mockResolvedValue({ claimed: true, token: "t-1", job });
    mocks.sources = []; // the sources are gone, so the stitch fails
    mocks.settle.mockResolvedValue(false);
    await expect(runDurableStitchJob("dest")).resolves.toEqual({
      status: "lost",
    });
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ token: "t-1", state: "failed" }),
    );
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("marks the recording failed when it still holds the job", async () => {
    mocks.claim.mockResolvedValue({ claimed: true, token: "t-1", job });
    mocks.sources = [];
    mocks.settle.mockResolvedValue(true);
    await expect(runDurableStitchJob("dest")).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/Not all source recordings/),
    });
    expect(mocks.dbUpdate).toHaveBeenCalledTimes(1);
  });
});
