import type { H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockIsBlockedExtensionUrlWithDns = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();
const mockClearProviderCredentialAuthFailure = vi.fn();

vi.mock("./auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
}));

vi.mock("../secrets/storage.js", () => ({
  writeAppSecret: (...args: unknown[]) => mockWriteAppSecret(...args),
  deleteAppSecret: (...args: unknown[]) => mockDeleteAppSecret(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  isBlockedExtensionUrlWithDns: (...args: unknown[]) =>
    mockIsBlockedExtensionUrlWithDns(...args),
}));

vi.mock("./credential-provider.js", () => ({
  clearProviderCredentialAuthFailure: (...args: unknown[]) =>
    mockClearProviderCredentialAuthFailure(...args),
}));

import { validateProviderBaseUrl } from "../agent/engine/provider-endpoint-validation.js";
import {
  createAgentEngineApiKeyHandler,
  normalizeAgentEngineApiKeyPayload,
  resolveAgentEngineApiKeyWriteTarget,
  validateAgentEngineProviderKey,
} from "./agent-engine-api-key-route.js";
import {
  agentEngineStatusIdentityKey,
  shareAgentEngineStatusLookup,
} from "./agent-engine-status-cache.js";

describe("agent engine api-key route helpers", () => {
  it("validates OpenRouter keys against the authenticated key endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      validateAgentEngineProviderKey("OPENROUTER_API_KEY", "sk-or-example"),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-or-example" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns a replacement-key error when OpenRouter rejects a key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(
      validateAgentEngineProviderKey("OPENROUTER_API_KEY", "sk-or-example"),
    ).resolves.toEqual({
      ok: false,
      statusCode: 400,
      error:
        "OpenRouter rejected this API key. Get a new key from OpenRouter and try again.",
    });
  });

  it("does not store a rejected OpenRouter key", async () => {
    mockWriteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );

    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine-key", {
        method: "POST",
        body: JSON.stringify({
          provider: "openrouter",
          apiKey: "sk-or-example",
        }),
        headers: { "content-type": "application/json" },
      }),
      res: { headers: new Headers(), status: 200 },
    };

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      error:
        "OpenRouter rejected this API key. Get a new key from OpenRouter and try again.",
    });
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight status lookup after saving a provider key", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockWriteAppSecret.mockResolvedValue("secret-id");
    const key = agentEngineStatusIdentityKey("alice@example.test", undefined);
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    let runs = 0;
    const compute = async () => {
      const attempt = ++runs;
      await gate;
      return attempt === 1
        ? { configured: false }
        : { configured: true, engine: "ai-sdk:openai" };
    };
    const stale = shareAgentEngineStatusLookup(key, compute);

    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine/api-key", {
        method: "POST",
        body: JSON.stringify({
          provider: "openai",
          apiKey: "sk-example",
          scope: "user",
        }),
        headers: { "content-type": "application/json" },
      }),
      res: { headers: new Headers(), status: 200 },
    };

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      scope: "user",
    });
    const fresh = shareAgentEngineStatusLookup(key, compute);
    resolveGate();

    await expect(stale).resolves.toEqual({ configured: false });
    await expect(fresh).resolves.toEqual({
      configured: true,
      engine: "ai-sdk:openai",
    });
    expect(runs).toBe(2);
  });

  it("invalidates after a key write even if the endpoint write fails", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockWriteAppSecret
      .mockResolvedValueOnce("secret-id")
      .mockRejectedValueOnce(new Error("database unavailable"));
    const key = agentEngineStatusIdentityKey("alice@example.test", undefined);
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    let runs = 0;
    const compute = async () => {
      const attempt = ++runs;
      await gate;
      return attempt === 1
        ? { configured: false }
        : { configured: true, engine: "ai-sdk:openai" };
    };
    const stale = shareAgentEngineStatusLookup(key, compute);

    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine/api-key", {
        method: "POST",
        body: JSON.stringify({
          provider: "openai",
          apiKey: "sk-example",
          baseUrl: "https://gateway.example/v1",
          scope: "user",
        }),
        headers: { "content-type": "application/json" },
      }),
      res: { headers: new Headers(), status: 200 },
    };

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).rejects.toThrow("database unavailable");
    const fresh = shareAgentEngineStatusLookup(key, compute);
    resolveGate();

    await expect(stale).resolves.toEqual({ configured: false });
    await expect(fresh).resolves.toEqual({
      configured: true,
      engine: "ai-sdk:openai",
    });
    expect(runs).toBe(2);
  });

  it("rejects private provider endpoints at the server validation boundary", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValueOnce(true);

    await expect(
      validateProviderBaseUrl("http://ollama.internal:11434"),
    ).rejects.toThrow("private/internal address");
    expect(mockIsBlockedExtensionUrlWithDns).toHaveBeenCalledWith(
      "http://ollama.internal:11434",
    );
  });

  it("accepts provider aliases and normalizes to provider env keys", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "openai",
        apiKey: " sk-example ",
      }),
    ).toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      value: "sk-example",
      clearBaseUrl: false,
      scope: "user",
    });
  });

  it("accepts OpenAI-compatible endpoint URLs and normalizes trailing slashes", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "openai",
        baseUrl: " https://gateway.example/v1/// ",
      }),
    ).toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      baseUrl: "https://gateway.example/v1",
      clearBaseUrl: false,
      scope: "user",
    });
  });

  it("accepts a local Ollama endpoint URL", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "ollama",
        baseUrl: " http://localhost:11434/// ",
      }),
    ).toEqual({
      ok: true,
      key: "OLLAMA_BASE_URL",
      baseUrl: "http://localhost:11434",
      clearBaseUrl: false,
      scope: "user",
    });
  });

  it("saves the documented local Ollama endpoint in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mockIsBlockedExtensionUrlWithDns.mockClear();
    mockWriteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);

    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine-key", {
        method: "POST",
        body: JSON.stringify({
          provider: "ollama",
          baseUrl: "http://localhost:11434",
        }),
        headers: { "content-type": "application/json" },
      }),
      res: { headers: new Headers(), status: 200 },
    };

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      ok: true,
      key: "OLLAMA_BASE_URL",
      baseUrlKey: "OLLAMA_BASE_URL",
      scope: "user",
    });
    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "OLLAMA_BASE_URL",
      value: "http://localhost:11434",
      scope: "user",
      scopeId: "alice@example.test",
    });
    expect(mockIsBlockedExtensionUrlWithDns).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "test");
  });

  it("rejects endpoint URLs for providers without endpoint support", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "anthropic",
        baseUrl: "https://gateway.example/v1",
      }),
    ).toEqual({
      ok: false,
      statusCode: 400,
      error: "Endpoint URL is only supported for OpenAI or Ollama.",
    });
  });

  it("accepts clearing the saved OpenAI endpoint", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "openai",
        clearBaseUrl: true,
      }),
    ).toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      clearBaseUrl: true,
      scope: "user",
    });
  });

  it("rejects arbitrary non-LLM keys", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        key: "STRIPE_SECRET_KEY",
        value: "sk-example",
      }),
    ).toEqual({
      ok: false,
      statusCode: 400,
      error: "Unsupported agent engine provider key.",
    });
  });

  it("resolves user-scope writes to the signed-in user", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "user"),
    ).resolves.toEqual({
      ok: true,
      target: { scope: "user", scopeId: "alice@example.test" },
    });
    expect(mockGetOrgContext).not.toHaveBeenCalled();
  });

  it("requires owner or admin role for org-scope writes", async () => {
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "org"),
    ).resolves.toEqual({
      ok: false,
      statusCode: 403,
      error: "Only organization owners and admins can set org-scoped keys",
    });
  });

  it("allows owner org-scope writes to the active org", async () => {
    mockGetSession.mockResolvedValue({ email: "owner@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "owner" });

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "org"),
    ).resolves.toEqual({
      ok: true,
      target: { scope: "org", scopeId: "org-1" },
    });
  });
});
