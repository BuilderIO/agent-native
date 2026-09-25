import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockIsBlockedExtensionUrlWithDns = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();
const mockClearProviderCredentialAuthFailure = vi.fn();
const mockIsTrustedSelfHostedRuntime = vi.fn(() => false);

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
  ssrfSafeFetch: vi.fn(),
}));

const mockResolvePersonalProviderKeySaveDenial = vi.fn(
  async (..._args: unknown[]): Promise<string | null> => null,
);

vi.mock("./personal-provider-key-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./personal-provider-key-policy.js")
  >()),
  resolvePersonalProviderKeySaveDenial: (...args: unknown[]) =>
    mockResolvePersonalProviderKeySaveDenial(...args),
}));

vi.mock("./credential-provider.js", () => ({
  clearProviderCredentialAuthFailure: (...args: unknown[]) =>
    mockClearProviderCredentialAuthFailure(...args),
  recordProviderCredentialAuthFailure: vi.fn(),
  isTrustedSelfHostedRuntime: (...args: unknown[]) =>
    mockIsTrustedSelfHostedRuntime(...args),
  resolveSecretDetailed: async () => ({ value: null, lookupFailed: false }),
}));

// Every provider answers the model-list check with an empty list unless a
// test says otherwise.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }))),
  );
});

import { validateProviderBaseUrl } from "../agent/engine/provider-endpoint-validation.js";
import {
  createAgentEngineApiKeyHandler,
  normalizeAgentEngineApiKeyDeletePayload,
  normalizeAgentEngineApiKeyPayload,
  resolveAgentEngineApiKeyWriteTarget,
  validateAgentEngineProviderKey,
} from "./agent-engine-api-key-route.js";

