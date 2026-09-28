import { afterEach, describe, expect, it, vi } from "vitest";

import { listRegisteredSecrets } from "./secrets.js";

vi.mock("./api-path.js", () => ({
  agentNativePath: (path: string) => `/mounted${path}`,
}));

const secrets = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    scope: "user",
    kind: "api-key",
    required: false,
    status: "set",
  },
];

describe("listRegisteredSecrets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads registered secrets through the mounted client route", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(secrets));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      listRegisteredSecrets({ signal: controller.signal }),
    ).resolves.toEqual(secrets);
    expect(fetchMock).toHaveBeenCalledWith("/mounted/_agent-native/secrets", {
      credentials: "same-origin",
      signal: controller.signal,
    });
  });

  it("rejects unsuccessful and malformed responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ secrets: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRegisteredSecrets()).rejects.toThrow(
      "Failed to load secrets (503)",
    );
    await expect(listRegisteredSecrets()).rejects.toThrow(
      "Invalid registered secrets response",
    );
  });
});
