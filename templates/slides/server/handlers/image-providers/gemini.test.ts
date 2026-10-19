import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContentMock = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  resolveGeminiApiKey: vi.fn(async () => "test-gemini-key"),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    return { models: { generateContent: generateContentMock } };
  }),
}));

import { GeminiProvider } from "./gemini.js";

describe("GeminiProvider", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("tries GA model ids, never the retired -preview aliases", async () => {
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { data: "aGVsbG8=", mimeType: "image/png" } },
            ],
          },
        },
      ],
    });

    const result = await new GeminiProvider().generate("a red circle");

    expect(result.model).toBe("gemini-3.1-flash-image");
    const triedModels = generateContentMock.mock.calls.map(
      (call) => call[0].model,
    );
    expect(triedModels).toEqual(["gemini-3.1-flash-image"]);
    expect(triedModels).not.toContain("gemini-3.1-flash-image-preview");
    expect(triedModels).not.toContain("gemini-3-pro-image-preview");
  });

  it("keeps slide and deck context when no reference images load", async () => {
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { data: "aGVsbG8=", mimeType: "image/png" } },
            ],
          },
        },
      ],
    });

    await new GeminiProvider().generate("a red circle", [], {
      slideContent: "<h1>Revenue trend</h1>",
      deckText: "Quarterly planning deck",
    });

    const request = generateContentMock.mock.calls[0][0];
    const prompt = request.contents
      .map((part: { text?: string }) => part.text ?? "")
      .join("\n");
    expect(prompt).toContain("a red circle");
    expect(prompt).toContain("Revenue trend");
    expect(prompt).toContain("Quarterly planning deck");
    expect(prompt).not.toContain("<h1>");
  });
});
