import { describe, expect, it, vi, beforeEach } from "vitest";

const { sendAndWaitMock, signA2ATokenMock } = vi.hoisted(() => ({
  sendAndWaitMock: vi.fn(),
  signA2ATokenMock: vi.fn(async () => "signed-token"),
}));

vi.mock("@agent-native/core/a2a", () => ({
  A2AClient: vi.fn(function A2AClient() {
    return { sendAndWait: sendAndWaitMock };
  }),
  buildAgentInvocationPrompt: (prompt: string) => prompt,
  resolveA2ACallerAuth: vi.fn(async () => ({
    apiKey: "resolved-key",
    apiKeyFallbacks: ["org-fallback-key"],
    userEmail: "author@example.com",
    orgDomain: "example.com",
    orgSecret: "org-secret",
    metadata: {},
  })),
  resolveAgentInvocationTarget: vi.fn(async () => ({
    kind: "discovered",
    name: "Assets",
    url: "https://assets.example.com",
  })),
  signA2AToken: signA2ATokenMock,
}));

import {
  delegateImageGenerationToAssets,
  extractAssetUrl,
  extractAssetUrls,
  imagePreviewMarkdown,
} from "./assets-image-delegation.js";

function task(state: string, text?: string) {
  return {
    id: "task-1",
    status: {
      state,
      ...(text
        ? { message: { role: "agent", parts: [{ type: "text", text }] } }
        : {}),
    },
  };
}

describe("delegateImageGenerationToAssets", () => {
  beforeEach(() => {
    sendAndWaitMock.mockReset();
  });

  it("reports a completed run as delegated", async () => {
    sendAndWaitMock.mockResolvedValue(
      task("completed", "previewUrl: https://cdn.example.com/a.png"),
    );
    const result = await delegateImageGenerationToAssets({ prompt: "a hero" });
    expect(result.status).toBe("delegated");
  });

  // A failed run used to return its status text as a successful delegation,
  // so slides reported a brand-grounded image that never existed.
  it.each(["failed", "canceled", "input-required"])(
    "does not report a %s run as delegated",
    async (state) => {
      sendAndWaitMock.mockResolvedValue(task(state, "no library matched"));
      const result = await delegateImageGenerationToAssets({
        prompt: "a hero",
      });
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.state).toBe(state);
      }
    },
  );

  // A caller-side timeout leaves the Assets run going, so falling back would
  // generate (and bill) the same image twice.
  it("reports a caller timeout as pending, not unavailable", async () => {
    const timeout = Object.assign(new Error("timed out"), {
      taskId: "task-9",
      lastState: "working",
    });
    sendAndWaitMock.mockRejectedValue(timeout);
    const result = await delegateImageGenerationToAssets({ prompt: "a hero" });
    expect(result.status).toBe("pending");
    if (result.status === "pending") expect(result.taskId).toBe("task-9");
  });

  it("reports a transport failure as unavailable", async () => {
    sendAndWaitMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await delegateImageGenerationToAssets({ prompt: "a hero" });
    expect(result.status).toBe("unavailable");
  });

  // Falling back locally on an auth/permission refusal would bypass the Assets
  // access checks and hand back an off-brand image instead of the real reason.
  it.each([
    "A2A request failed (401): Invalid or expired A2A token",
    "A2A request failed (403): Forbidden",
    "A verified, audience-bound user identity is required",
  ])("treats %s as rejected, not unavailable", async (message) => {
    sendAndWaitMock.mockRejectedValue(new Error(message));
    const result = await delegateImageGenerationToAssets({ prompt: "a hero" });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.state).toBe("unauthorized");
  });

  it("sends a stable idempotency key for an identical repeat request", async () => {
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    await delegateImageGenerationToAssets({ prompt: "a hero", deckId: "d1" });
    await delegateImageGenerationToAssets({ prompt: "a hero", deckId: "d1" });
    const [first, second] = sendAndWaitMock.mock.calls;
    expect(first[1].idempotencyKey).toBeTruthy();
    expect(first[1].idempotencyKey).toBe(second[1].idempotencyKey);
  });

  it("sends a different idempotency key for a different prompt", async () => {
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    await delegateImageGenerationToAssets({ prompt: "a hero" });
    await delegateImageGenerationToAssets({ prompt: "a different hero" });
    const [first, second] = sendAndWaitMock.mock.calls;
    expect(first[1].idempotencyKey).not.toBe(second[1].idempotencyKey);
  });

  it("prefers audience-bound signed tokens over the static override", async () => {
    process.env.IMAGES_A2A_KEY = "static-override";
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    await delegateImageGenerationToAssets({ prompt: "a hero" });
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "author@example.com",
      "example.com",
      "org-secret",
      expect.objectContaining({ audience: "https://assets.example.com" }),
    );
    delete process.env.IMAGES_A2A_KEY;
  });
});

describe("extractAssetUrl", () => {
  it("keeps a sentence-ending period out of the url", () => {
    expect(
      extractAssetUrl(
        "The previewUrl is https://cdn.example.com/a.png. Enjoy!",
      ),
    ).toBe("https://cdn.example.com/a.png");
  });

  it("reads a json-shaped reply", () => {
    expect(
      extractAssetUrl('{"previewUrl": "https://cdn.example.com/b.png"}'),
    ).toBe("https://cdn.example.com/b.png");
  });

  it("falls back to a markdown image", () => {
    expect(extractAssetUrl("![v1](https://cdn.example.com/c.png)")).toBe(
      "https://cdn.example.com/c.png",
    );
  });

  it("returns null when the reply has no url", () => {
    expect(extractAssetUrl("I could not generate that image.")).toBeNull();
  });

  // A --count 3 batch returns one URL per slot; keeping only the first
  // silently drops the other candidates.
  it("returns every candidate in reply order", () => {
    const reply = [
      "previewUrl: https://cdn.example.com/a.png",
      "previewUrl: https://cdn.example.com/b.png",
      "previewUrl: https://cdn.example.com/c.png",
    ].join("\n");
    expect(extractAssetUrls(reply)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.png",
      "https://cdn.example.com/c.png",
    ]);
  });

  it("does not repeat the same url twice", () => {
    expect(
      extractAssetUrls(
        "previewUrl: https://cdn.example.com/a.png downloadUrl: https://cdn.example.com/a.png",
      ),
    ).toEqual(["https://cdn.example.com/a.png"]);
  });
});

describe("imagePreviewMarkdown", () => {
  // A bare link renders as text in chat, so the user sees no image.
  it("builds an image, not a link", () => {
    expect(
      imagePreviewMarkdown("a monstera", "https://cdn.example.com/a.png"),
    ).toBe("![a monstera](https://cdn.example.com/a.png)");
  });

  it("strips brackets that would break the markdown", () => {
    expect(
      imagePreviewMarkdown(
        "a [very] green plant",
        "https://cdn.example.com/a.png",
      ),
    ).toBe("![a very green plant](https://cdn.example.com/a.png)");
  });
});
