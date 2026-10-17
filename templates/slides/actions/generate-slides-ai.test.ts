import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockResolveHasBuilderGatewayCredential = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/agent/engine", () => ({
  createBuilderEngine: () => ({ stream: vi.fn() }),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveGeminiApiKey: async () => "gemini-key",
  resolveHasBuilderGatewayCredential: (...args: unknown[]) =>
    mockResolveHasBuilderGatewayCredential(...args),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: mockGenerateContent };
  },
}));

import action from "./generate-slides-ai";

describe("generate-slides-ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveHasBuilderGatewayCredential.mockResolvedValue(false);
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify([
                  { content: "## Quarterly review", layout: "title" },
                ]),
              },
            ],
          },
        },
      ],
    });
  });

  it("drafts the outline with Gemini 3.6 Flash when Builder is not connected", async () => {
    const result = await action.run({
      topic: "Quarterly review",
      slideCount: 1,
    });

    expect(result.slides).toEqual([
      { content: "## Quarterly review", layout: "title", notes: "" },
    ]);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const [request] = mockGenerateContent.mock.calls[0];
    expect(request.model).toBe("gemini-3.6-flash");
    for (const key of ["temperature", "topP", "topK"]) {
      expect(request.config).not.toHaveProperty(key);
    }
  });
});
