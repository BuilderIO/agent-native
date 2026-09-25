import { beforeEach, describe, expect, it, vi } from "vitest";

const formEntries: Array<[string, unknown]> = [];

vi.mock("./clips-session", () => ({
  getClipsSession: vi.fn(async () => ({
    token: "secure-session-token",
    ownerKey: "owner",
  })),
}));

vi.mock("./dictation-preferences", () => ({
  loadDictationPreferences: vi.fn(async () => ({
    language: "ja-JP",
    cleanupStyle: "concise",
    customInstructions: "Keep code identifiers unchanged.",
  })),
  listDictationVocabulary: vi.fn(async () => [
    {
      id: "vocab_1",
      term: "builder eye oh",
      replacement: "Builder.io",
      usesCount: 2,
    },
  ]),
  buildDictationInstructions: vi.fn(() => "bounded guidance"),
}));

vi.mock("./clips-api", () => ({
  getClipsBaseUrl: vi.fn(() => "https://clips.agent-native.com"),
  callClipsAction: vi.fn(),
}));

import { listDictationVocabulary } from "./dictation-preferences";
import { transcribeMobileAudio } from "./voice-api";

describe("mobile voice transcription", () => {
  beforeEach(() => {
    formEntries.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal(
      "FormData",
      class {
        append(key: string, value: unknown) {
          formEntries.push([key, value]);
        }
      },
    );
  });

  it("sends the device language, cleanup guidance, and scoped vocabulary", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ text: "Transcribed text" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeMobileAudio(
        "file:///dictation.m4a",
        "audio/mp4",
        undefined,
        "owner",
      ),
    ).resolves.toBe("Transcribed text");

    expect(formEntries).toEqual(
      expect.arrayContaining([
        ["provider", "auto"],
        ["language", "ja-JP"],
        ["instructions", "bounded guidance"],
      ]),
    );
    expect(listDictationVocabulary).toHaveBeenCalledWith({
      token: "secure-session-token",
      ownerKey: "owner",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://clips.agent-native.com/_agent-native/transcribe-voice",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secure-session-token",
        }),
      }),
    );
    const firstUrl = (
      fetchMock.mock.calls as unknown as Array<[unknown]>
    )[0]?.[0];
    expect(String(firstUrl)).not.toContain("secure-session-token");
  });
});
