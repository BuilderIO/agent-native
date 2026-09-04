import { afterEach, describe, expect, it, vi } from "vitest";

import { RecorderEngine } from "./recorder-engine";

describe("RecorderEngine recovery backup cleanup", () => {
  it("retains local recovery data until the server confirms ready", () => {
    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
    });
    const localChunk = new Blob(["recording"]);
    const finalizeMeta = {
      durationMs: 1_000,
      dimensions: { width: 1280, height: 720 },
      hasAudio: true,
      hasCamera: false,
    };
    const clearRecordingBackup = vi.fn();
    const internals = engine as unknown as {
      localChunks: Blob[];
      lastFinalizeMeta: typeof finalizeMeta | null;
      clearRecordingBackup: () => void;
      clearRecordingDataIfReady: (
        result: Record<string, unknown> | undefined,
      ) => void;
    };
    internals.localChunks = [localChunk];
    internals.lastFinalizeMeta = finalizeMeta;
    internals.clearRecordingBackup = clearRecordingBackup;

    internals.clearRecordingDataIfReady({ status: "processing" });

    expect(internals.localChunks).toEqual([localChunk]);
    expect(internals.lastFinalizeMeta).toBe(finalizeMeta);
    expect(clearRecordingBackup).not.toHaveBeenCalled();

    internals.clearRecordingDataIfReady({ status: "ready" });

    expect(internals.localChunks).toEqual([]);
    expect(internals.lastFinalizeMeta).toBeNull();
    expect(clearRecordingBackup).toHaveBeenCalledOnce();
  });
});

describe("RecorderEngine upload generation fencing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries each reset generation through chunks and the next reset", async () => {
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      location: { pathname: "/" },
    });
    const requests: Array<{ url: string; body: unknown }> = [];
    let resetCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith("/reset-chunks")) {
          resetCount += 1;
          requests.push({
            url,
            body: JSON.parse(typeof init?.body === "string" ? init.body : ""),
          });
          return Response.json({
            uploadMode: "buffered",
            uploadGenerationId: `generation-${resetCount}`,
          });
        }
        requests.push({ url, body: init?.body });
        return Response.json({ ok: true });
      }),
    );

    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
      uploadUrl: "/api/uploads/rec-1/chunk",
      abortUrl: "/api/uploads/rec-1/abort",
    });
    const internals = engine as unknown as {
      resetUploadedChunks: (compression: null) => Promise<"buffered">;
      uploadChunk: (blob: Blob, index: number) => Promise<unknown>;
    };

    await internals.resetUploadedChunks(null);
    await internals.uploadChunk(new Blob(["first"]), 0);
    await internals.resetUploadedChunks(null);
    await internals.uploadChunk(new Blob(["second"]), 0);
    await engine.cancel();

    expect(requests[0]?.body).toMatchObject({ useGenerationFence: true });
    expect(requests[1]?.url).toContain("uploadGenerationId=generation-1");
    expect(requests[2]?.body).toMatchObject({
      useGenerationFence: true,
      uploadGenerationId: "generation-1",
    });
    expect(requests[3]?.url).toContain("uploadGenerationId=generation-2");
    expect(requests[4]).toMatchObject({
      url: "/api/uploads/rec-1/abort",
      body: JSON.stringify({ uploadGenerationId: "generation-2" }),
    });
  });
});
