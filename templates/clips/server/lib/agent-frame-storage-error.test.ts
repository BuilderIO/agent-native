import { describe, expect, it } from "vitest";

import { openAgentFrameRange } from "./agent-frame-range.js";
import {
  describeFrameFailure,
  frameFailureStatus,
} from "./agent-frame-request.js";

const privateDetail = "https://storage.example.test/private/video.mp4";

describe("frame storage errors", () => {
  it.each([
    [
      "an upstream HTTP response",
      async () => new Response(privateDetail, { status: 413 }),
    ],
    [
      "a thrown upstream error",
      async (): Promise<Response> => {
        throw Object.assign(new Error(privateDetail), { statusCode: 413 });
      },
    ],
  ])(
    "reports %s with status 413 as a sanitized gateway failure",
    async (_, read) => {
      const error: unknown = await openAgentFrameRange(read, "mov").catch(
        (failure: unknown) => failure,
      );
      expect(error).toMatchObject({
        name: "RecordingMediaFetchError",
        statusCode: 502,
      });
      const status = frameFailureStatus(error);
      expect(status).toBe(502);
      const failure = describeFrameFailure(error, status);
      expect(failure.failureKind).toBe("processing");
      expect(JSON.stringify(failure)).not.toContain(privateDetail);
      expect(failure.nextStep).not.toMatch(/too large|shorter frame-sheet/i);
    },
  );

  it("preserves 413 and smaller-request guidance for a local range request budget", async () => {
    const media = await openAgentFrameRange(
      async () =>
        new Response("a", {
          status: 206,
          headers: { etag: '"one"', "content-range": "bytes 0-0/1" },
        }),
      "mov",
    );
    try {
      for (let index = 0; index < 32; index++) {
        expect((await fetch(media.path)).status).toBe(206);
      }
      expect((await fetch(media.path)).status).toBe(503);
      const error: unknown = await media.remote
        .assertHealthy()
        .catch((failure: unknown) => failure);
      const status = frameFailureStatus(error);
      expect(status).toBe(413);
      expect(describeFrameFailure(error, status).nextStep).toContain(
        "shorter frame-sheet range",
      );
    } finally {
      await media.cleanup();
    }
  });
});
