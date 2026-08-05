import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  appendFinalTranscript,
  recordingTranscriptionLanguage,
  isMicEcho,
  restartTranscriptionEngine,
  startTranscriptionEngine,
  transcriptFullText,
  transcriptSegments,
  type SourcedTranscriptSegment,
  type TranscriptLine,
} from "./transcription-engine";

/** A final-transcript event carrying one segment of `text`. */
function said(
  source: "mic" | "system",
  text: string,
  startMs: number,
  endMs = startMs + 2_000,
) {
  return { text, source, segments: [{ startMs, endMs, text }] } as const;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("recording transcription language", () => {
  it("leaves local Whisper recordings on auto-detect instead of forcing the UI locale", () => {
    expect(recordingTranscriptionLanguage()).toBeNull();
  });
});

describe("transcript echo suppression", () => {
  it("drops mic speech that only echoes system audio already captured", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "Send the pull request button", 1_000),
      lines,
    );
    expect(
      appendFinalTranscript(
        said("mic", "Send the pull request button", 1_100),
        lines,
      ),
    ).toBe(false);

    expect(transcriptFullText(lines)).toBe(
      "Them: Send the pull request button",
    );
    expect(transcriptSegments(lines)).toHaveLength(1);
  });

  it("retracts a mic echo once the system copy of it arrives", () => {
    const lines: TranscriptLine[] = [];

    // The mic finalizes first, so without retraction the remote speaker's
    // words would stay attributed to the user.
    appendFinalTranscript(
      said("mic", "Send the pull request button", 1_100),
      lines,
    );
    appendFinalTranscript(
      said("system", "Send the pull request button", 1_000),
      lines,
    );

    expect(transcriptFullText(lines)).toBe(
      "Them: Send the pull request button",
    );
    expect(transcriptSegments(lines)).toHaveLength(1);
  });

  it("treats mangled echo as echo", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "So I think we should ship the redesign on Friday", 4_000),
      lines,
    );
    // Whisper transcribes speaker bleed badly: words drop out and change.
    expect(
      appendFinalTranscript(
        said("mic", "So I think we should ship a redesign Friday", 4_300),
        lines,
      ),
    ).toBe(false);
  });

  it("keeps the user talking over the remote side", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "So I think we should ship the redesign on Friday", 4_000),
      lines,
    );
    expect(
      appendFinalTranscript(
        said("mic", "Wait, can we talk about QA first", 4_500),
        lines,
      ),
    ).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it("keeps matching speech once the conversation has moved on", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "Please review the changes", 1_000),
      lines,
    );
    for (let index = 0; index < 6; index++) {
      appendFinalTranscript(
        said("system", `Unrelated remark number ${index}`, 5_000 + index),
        lines,
      );
    }
    expect(
      appendFinalTranscript(
        said("mic", "Please review the changes", 30_000),
        lines,
      ),
    ).toBe(true);

    expect(lines).toHaveLength(8);
    expect(transcriptSegments(lines)).toHaveLength(8);
  });

  it("keeps a deliberate repeat after the loose echo time window", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "So seventy five centimetres, got it", 1_000),
      lines,
    );

    expect(
      appendFinalTranscript(
        said("mic", "So seventy five centimetres, got it", 30_000),
        lines,
      ),
    ).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it("does not use or retract preloaded history as live echo evidence", () => {
    const lines: TranscriptLine[] = [
      {
        source: "system",
        text: "Please review the changes",
        startMs: 1_000,
        segments: [],
        historical: true,
      },
      {
        source: "mic",
        text: "Send the pull request button",
        startMs: 2_000,
        segments: [],
        historical: true,
      },
    ];

    expect(
      appendFinalTranscript(
        said("mic", "Please review the changes", 1_200),
        lines,
      ),
    ).toBe(true);
    appendFinalTranscript(
      said("system", "Send the pull request button", 2_200),
      lines,
    );

    expect(lines.filter((line) => line.historical)).toHaveLength(2);
    expect(lines).toHaveLength(4);
  });

  it("keeps short agreements that merely repeat a common word", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "Does that work for everyone", 2_000),
      lines,
    );
    expect(
      appendFinalTranscript(said("mic", "Yeah that works", 2_400), lines),
    ).toBe(true);
  });

  // Echo repeats a whole utterance. A brief interjection whose words all
  // happen to appear, in order, somewhere in a long remote passage is the user
  // talking, and silently deleting that is far worse than keeping echo.
  it.each([
    ["Sorry, go ahead", "Right, go ahead and start whenever you are ready"],
    ["Yeah, I think so", "I don't think so, we should just ship it"],
    [
      "I think we should do that",
      "So I was thinking we should not do the second one, that is my take",
    ],
  ])("keeps %j spoken over the remote side", (mine, theirs) => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(said("system", theirs, 5_000, 12_000), lines);
    expect(appendFinalTranscript(said("mic", mine, 6_000, 8_000), lines)).toBe(
      true,
    );
    expect(lines).toHaveLength(2);
  });

  // Captured off a real speaker-mode call. Whisper hears the bleed well enough
  // to keep the sentence structure but mangles the nouns and the digits, which
  // is why both exact and set-based matching let it through.
  it("matches a real mangled echo of a long utterance", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said(
        "system",
        "I'm going to test it out on my garden hedge. This particular model is the 751 and the 75 just means it's got a 75 centimetre cut in blade.",
        0,
        10_000,
      ),
      lines,
    );
    expect(
      appendFinalTranscript(
        said(
          "mic",
          "I'm going to test it out on my garden page. This particular model is the 751 and the 752 has a 75% to me to cut in blade.",
          200,
          10_200,
        ),
        lines,
      ),
    ).toBe(false);
  });

  it("matches echo that straddles two system lines", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "Let us start with the", 1_000),
      lines,
    );
    appendFinalTranscript(
      said("system", "roadmap for next quarter", 3_000),
      lines,
    );
    expect(
      appendFinalTranscript(
        said(
          "mic",
          "Let us start with the roadmap for next quarter",
          1_200,
          5_000,
        ),
        lines,
      ),
    ).toBe(false);
  });

  it("does not let an unrelated neighbouring line bury the match", () => {
    const lines: TranscriptLine[] = [];

    appendFinalTranscript(
      said("system", "Anyway that is everything from my side today", 1_000),
      lines,
    );
    appendFinalTranscript(
      said("system", "Any questions before we go", 3_000),
      lines,
    );
    expect(
      appendFinalTranscript(
        said("mic", "Any questions before we go", 3_300),
        lines,
      ),
    ).toBe(false);
  });
});

