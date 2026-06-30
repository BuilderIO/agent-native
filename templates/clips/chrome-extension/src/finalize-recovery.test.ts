import { describe, expect, it } from "vitest";

import {
  publicRecordingStatusUrl,
  readyRecordingFromPublicPayload,
  waitForReadyRecordingAfterFinalizeError,
} from "./finalize-recovery";

describe("finalize upload recovery", () => {
  it("derives the public recording status URL from the chunk upload URL", () => {
    expect(
      publicRecordingStatusUrl(
        "https://clips.example.com/base/api/uploads/rec-1/chunk",
        "rec-1",
      ),
    ).toBe("https://clips.example.com/base/api/public-recording?id=rec-1");
  });

  it("recognizes ready public recording payloads", () => {
    const probe = readyRecordingFromPublicPayload(
      {
        recording: {
          id: "rec-1",
          status: "ready",
          videoUrl: "https://cdn.example.com/rec-1.webm",
          durationMs: 1234,
          width: 1280,
          height: 720,
          hasAudio: true,
          hasCamera: false,
        },
      },
      "fallback",
    );

    expect(probe).toEqual({
      ready: true,
      result: {
        ok: true,
        finalized: true,
        recoveredAfterFinalizeError: true,
        id: "rec-1",
        recordingId: "rec-1",
        status: "ready",
        videoUrl: "https://cdn.example.com/rec-1.webm",
        durationMs: 1234,
        width: 1280,
        height: 720,
        hasAudio: true,
        hasCamera: false,
      },
    });
  });

  it("polls until the recording becomes ready", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          recording:
            calls === 1
              ? { id: "rec-1", status: "processing" }
              : {
                  id: "rec-1",
                  status: "ready",
                  videoUrl: "https://cdn.example.com/rec-1.webm",
                },
        }),
        { status: 200 },
      );
    };

    await expect(
      waitForReadyRecordingAfterFinalizeError({
        uploadUrl: "https://clips.example.com/api/uploads/rec-1/chunk",
        recordingId: "rec-1",
        fetchImpl,
        sleepImpl: async () => undefined,
        timeoutMs: 2,
        intervalMs: 1,
      }),
    ).resolves.toMatchObject({
      id: "rec-1",
      status: "ready",
      videoUrl: "https://cdn.example.com/rec-1.webm",
    });
  });
});
