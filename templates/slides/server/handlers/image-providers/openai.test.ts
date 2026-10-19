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
    const reference = Buffer.from("reference image bytes");
    const webpReference = Buffer.from("second reference image");

    await new OpenAIProvider().generate(
      "a red circle",
      [
        { data: reference.toString("base64"), mimeType: "image/jpeg" },
        { data: webpReference.toString("base64"), mimeType: "image/webp" },
      ],
      { slideContent: "<h1>Revenue trend</h1>" },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(init.headers).toEqual({ Authorization: "Bearer test-openai-key" });
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("model")).toBe("gpt-image-2");
    expect(body.get("n")).toBe("1");
    expect(body.get("image")).toBeNull();
    expect(body.get("prompt")).toContain("a red circle");
    expect(body.get("prompt")).toContain("Revenue trend");
    expect(body.get("prompt")).not.toContain("<h1>");

    const images = body.getAll("image[]") as File[];
    expect(images).toHaveLength(2);
    expect(images.map((image) => [image.name, image.type])).toEqual([
      ["reference-1.jpg", "image/jpeg"],
      ["reference-2.webp", "image/webp"],
    ]);
    expect(Buffer.from(await images[0].arrayBuffer())).toEqual(reference);
    expect(Buffer.from(await images[1].arrayBuffer())).toEqual(webpReference);
  });

  it("keeps ordinary generation on the generation API without references", async () => {
    await new OpenAIProvider().generate("a red circle");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("images");
  });

  it("rejects OpenAI reference image types the edit API does not accept", async () => {
    await expect(
      new OpenAIProvider().generate("a red circle", [
        { data: "c3Zn", mimeType: "image/svg+xml" },
      ]),
    ).rejects.toThrow("Unsupported OpenAI reference image type: image/svg+xml");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
