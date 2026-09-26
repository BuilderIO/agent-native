import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_ENV_META } from "../agent/engine/provider-env-vars.js";
import { registerFrameworkSecrets } from "./register-framework-secrets.js";
import {
  __resetSecretsRegistry,
  getRegisteredSecretUsage,
  getRequiredSecret,
} from "./register.js";

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

  it("registers Jev as an optional API key with paste-time validation", async () => {
    registerFrameworkSecrets();

    const jev = getRequiredSecret("JEV_API_KEY");
    expect(jev).toMatchObject({
      label: "Decision model (Jev)",
      scope: "user",
      kind: "api-key",
      required: false,
      docsUrl: "https://docs.typesafe.ai/",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(jev?.validator?.("jev-example-key")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/models",
      { headers: { Authorization: "Bearer jev-example-key" } },
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

  it("registers every model provider key at the personal scope the provider forms save by default", () => {
    registerFrameworkSecrets();

    for (const { envVar } of Object.values(PROVIDER_ENV_META)) {
      expect(getRequiredSecret(envVar), envVar).toMatchObject({
        scope: "user",
        kind: "api-key",
      });
    }
  });

  it("registers one Gemini key that also carries the voice input use", async () => {
    registerFrameworkSecrets();

    expect(getRequiredSecret("GEMINI_API_KEY")).toBeUndefined();
    const gemini = getRequiredSecret("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(gemini).toMatchObject({
      label: "Google Gemini API key",
      scope: "user",
      kind: "api-key",
    });
    expect(getRegisteredSecretUsage("GOOGLE_GENERATIVE_AI_API_KEY")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feature: "Voice input" }),
      ]),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(gemini?.validator?.("<GEMINI_KEY>")).resolves.toEqual({
      ok: false,
      error: "Google rejected the key (HTTP 400).",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      { headers: { "x-goog-api-key": "<GEMINI_KEY>" } },
    );
  });
});
