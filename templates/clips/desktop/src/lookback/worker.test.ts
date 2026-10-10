import { afterEach, describe, expect, it, vi } from "vitest";

import { ClipsActionError } from "../lib/clips-action";
import {
  getRecordingContextItem,
  type RecordingContextItem,
  type RecordingContextUpdate,
} from "./context-api";
import { processRecordingContextItem, type LookbackWorkerDeps } from "./worker";

const target = { serverUrl: "https://clips.example.test", authToken: "" };

function item(
  overrides: Partial<RecordingContextItem> = {},
): RecordingContextItem {
  return {
    id: "ctx1",
    recordingId: "rec1",
    kind: "screen_history",
    label: null,
    requestedSeconds: 30,
    originalStartedAt: "2026-10-09T10:00:00.000Z",
    originalEndedAt: "2026-10-09T10:00:00.000Z",
    startedAt: "2026-10-09T09:59:30.000Z",
    endedAt: "2026-10-09T10:00:00.000Z",
    status: "pending",
    mediaRecordingId: null,
    durationMs: null,
    width: null,
    height: null,
    error: null,
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    ...overrides,
  };
}

function fakeDeps(
  overrides: Partial<LookbackWorkerDeps> = {},
): LookbackWorkerDeps & {
  updates: RecordingContextUpdate[];
  trashed: string[];
  created: Array<{ hasAudio: boolean; startedAt: string }>;
} {
  const updates: RecordingContextUpdate[] = [];
  const trashed: string[] = [];
  const created: Array<{ hasAudio: boolean; startedAt: string }> = [];
  return {
    updates,
    trashed,
    created,
    originFor: vi.fn(() => ({
      includeMicrophone: true,
      includeSystemAudio: false,
    })),
    update: vi.fn(async (input: RecordingContextUpdate) => {
      updates.push(input);
      return input;
    }),
    createRecording: vi.fn(
      async (input: { hasAudio: boolean; startedAt: string }) => {
        created.push(input);
        return { id: "media-1", uploadMode: "streaming" as const };
      },
    ),
    uploadWindow: vi.fn(async () => ({
      durationMs: 29_600.4,
      width: 1280,
      height: 720,
    })),
    // By default the claim landed and reserved the footage this worker created.
    currentItem: vi.fn(async () =>
      item({ status: "processing", pendingMediaRecordingId: "media-1" }),
    ),
    trashRecording: vi.fn(async (id: string) => {
      trashed.push(id);
    }),
    ...overrides,
  };
}