describe("in-flight partials", () => {
  it("suppresses a mic partial that mirrors the system partial", () => {
    const inFlight: TranscriptLine[] = [
      {
        source: "system",
        text: "so the next thing on the list is the pricing page rewrite",
        startMs: null,
        segments: [],
      },
    ];

    expect(
      isMicEcho("so the next thing on the list is the pricing page", inFlight),
    ).toBe(true);
  });

  it("keeps a mic partial of the user answering", () => {
    const inFlight: TranscriptLine[] = [
      {
        source: "system",
        text: "so the next thing on the list is the pricing page rewrite",
        startMs: null,
        segments: [],
      },
    ];

    expect(isMicEcho("right, who is picking that up", inFlight)).toBe(false);
  });
});

describe("meeting microphone capture", () => {
  it("starts without VoiceProcessingIO so call apps keep control of mic gain", async () => {
    await startTranscriptionEngine({
      mic: { deviceId: "mic-1", label: "Built-in Microphone" },
    });

    expect(invokeMock).toHaveBeenCalledWith("audio_transcription_start", {
      meetingId: null,
      locale: null,
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      captureSystem: true,
      voiceProcessing: false,
      emitPartials: true,
      owner: "meeting",
    });
  });

  it("keeps VoiceProcessingIO off when meeting transcription resumes", async () => {
    await restartTranscriptionEngine("whisper", {
      deviceId: "mic-1",
      label: "Built-in Microphone",
    });

    expect(invokeMock).toHaveBeenCalledWith("audio_transcription_start", {
      meetingId: null,
      locale: null,
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      captureSystem: true,
      voiceProcessing: false,
      emitPartials: true,
      owner: "meeting",
    });
  });

  it("can disable partial inference for recording-only consumers", async () => {
    await startTranscriptionEngine({
      mic: { deviceId: "mic-1", label: "Built-in Microphone" },
      emitPartials: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("audio_transcription_start", {
      meetingId: null,
      locale: null,
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      captureSystem: true,
      voiceProcessing: false,
      emitPartials: false,
      owner: "meeting",
    });
  });

  it("falls back to native speech when the local Whisper capture cannot start", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("local meeting capture unavailable"))
      .mockResolvedValueOnce(undefined);

    const engine = await startTranscriptionEngine({
      mic: { deviceId: "mic-1", label: "Built-in Microphone" },
    });

    expect(engine).toBe("macos-native");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "native_speech_start", {
      locale: "en-US",
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      owner: "meeting",
    });
  });

  it("retries the macOS default input when a saved microphone is gone", async () => {
    invokeMock
      .mockRejectedValueOnce(
        new Error(
          "Selected microphone 'old-device-id' is not available to ScreenCaptureKit.",
        ),
      )
      .mockResolvedValueOnce(undefined);

    const engine = await startTranscriptionEngine({
      mic: { deviceId: "old-device-id", label: "Disconnected headset" },
    });

    expect(engine).toBe("whisper");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "audio_transcription_start", {
      meetingId: null,
      locale: null,
      micDeviceId: null,
      micDeviceLabel: null,
      captureSystem: true,
      voiceProcessing: false,
      emitPartials: true,
      owner: "meeting",
    });
  });

  it("explains how to recover when local capture cannot start", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("local Whisper capture unavailable"))
      .mockRejectedValueOnce(
        new Error("VoiceProcessingIO enable failed: unavailable"),
      );

    await expect(
      startTranscriptionEngine({
        mic: { deviceId: "mic-1", label: "Built-in Microphone" },
      }),
    ).rejects.toThrow(
      "Clips could not start local audio capture. Check that Clips has Microphone and Screen Recording access in System Settings, then try again.",
    );
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("explains how to recover when a saved microphone is stale", async () => {
    invokeMock
      .mockRejectedValueOnce(
        new Error(
          "Selected microphone 'old-device-id' is not available to ScreenCaptureKit.",
        ),
      )
      .mockRejectedValueOnce(new Error("local meeting capture unavailable"))
      .mockRejectedValueOnce(
        new Error("VoiceProcessingIO enable failed: unavailable"),
      );

    await expect(
      startTranscriptionEngine({
        mic: { deviceId: "old-device-id", label: "Disconnected headset" },
      }),
    ).rejects.toThrow(
      "Your selected microphone is no longer available. Clips tried your Mac's default microphone, but notes still could not start. Choose an available microphone in Clips settings, then try again.",
    );
    expect(invokeMock).toHaveBeenNthCalledWith(3, "native_speech_start", {
      locale: "en-US",
      micDeviceId: null,
      micDeviceLabel: null,
      owner: "meeting",
    });
  });
});

