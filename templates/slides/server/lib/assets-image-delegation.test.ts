import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  A2AClientMock,
  sendAndWaitMock,
  signA2AOrganizationTokenMock,
  signA2ATokenMock,
  resolveA2ACallerAuthMock,
} = vi.hoisted(() => ({
  A2AClientMock: vi.fn(function A2AClient() {
    return { sendAndWait: sendAndWaitMock };
  }),
  sendAndWaitMock: vi.fn(),
  signA2AOrganizationTokenMock: vi.fn(async () => "signed-org-token"),
  signA2ATokenMock: vi.fn(async () => "signed-token"),
  resolveA2ACallerAuthMock: vi.fn(async () => ({
    apiKey: "resolved-key" as string | undefined,
    apiKeyFallbacks: ["org-fallback-key"],
    userEmail: "author@example.com",
    orgDomain: "example.com" as string | undefined,
    orgId: "sender-local-org",
    orgSecret: "org-secret" as string | undefined,
    metadata: {},
  })),
}));

vi.mock("@agent-native/core/a2a", () => ({
  A2AClient: A2AClientMock,
  buildAgentInvocationPrompt: (prompt: string) => prompt,
  canonicalA2AAudience: (url: string) => url.replace(/\/+$/, ""),
  getGlobalA2ASecret: () => process.env.A2A_SECRET?.trim(),
  resolveA2ACallerAuth: resolveA2ACallerAuthMock,
  resolveAgentInvocationTarget: vi.fn(async () => ({
    kind: "discovered",
    name: "Assets",
    url: "https://assets.example.com",
  })),
  signA2AToken: signA2ATokenMock,
  signA2AOrganizationToken: signA2AOrganizationTokenMock,
}));