describe("processRecordingContextItem", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips items whose footage was captured on another device", async () => {
    const deps = fakeDeps({ originFor: vi.fn(() => null) });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "skipped",
    );
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.createRecording).not.toHaveBeenCalled();
  });

  it("exports the window and marks the item ready with its media", async () => {
    const deps = fakeDeps();

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "ready",
    );
    expect(deps.updates).toEqual([
      { id: "ctx1", status: "processing", mediaRecordingId: "media-1" },
      {
        id: "ctx1",
        status: "ready",
        mediaRecordingId: "media-1",
        durationMs: 29_600,
        width: 1280,
        height: 720,
      },
    ]);
    expect(deps.created).toEqual([
      { hasAudio: true, startedAt: "2026-10-09T09:59:30.000Z" },
    ]);
    // The claim names the recording, so the recording must exist before it.
    const [created] = vi.mocked(deps.createRecording).mock.invocationCallOrder;
    const [claimed] = vi.mocked(deps.update).mock.invocationCallOrder;
    expect(created).toBeLessThan(claimed ?? 0);
    expect(deps.uploadWindow).toHaveBeenCalledWith({
      requestId: "handoff-lookback-ctx1",
      startedAt: "2026-10-09T09:59:30.000Z",
      endedAt: "2026-10-09T10:00:00.000Z",
      recordingId: "media-1",
      uploadMode: "streaming",
      includeMic: true,
      includeSystemAudio: false,
    });
    expect(deps.trashed).toEqual([]);
  });

  it("creates a silent recording when the original had no audio", async () => {
    const deps = fakeDeps({
      originFor: vi.fn(() => ({
        includeMicrophone: false,
        includeSystemAudio: false,
      })),
    });

    await processRecordingContextItem(item(), deps);
    expect(deps.created[0]?.hasAudio).toBe(false);
  });

  it("trashes the previous footage after a re-export succeeds", async () => {
    const deps = fakeDeps();

    await expect(
      processRecordingContextItem(
        item({ status: "pending", mediaRecordingId: "media-old" }),
        deps,
      ),
    ).resolves.toBe("ready");
    expect(deps.trashed).toEqual(["media-old"]);
  });

  it("trashes the new footage and marks the item failed when the upload fails", async () => {
    const deps = fakeDeps({
      uploadWindow: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    await expect(
      processRecordingContextItem(
        item({ status: "pending", mediaRecordingId: "media-old" }),
        deps,
      ),
    ).resolves.toBe("failed");
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.updates.slice(-1)[0]).toEqual({
      id: "ctx1",
      status: "failed",
      error: "disk full",
    });
  });

  it("trashes the new footage and does not upload when another claim owns the item", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "processing") {
          throw new ClipsActionError("Already claimed.", 409);
        }
        return input;
      }),
    });

    await expect(
      processRecordingContextItem(
        item({ mediaRecordingId: "media-old" }),
        deps,
      ),
    ).resolves.toBe("skipped");
    expect(deps.uploadWindow).not.toHaveBeenCalled();
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.update).toHaveBeenCalledTimes(1);
  });

  it("leaves the item pending and trashes its footage when the claim fails for another reason", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "processing") {
          throw new ClipsActionError("Server unavailable.", 503);
        }
        return input;
      }),
      currentItem: vi.fn(async () => item()),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.uploadWindow).not.toHaveBeenCalled();
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.update).toHaveBeenCalledTimes(1);
  });

  it("marks the item failed when the claim landed before its response was lost", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "processing") {
          throw new Error("socket hang up");
        }
        return input;
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.update).toHaveBeenLastCalledWith({
      id: "ctx1",
      status: "failed",
      error: "socket hang up",
    });
  });

  it("claims the item before failing it when creating its footage throws", async () => {
    const deps = fakeDeps({
      createRecording: vi.fn(async () => {
        throw new Error("no disk");
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.updates).toEqual([
      { id: "ctx1", status: "processing" },
      { id: "ctx1", status: "failed", error: "no disk" },
    ]);
    expect(deps.uploadWindow).not.toHaveBeenCalled();
    expect(deps.trashed).toEqual([]);
  });

  it("returns skipped without a failed write when another claim owns the item after its footage failed", async () => {
    const deps = fakeDeps({
      createRecording: vi.fn(async () => {
        throw new Error("no disk");
      }),
      update: vi.fn(async () => {
        throw new ClipsActionError("Already claimed.", 409);
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "skipped",
    );
    expect(deps.update).toHaveBeenCalledTimes(1);
  });

  it("returns failed without a second write when claiming after a footage failure errors otherwise", async () => {
    const deps = fakeDeps({
      createRecording: vi.fn(async () => {
        throw new Error("no disk");
      }),
      update: vi.fn(async () => {
        throw new ClipsActionError("Server unavailable.", 503);
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.update).toHaveBeenCalledTimes(1);
  });

  it("trashes its footage and skips without marking the item failed when the ready write is rejected with 409", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "ready") {
          throw new ClipsActionError("Footage is not reserved.", 409);
        }
        return input;
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "skipped",
    );
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.currentItem).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("keeps its footage and reports ready when the ready write committed before its response was lost", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "ready") throw new Error("socket hang up");
        return input;
      }),
      currentItem: vi.fn(async () =>
        item({
          status: "ready",
          mediaRecordingId: "media-1",
          durationMs: 29_600,
          width: 1280,
          height: 720,
        }),
      ),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "ready",
    );
    expect(deps.trashed).toEqual([]);
    expect(deps.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("never trashes footage the item links, even when the item has since moved on", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "ready") throw new Error("socket hang up");
        return input;
      }),
      currentItem: vi.fn(async () =>
        item({ status: "pending", mediaRecordingId: "media-1" }),
      ),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "skipped",
    );
    expect(deps.trashed).toEqual([]);
    expect(deps.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("keeps its footage and writes nothing when the item cannot be read back", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "ready") throw new Error("socket hang up");
        return input;
      }),
      currentItem: vi.fn(async () => {
        throw new Error("read offline");
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.trashed).toEqual([]);
    // The claim and the rejected ready write only. Nothing is written blind.
    expect(deps.update).toHaveBeenCalledTimes(2);
  });

  it("keeps its footage without trashing it when the read throws after an upload fails", async () => {
    const deps = fakeDeps({
      uploadWindow: vi.fn(async () => {
        throw new Error("network down");
      }),
      currentItem: vi.fn(async () => {
        throw new Error("read offline");
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.trashed).toEqual([]);
    expect(deps.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("trashes its footage and skips without a failed write when the read finds the item absent", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "ready") throw new Error("socket hang up");
        return input;
      }),
      currentItem: vi.fn(async () => null),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "skipped",
    );
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("treats a recording_not_found 404 from the context read as an absent item and trashes its footage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Recording not found.",
              errorCode: "recording_not_found",
            }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "ready") throw new Error("socket hang up");
        return input;
      }),
      currentItem: (recordingId, itemId) =>
        getRecordingContextItem(target, recordingId, itemId),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "skipped",
    );
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("ignores a 409 when recording a failure the item has already moved past", async () => {
    const deps = fakeDeps({
      uploadWindow: vi.fn(async () => {
        throw new Error("disk full");
      }),
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "failed") {
          throw new ClipsActionError("Cannot move.", 409);
        }
        return input;
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.trashed).toEqual(["media-1"]);
  });

  it("treats a rejected ready write as a failed export and cleans up its media", async () => {
    const deps = fakeDeps({
      update: vi.fn(async (input: RecordingContextUpdate) => {
        if (input.status === "ready") throw new Error("server 500");
        return input;
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.trashed).toEqual(["media-1"]);
    expect(deps.update).toHaveBeenLastCalledWith({
      id: "ctx1",
      status: "failed",
      error: "server 500",
    });
  });

  it("never sends an empty or non-Error failure as the error text", async () => {
    const empty = fakeDeps({
      uploadWindow: vi.fn(async () => {
        throw new Error("");
      }),
    });
    await processRecordingContextItem(item(), empty);
    expect(empty.updates.slice(-1)[0]?.error).toBe(
      "Earlier screen time couldn't be saved.",
    );

    const thrown = fakeDeps({
      uploadWindow: vi.fn(async () => {
        throw "boom";
      }),
    });
    await processRecordingContextItem(item(), thrown);
    expect(thrown.updates.slice(-1)[0]?.error).toBe(
      "Earlier screen time couldn't be saved.",
    );
  });

  it("still marks the item failed when cleaning up the media also fails", async () => {
    const deps = fakeDeps({
      uploadWindow: vi.fn(async () => {
        throw new Error("network down");
      }),
      trashRecording: vi.fn(async () => {
        throw new Error("trash offline");
      }),
    });

    await expect(processRecordingContextItem(item(), deps)).resolves.toBe(
      "failed",
    );
    expect(deps.updates.slice(-1)[0]).toEqual({
      id: "ctx1",
      status: "failed",
      error: "network down",
    });
  });
});
