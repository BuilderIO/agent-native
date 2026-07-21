import { afterEach, describe, expect, it, vi } from "vitest";

import { registerFrameworkSecrets } from "./register-framework-secrets.js";
import { __resetSecretsRegistry, getRequiredSecret } from "./register.js";

describe("framework secret registrations", () => {
  afterEach(() => {
    __resetSecretsRegistry();
    vi.unstubAllGlobals();
  });

  it("registers a Figma personal access token fallback", async () => {
    registerFrameworkSecrets();

    const figma = getRequiredSecret("FIGMA_ACCESS_TOKEN");
    expect(figma).toMatchObject({
      label: "Figma access token",
      scope: "user",
      kind: "api-key",
      docsUrl:
        "https://developers.figma.com/docs/rest-api/personal-access-tokens/",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(figma?.validator?.("<FIGMA_ACCESS_TOKEN>")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.figma.com/v1/me", {
      headers: {
        "X-Figma-Token": "<FIGMA_ACCESS_TOKEN>",
        "User-Agent": "AgentNative/1.0",
      },
    });
  });
});