import {
  delegateImageGenerationToAssets,
  extractAssetImages,
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
    A2AClientMock.mockClear();
    signA2AOrganizationTokenMock.mockClear();
    signA2ATokenMock.mockClear();
  });

  it("reports a completed run as delegated", async () => {
    sendAndWaitMock.mockResolvedValue(
      task("completed", "previewUrl: https://cdn.example.com/a.png"),
    );
    const result = await delegateImageGenerationToAssets({ prompt: "a hero" });
    expect(result.status).toBe("delegated");
  });

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

  it("normalizes requested style references before sending to assets", async () => {
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    await delegateImageGenerationToAssets({
      prompt: "a hero",
      referenceImageUrls: [
        " https://cdn.example.com/ref-1.png ",
        "",
        "https://cdn.example.com/ref-1.png",
        "https://cdn.example.com/ref-2.png",
      ],
    });
    const sentText = sendAndWaitMock.mock.calls[0][0].parts[0].text;
    expect(sentText).toContain("https://cdn.example.com/ref-1.png");
    expect(sentText).toContain("https://cdn.example.com/ref-2.png");
  });

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

  it("sends a distinct idempotency key per identical variation request", async () => {
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    await delegateImageGenerationToAssets({ prompt: "a hero", deckId: "d1" });
    await delegateImageGenerationToAssets({ prompt: "a hero", deckId: "d1" });
    const [first, second] = sendAndWaitMock.mock.calls;
    expect(first[1].idempotencyKey).toBeTruthy();
    expect(first[1].idempotencyKey).not.toBe(second[1].idempotencyKey);
  });

  it("reuses the idempotency key when a submission is retried", async () => {
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    const request = { prompt: "a hero", deckId: "d1", submissionId: "sub-1" };
    await delegateImageGenerationToAssets(request);
    await delegateImageGenerationToAssets(request);
    const [first, second] = sendAndWaitMock.mock.calls;
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
    const previousA2ASecret = process.env.A2A_SECRET;
    delete process.env.A2A_SECRET;
    process.env.IMAGES_A2A_KEY = "static-override";
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    try {
      await delegateImageGenerationToAssets({ prompt: "a hero" });
      expect(signA2AOrganizationTokenMock).toHaveBeenCalledWith(
        "example.com",
        "org-secret",
        undefined,
        { audience: "https://assets.example.com" },
      );
      expect(signA2ATokenMock).not.toHaveBeenCalled();
      expect(A2AClientMock).toHaveBeenCalledWith(
        "https://assets.example.com",
        "signed-org-token",
        {
          fallbackApiKeys: [
            "resolved-key",
            "org-fallback-key",
            "static-override",
          ],
        },
      );
    } finally {
      delete process.env.IMAGES_A2A_KEY;
      if (previousA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = previousA2ASecret;
    }
  });

  it("uses audience-bound user and org tokens without local org IDs", async () => {
    const previousA2ASecret = process.env.A2A_SECRET;
    process.env.A2A_SECRET = "deployment-secret";
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    try {
      await delegateImageGenerationToAssets({ prompt: "a hero" });

      expect(signA2ATokenMock).toHaveBeenCalledWith(
        "author@example.com",
        "example.com",
        undefined,
        {
          preferGlobalSecret: true,
          audience: "https://assets.example.com",
        },
      );
      expect(signA2AOrganizationTokenMock).toHaveBeenCalledWith(
        "example.com",
        "org-secret",
        undefined,
        { audience: "https://assets.example.com" },
      );
      expect(A2AClientMock).toHaveBeenCalledWith(
        "https://assets.example.com",
        "signed-token",
        {
          fallbackApiKeys: [
            "signed-org-token",
            "resolved-key",
            "org-fallback-key",
          ],
        },
      );
    } finally {
      if (previousA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = previousA2ASecret;
    }
  });

  it("does not mint a user token when an active org has no domain", async () => {
    const previousA2ASecret = process.env.A2A_SECRET;
    process.env.A2A_SECRET = "deployment-secret";
    resolveA2ACallerAuthMock.mockResolvedValueOnce({
      apiKey: undefined,
      apiKeyFallbacks: [],
      userEmail: "author@example.com",
      orgId: "sender-local-org",
      orgDomain: undefined,
      orgSecret: undefined,
      metadata: {},
    });
    sendAndWaitMock.mockResolvedValue(task("completed", "done"));
    try {
      await delegateImageGenerationToAssets({ prompt: "a hero" });

      expect(signA2ATokenMock).not.toHaveBeenCalled();
      expect(signA2AOrganizationTokenMock).not.toHaveBeenCalled();
      expect(A2AClientMock).toHaveBeenCalledWith(
        "https://assets.example.com",
        undefined,
        { fallbackApiKeys: [] },
      );
    } finally {
      if (previousA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = previousA2ASecret;
    }
  });
});

describe("extractAssetUrl", () => {
  it("recovers both artifact endpoints from compact generation replies", () => {
    const reply = JSON.stringify({
      id: "asset-1",
      runId: "run-1",
      Artifacts: [
        "previewUrl: https://cdn.example.com/asset-1.png (ID: asset-1, Run: run-1)",
        "downloadUrl: https://assets.example.com/api/assets/asset-1/content?download=1",
      ],
    });

    expect(extractAssetImages(reply)).toEqual([
      {
        previewUrl: "https://cdn.example.com/asset-1.png",
        downloadUrl:
          "https://assets.example.com/api/assets/asset-1/content?download=1",
      },
    ]);
  });

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

  it("pairs the preview and download endpoints of one asset", () => {
    const reply = [
      "previewUrl: https://cdn.example.com/a-preview.png",
      "downloadUrl: https://cdn.example.com/a-full.png",
      "previewUrl: https://cdn.example.com/b-preview.png",
      "downloadUrl: https://cdn.example.com/b-full.png",
    ].join("\n");
    expect(extractAssetUrls(reply)).toEqual([
      "https://cdn.example.com/a-preview.png",
      "https://cdn.example.com/b-preview.png",
    ]);
    expect(extractAssetUrls(reply, { prefer: "download" })).toEqual([
      "https://cdn.example.com/a-full.png",
      "https://cdn.example.com/b-full.png",
    ]);
  });

  it("uses whichever endpoint an asset reports", () => {
    const reply = [
      "previewUrl: https://cdn.example.com/a-preview.png",
      "previewUrl: https://cdn.example.com/b-preview.png",
    ].join("\n");
    expect(extractAssetUrls(reply, { prefer: "download" })).toEqual([
      "https://cdn.example.com/a-preview.png",
      "https://cdn.example.com/b-preview.png",
    ]);
  });

  it("resolves an origin-relative asset path against the assets origin", () => {
    expect(
      extractAssetUrl("previewUrl: /api/assets/abc123/content", {
        baseUrl: "https://assets.example.com/a2a",
      }),
    ).toBe("https://assets.example.com/api/assets/abc123/content");
  });

  it("ignores a relative path when no assets origin is known", () => {
    expect(
      extractAssetUrl("previewUrl: /api/assets/abc123/content"),
    ).toBeNull();
  });

  it("reads a url far away from its key", () => {
    const reply =
      "The previewUrl, which you can hand straight to the deck editor, is " +
      "https://cdn.example.com/a.png";
    expect(extractAssetUrl(reply)).toBe("https://cdn.example.com/a.png");
  });

  it("keeps pairing correct when a key is separated by digits", () => {
    const reply = [
      "Variation 1 previewUrl: https://cdn.example.com/a-preview.png",
      "Variation 1 downloadUrl: https://cdn.example.com/a-full.png",
      "Variation 2 previewUrl: https://cdn.example.com/b-preview.png",
      "Variation 2 downloadUrl: https://cdn.example.com/b-full.png",
    ].join("\n");
    expect(extractAssetUrls(reply, { prefer: "download" })).toEqual([
      "https://cdn.example.com/a-full.png",
      "https://cdn.example.com/b-full.png",
    ]);
  });
});

describe("imagePreviewMarkdown", () => {
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