describe("agent engine api-key route helpers", () => {
  it("validates OpenRouter keys against the authenticated key endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/key")
        ? new Response(JSON.stringify({ data: {} }))
        : new Response(JSON.stringify({ data: [{ id: "vendor/model" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      validateAgentEngineProviderKey("OPENROUTER_API_KEY", "sk-or-example"),
    ).resolves.toEqual({ ok: true, models: ["vendor/model"] });
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
      code: "rejected",
      error: "OpenRouter rejected this key.",
    });
  });

  it("checks every provider's key before it is stored", async () => {
    mockWriteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const event = keyRequest("POST", {
      provider: "anthropic",
      apiKey: "sk-ant-example",
    });

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      error: "Anthropic rejected this key.",
      code: "rejected",
    });
    expect(event.res.status).toBe(400);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.anthropic.com/v1/models?limit=1000",
    );
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("refuses another provider's key without sending it", async () => {
    mockWriteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const event = keyRequest("POST", {
      provider: "openai",
      apiKey: "sk-ant-example",
      clearBaseUrl: true,
    });

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      error: "OpenAI rejected this key. This looks like an Anthropic key.",
      code: "wrong-provider",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
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
      error: "OpenRouter rejected this key.",
      code: "rejected",
    });
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("refuses a restricted member's personal save and keeps their stored key", async () => {
    mockWriteAppSecret.mockClear();
    mockDeleteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockResolvePersonalProviderKeySaveDenial.mockResolvedValueOnce(
      "Owners and admins restricted personal API keys.",
    );
    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine-key", {
        method: "POST",
        body: JSON.stringify({
          provider: "anthropic",
          apiKey: "sk-ant-example",
          scope: "user",
        }),
        headers: { "content-type": "application/json" },
      }),
      res: { headers: new Headers(), status: 200 },
    };

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      error: "Owners and admins restricted personal API keys.",
      errorCode: "personal_provider_keys_restricted",
    });
    expect(event.res.status).toBe(403);
    expect(mockResolvePersonalProviderKeySaveDenial).toHaveBeenLastCalledWith(
      event,
      "member@example.test",
      "ANTHROPIC_API_KEY",
    );
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
    expect(mockDeleteAppSecret).not.toHaveBeenCalled();
  });

  it("still lets a restricted member remove their personal key", async () => {
    mockDeleteAppSecret.mockClear();
    mockResolvePersonalProviderKeySaveDenial.mockClear();
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine-key", {
        method: "DELETE",
        body: JSON.stringify({ provider: "anthropic" }),
        headers: { "content-type": "application/json" },
      }),
      res: { headers: new Headers(), status: 200 },
    };

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toMatchObject({ ok: true, scope: "user" });
    expect(mockDeleteAppSecret).toHaveBeenCalledWith({
      key: "ANTHROPIC_API_KEY",
      scope: "user",
      scopeId: "member@example.test",
    });
    expect(mockResolvePersonalProviderKeySaveDenial).not.toHaveBeenCalled();
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

  it("normalizes personal-key removal and its OpenAI endpoint override", () => {
    expect(
      normalizeAgentEngineApiKeyDeletePayload({ provider: "openai" }),
    ).toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      endpointKey: "OPENAI_BASE_URL",
      scope: "user",
    });
    expect(
      normalizeAgentEngineApiKeyDeletePayload({
        provider: "anthropic",
        scope: "org",
      }),
    ).toEqual({ ok: true, key: "ANTHROPIC_API_KEY", scope: "org" });
    expect(
      normalizeAgentEngineApiKeyDeletePayload({ provider: "not-a-provider" }),
    ).toMatchObject({
      ok: false,
      statusCode: 400,
    });
    expect(
      normalizeAgentEngineApiKeyDeletePayload({
        provider: "anthropic",
        scope: "workspace",
      }),
    ).toEqual({
      ok: false,
      statusCode: 400,
      error: 'scope must be "user" or "org"',
    });
  });

  it("removes only the caller's personal OpenAI key and endpoint", async () => {
    mockDeleteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine-key", {
        method: "DELETE",
        body: JSON.stringify({ provider: "openai" }),
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
    expect(mockDeleteAppSecret).toHaveBeenNthCalledWith(1, {
      key: "OPENAI_API_KEY",
      scope: "user",
      scopeId: "alice@example.test",
    });
    expect(mockDeleteAppSecret).toHaveBeenNthCalledWith(2, {
      key: "OPENAI_BASE_URL",
      scope: "user",
      scopeId: "alice@example.test",
    });
    expect(mockGetOrgContext).not.toHaveBeenCalled();
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

  it("silently strips a copy-pasted /v1 suffix from an Ollama endpoint", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "ollama",
        baseUrl: "http://192.168.1.68:11434/v1",
      }),
    ).toEqual({
      ok: true,
      key: "OLLAMA_BASE_URL",
      baseUrl: "http://192.168.1.68:11434",
      clearBaseUrl: false,
      scope: "user",
    });
  });

  it("keeps a /v1 suffix on an OpenAI-compatible gateway endpoint", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "openai",
        baseUrl: "https://gateway.example/v1",
      }),
    ).toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      baseUrl: "https://gateway.example/v1",
      clearBaseUrl: false,
      scope: "user",
    });
  });

  it("saves the documented local Ollama endpoint on a trusted self-hosted runtime", async () => {
    mockIsBlockedExtensionUrlWithDns.mockClear();
    mockWriteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    mockIsTrustedSelfHostedRuntime.mockReturnValueOnce(true);

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
  });

  it("accepts a LAN Ollama endpoint on a trusted self-hosted runtime", async () => {
    mockIsBlockedExtensionUrlWithDns.mockClear();
    mockWriteAppSecret.mockClear();
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    mockIsTrustedSelfHostedRuntime.mockReturnValueOnce(true);

    const event = {
      req: new Request("http://localhost/_agent-native/agent-engine-key", {
        method: "POST",
        body: JSON.stringify({
          provider: "ollama",
          baseUrl: "http://192.168.1.123:11434",
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
      value: "http://192.168.1.123:11434",
      scope: "user",
      scopeId: "alice@example.test",
    });
    expect(mockIsBlockedExtensionUrlWithDns).not.toHaveBeenCalled();
  });

  it("rejects a local Ollama endpoint outside a trusted self-hosted runtime", async () => {
    mockIsTrustedSelfHostedRuntime.mockReturnValueOnce(false);
    mockIsBlockedExtensionUrlWithDns.mockResolvedValueOnce(true);
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });

    const event = {
      req: new Request("http://example.test/_agent-native/agent-engine-key", {
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
      error:
        "Endpoint URL resolves to a private/internal address — SSRF not allowed.",
    });
  });

  it("rejects a LAN Ollama endpoint outside a trusted self-hosted runtime", async () => {
    mockIsTrustedSelfHostedRuntime.mockReturnValueOnce(false);
    mockIsBlockedExtensionUrlWithDns.mockResolvedValueOnce(true);
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });

    const event = {
      req: new Request("http://example.test/_agent-native/agent-engine-key", {
        method: "POST",
        body: JSON.stringify({
          provider: "ollama",
          baseUrl: "http://192.168.1.123:11434",
        }),
        headers: { "content-type": "application/json" },
      }),
      res: { headers: new Headers(), status: 200 },
    };

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      error:
        "Endpoint URL resolves to a private/internal address — SSRF not allowed.",
    });
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

  it("saves an org-scope request from a caller with no organization as personal", async () => {
    mockGetSession.mockResolvedValue({ email: "solo@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: null, role: null });

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "org"),
    ).resolves.toEqual({
      ok: true,
      target: { scope: "user", scopeId: "solo@example.test" },
    });
  });

  it("does not downgrade an org save when the org context is unreadable", async () => {
    mockGetSession.mockResolvedValue({ email: "owner@example.test" });
    mockGetOrgContext.mockRejectedValueOnce(new Error("org_members timeout"));

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "org"),
    ).rejects.toThrow("org_members timeout");
  });

  it("saves a member's key at personal scope", async () => {
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });
    mockWriteAppSecret.mockClear();
    mockDeleteAppSecret.mockClear();

    const event = keyRequest("POST", {
      provider: "anthropic",
      apiKey: "sk-ant-example",
      scope: "user",
    });

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({ ok: true, key: "ANTHROPIC_API_KEY", scope: "user" });
    expect(event.res.status).toBe(200);
    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "ANTHROPIC_API_KEY",
      value: "sk-ant-example",
      scope: "user",
      scopeId: "member@example.test",
    });
    expect(mockDeleteAppSecret).not.toHaveBeenCalled();
  });

  it("refuses a member's organization save", async () => {
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });
    mockWriteAppSecret.mockClear();

    const event = keyRequest("POST", {
      provider: "anthropic",
      apiKey: "sk-ant-example",
      scope: "org",
    });

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      error: "Only organization owners and admins can set org-scoped keys",
    });
    expect(event.res.status).toBe(403);
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("keeps the admin's personal key when saving an organization key", async () => {
    mockGetSession.mockResolvedValue({ email: "admin@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "admin" });
    mockWriteAppSecret.mockClear();
    mockDeleteAppSecret.mockClear();

    await expect(
      createAgentEngineApiKeyHandler()(
        keyRequest("POST", {
          provider: "openai",
          apiKey: "sk-example",
          scope: "org",
        }) as any,
      ),
    ).resolves.toMatchObject({ ok: true, scope: "org" });
    expect(mockWriteAppSecret).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      value: "sk-example",
      scope: "org",
      scopeId: "org-1",
    });
    expect(mockDeleteAppSecret).not.toHaveBeenCalled();
  });

  it("removes an organization key and endpoint for an admin", async () => {
    mockGetSession.mockResolvedValue({ email: "admin@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "admin" });
    mockDeleteAppSecret.mockClear();

    await expect(
      createAgentEngineApiKeyHandler()(
        keyRequest("DELETE", { provider: "openai", scope: "org" }) as any,
      ),
    ).resolves.toEqual({ ok: true, key: "OPENAI_API_KEY", scope: "org" });
    // The legacy workspace row for the organization resolves after the org
    // row, so leaving it would keep the provider working.
    expect(mockDeleteAppSecret.mock.calls.map(([ref]) => ref)).toEqual([
      { key: "OPENAI_API_KEY", scope: "org", scopeId: "org-1" },
      { key: "OPENAI_BASE_URL", scope: "org", scopeId: "org-1" },
      { key: "OPENAI_API_KEY", scope: "workspace", scopeId: "org-1" },
      { key: "OPENAI_BASE_URL", scope: "workspace", scopeId: "org-1" },
    ]);
  });

  it("removes a Gemini key under both of its names", async () => {
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });
    mockDeleteAppSecret.mockClear();

    await expect(
      createAgentEngineApiKeyHandler()(
        keyRequest("DELETE", { provider: "google", scope: "user" }) as any,
      ),
    ).resolves.toEqual({
      ok: true,
      key: "GOOGLE_GENERATIVE_AI_API_KEY",
      scope: "user",
    });
    expect(mockDeleteAppSecret.mock.calls.map(([ref]) => ref)).toEqual([
      {
        key: "GOOGLE_GENERATIVE_AI_API_KEY",
        scope: "user",
        scopeId: "member@example.test",
      },
      {
        key: "GEMINI_API_KEY",
        scope: "user",
        scopeId: "member@example.test",
      },
      {
        key: "GOOGLE_GENERATIVE_AI_API_KEY",
        scope: "workspace",
        scopeId: "solo:member@example.test",
      },
      {
        key: "GEMINI_API_KEY",
        scope: "workspace",
        scopeId: "solo:member@example.test",
      },
    ]);
  });

  it("refuses a member's organization key removal", async () => {
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });
    mockDeleteAppSecret.mockClear();

    const event = keyRequest("DELETE", {
      provider: "anthropic",
      scope: "org",
    });

    await expect(
      createAgentEngineApiKeyHandler()(event as any),
    ).resolves.toEqual({
      error: "Only organization owners and admins can set org-scoped keys",
    });
    expect(event.res.status).toBe(403);
    expect(mockDeleteAppSecret).not.toHaveBeenCalled();
  });
});

function keyRequest(method: "POST" | "DELETE", body: Record<string, unknown>) {
  return {
    req: new Request("http://localhost/_agent-native/agent-engine-key", {
      method,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    res: { headers: new Headers(), status: 200 },
  };
}
