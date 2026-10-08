import { beforeEach, describe, expect, it, vi } from "vitest";

const completeText = vi.hoisted(() => vi.fn());
vi.mock("./complete-text.js", () => ({ completeText }));

import { chatTitleRequestFromBody, generateChatTitle } from "./chat-title.js";

describe("chat titles", () => {
  beforeEach(() => {
    completeText.mockReset();
  });

  it("runs on the engine and model the turn was sent with", async () => {
    completeText.mockResolvedValue({ text: '"Forty Numbered Lines"' });
    const request = chatTitleRequestFromBody({
      message:
        "<context>hidden</context>\nWrite forty lines about @[Deck|deck-1]",
      engine: "ai-sdk:openai",
      model: "gpt-5.6-luna",
    });

    await expect(
      generateChatTitle({ ...request!, appId: "slides" }),
    ).resolves.toBe("Forty Numbered Lines");
    expect(completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "slides",
        engine: "ai-sdk:openai",
        model: "gpt-5.6-luna",
        input: "Write forty lines about @Deck",
      }),
    );
  });

  it("leaves the engine and model to the deployment when the turn named none", async () => {
    completeText.mockResolvedValue({ text: "Title" });
    await generateChatTitle(
      chatTitleRequestFromBody({ message: "hi", engine: "", model: 7 })!,
    );
    const options = completeText.mock.calls[0]![0];
    expect(options).not.toHaveProperty("engine");
    expect(options).not.toHaveProperty("model");
  });

  it("surfaces a failed model call instead of an empty title", async () => {
    completeText.mockRejectedValue(new Error("model_not_found"));
    await expect(generateChatTitle({ message: "hi" })).rejects.toThrow(
      "model_not_found",
    );
  });

  it("rejects a body without a message", () => {
    expect(chatTitleRequestFromBody({ engine: "ai-sdk:openai" })).toBeNull();
    expect(chatTitleRequestFromBody(null)).toBeNull();
  });
});
