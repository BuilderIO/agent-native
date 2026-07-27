import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBuilderStream = vi.hoisted(() => vi.fn());
const mockResolveBuilderCredentials = vi.hoisted(() => vi.fn());
const mockResolveSecret = vi.hoisted(() => vi.fn());
const mockNoteBuilderCreditsExhausted = vi.hoisted(() => vi.fn());
const mockClearBuilderCreditsExhausted = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/agent/engine", () => ({
  createBuilderEngine: () => ({ stream: mockBuilderStream }),
}));

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {
    requiredCredential: string;

    constructor(opts: { requiredCredential: string; message?: string }) {
      super(opts.message);
      this.name = "FeatureNotConfiguredError";
      this.requiredCredential = opts.requiredCredential;
    }
  },
  resolveBuilderCredentials: (...args: unknown[]) =>
    mockResolveBuilderCredentials(...args),
  resolveSecret: (...args: unknown[]) => mockResolveSecret(...args),
}));

vi.mock("@agent-native/core/voice", () => ({
  applyVoiceContextReplacements: (value: string) => value,
  formatVoiceContextPackForPrompt: () => "",
}));

vi.mock("./lib/builder-credits-state.js", () => ({
  clearBuilderCreditsExhausted: (...args: unknown[]) =>
    mockClearBuilderCreditsExhausted(...args),
  noteBuilderCreditsExhausted: (...args: unknown[]) =>
    mockNoteBuilderCreditsExhausted(...args),
}));

import cleanupTranscript from "./cleanup-transcript";
import { cleanupMaxOutputTokens } from "./cleanup-transcript";

describe("cleanup-transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBuilderCredentials.mockResolvedValue({
      privateKey: "bpk-test",
      publicKey: "public-test",
    });
    mockResolveSecret.mockResolvedValue("gemini-key");
    mockNoteBuilderCreditsExhausted.mockResolvedValue(undefined);
    mockClearBuilderCreditsExhausted.mockResolvedValue(undefined);
    mockBuilderStream.mockImplementation(async function* () {
      yield {
        type: "stop",
        reason: "error",
        error: "Builder credits limit reached",
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          candidates: [
            {
              content: {
                parts: [{ text: "Cleaned transcript from Gemini." }],
              },
            },
          ],
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to BYOK Gemini when Builder credits are exhausted", async () => {
    const result = await cleanupTranscript.run({
      transcript: "raw transcript",
      task: "cleanup",
    });

    expect(result).toMatchObject({
      task: "cleanup",
      cleanedText: "Cleaned transcript from Gemini.",
      provider: "gemini-byok",
    });
    expect(mockNoteBuilderCreditsExhausted).toHaveBeenCalledWith({
      source: "cleanup",
      message: "Builder credits limit reached",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-goog-api-key": "gemini-key",
        }),
      }),
    );
  });

  it("scales cleanup output budgets with transcript length for both providers", async () => {
    const transcript = "x".repeat(28_445);

    await cleanupTranscript.run({ transcript, task: "cleanup" });

    expect(cleanupMaxOutputTokens("cleanup", transcript.length)).toBe(9_994);
    expect(mockBuilderStream).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 9_994 }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body)) as {
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.generationConfig.maxOutputTokens).toBe(9_994);
  });

  it("rejects a Builder response stopped at the output-token limit", async () => {
    mockBuilderStream.mockImplementation(async function* () {
      yield { type: "text-delta", text: "partial cleanup" };
      yield { type: "stop", reason: "max_tokens" };
    });

    const result = await cleanupTranscript.run({
      transcript: "raw transcript",
      task: "cleanup",
    });

    expect(result).toMatchObject({
      cleanedText: "Cleaned transcript from Gemini.",
      provider: "gemini-byok",
    });
  });
});