describe("appendFinalTranscript word-level timestamps", () => {
  it("collects words into the optional sink and keeps sentence segments intact", async () => {
    const { appendFinalTranscript, transcriptFullText, transcriptSegments } =
      await import("./transcription-engine");
    const lines: TranscriptLine[] = [];
    const words: SourcedTranscriptSegment[] = [];
    const appended = appendFinalTranscript(
      {
        text: "Hello there. Nice one.",
        source: "mic",
        segments: [
          { startMs: 0, endMs: 900, text: "Hello there." },
          { startMs: 950, endMs: 1800, text: "Nice one." },
        ],
        words: [
          { startMs: 0, endMs: 400, text: "Hello" },
          { startMs: 410, endMs: 900, text: "there." },
          { startMs: 950, endMs: 1300, text: "Nice" },
          { startMs: 1310, endMs: 1800, text: "one." },
          { startMs: 1810, endMs: 1810, text: "  " },
        ],
      },
      lines,
      words,
    );
    expect(appended).toBe(true);
    expect(transcriptFullText(lines)).toBe("Me: Hello there. Nice one.");
    expect(transcriptSegments(lines)).toHaveLength(2);
    // Words land with the event source attached; blank entries are dropped.
    expect(words).toHaveLength(4);
    expect(words[1]).toEqual({
      startMs: 410,
      endMs: 900,
      text: "there.",
      source: "mic",
    });
  });

  it("stays backward-compatible when no words sink is passed", async () => {
    const { appendFinalTranscript, transcriptSegments } =
      await import("./transcription-engine");
    const lines: TranscriptLine[] = [];
    appendFinalTranscript(
      {
        text: "Hi.",
        source: "system",
        segments: [{ startMs: 0, endMs: 500, text: "Hi." }],
        words: [{ startMs: 0, endMs: 500, text: "Hi." }],
      },
      lines,
    );
    expect(transcriptSegments(lines)).toHaveLength(1);
  });
});
