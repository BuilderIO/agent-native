import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveSecretMock } = vi.hoisted(() => ({
  resolveSecretMock: vi.fn(async () => "test-openai-key"),
}));

vi.mock("@agent-native/core/server", () => ({
  readDeployCredentialEnv: vi.fn(() => undefined),
  resolveSecret: resolveSecretMock,
}));

import { OpenAIProvider } from "./openai.js";

describe("OpenAIProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: Buffer.from("generated image").toString("base64") }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    resolveSecretMock.mockResolvedValue("test-openai-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends reference image bytes and MIME types through the edit API", async () => {
    const reference = Buffer.from("reference image bytes").toString("base64");

    await new OpenAIProvider().generate(
      "a red circle",
      [{ data: reference, mimeType: "image/webp" }],
      { slideContent: "<h1>Revenue trend</h1>" },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    const body = JSON.parse(String(init.body));
    expect(body.images).toEqual([
      { image_url: `data:image/webp;base64,${reference}` },
    ]);
    expect(body.prompt).toContain("a red circle");
    expect(body.prompt).toContain("Revenue trend");
    expect(body.prompt).not.toContain("<h1>");
  });

  it("keeps ordinary generation on the generation API without references", async () => {
    await new OpenAIProvider().generate("a red circle");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("images");
  });
});
