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

  it("validates a pasted Anthropic API key at paste time", async () => {
    registerFrameworkSecrets();

    const anthropic = getRequiredSecret("ANTHROPIC_API_KEY");
    expect(anthropic).toMatchObject({
      label: "Anthropic API key",
      scope: "user",
      kind: "api-key",
      required: false,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      anthropic?.validator?.("<ANTHROPIC_API_KEY>"),
    ).resolves.toEqual({
      ok: false,
      error: "Anthropic rejected the key (HTTP 401).",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      {
        headers: {
          "x-api-key": "<ANTHROPIC_API_KEY>",
          "anthropic-version": "2023-06-01",
        },
      },
    );
  });

  it("registers Salesforce workspace OAuth credentials and connection metadata", () => {
    registerFrameworkSecrets();

    expect(getRequiredSecret("SALESFORCE_CLIENT_ID")).toMatchObject({
      label: "Salesforce OAuth client ID",
      scope: "workspace",
      kind: "api-key",
    });
    expect(getRequiredSecret("SALESFORCE_CLIENT_SECRET")).toMatchObject({
      label: "Salesforce OAuth client secret",
      scope: "workspace",
      kind: "api-key",
    });
    expect(getRequiredSecret("SALESFORCE_CONNECTED")).toMatchObject({
      label: "Salesforce account",
      scope: "user",
      kind: "oauth",
      oauthProvider: "salesforce",
      oauthConnectUrl: "/_agent-native/connections/oauth/salesforce/start",
    });
  });
});
