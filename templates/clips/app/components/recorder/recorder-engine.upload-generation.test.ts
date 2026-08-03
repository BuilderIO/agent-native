import { afterEach, describe, expect, it, vi } from "vitest";

import { RecorderEngine } from "./recorder-engine";

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
        const url = String(input);
        if (url.endsWith("/reset-chunks")) {
          resetCount += 1;
          requests.push({
            url,
            body: JSON.parse(String(init?.body)),
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
