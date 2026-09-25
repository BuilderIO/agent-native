import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockSsrfSafeFetch = vi.fn();
const mockIsBlockedExtensionUrlWithDns = vi.fn();
const mockResolveSecretDetailed = vi.fn();
const mockReadAppSecret = vi.fn();
const mockClearFailure = vi.fn();
const mockRecordFailure = vi.fn();
const mockIsTrustedSelfHostedRuntime = vi.fn(() => false);
const mockGetOrgRoleForEmail = vi.fn();

vi.mock("../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: (...args: unknown[]) => mockGetOrgRoleForEmail(...args),
}));

vi.mock("./auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: unknown[]) => mockGetOrgContext(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
  isBlockedExtensionUrlWithDns: (...args: unknown[]) =>
    mockIsBlockedExtensionUrlWithDns(...args),
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: unknown[]) => mockReadAppSecret(...args),
}));

vi.mock("./credential-provider.js", () => ({
  clearProviderCredentialAuthFailure: (...args: unknown[]) =>
    mockClearFailure(...args),
  recordProviderCredentialAuthFailure: (...args: unknown[]) =>
    mockRecordFailure(...args),
  isTrustedSelfHostedRuntime: () => mockIsTrustedSelfHostedRuntime(),
  resolveSecretDetailed: (...args: unknown[]) =>
    mockResolveSecretDetailed(...args),
}));

import {
  checkProviderKey,
  checkProviderKeyForSave,
  createAgentEngineProviderModelsHandler,
  ProviderKeyCheckRequestError,
} from "./agent-engine-provider-models-route.js";
import { runWithRequestContext } from "./request-context.js";

// Obviously fake placeholders; none of these are real keys.
const FAKE = {
  anthropic: "sk-ant-fake-placeholder",
  openai: "sk-fake-placeholder",
  openrouter: "sk-or-fake-placeholder",
  google: "AIzaFakePlaceholder",
  groq: "gsk_fake_placeholder",
  mistral: "fake-mistral-placeholder",
  cohere: "fake-cohere-placeholder",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function asUser<T>(fn: () => Promise<T>) {
  return runWithRequestContext(
    { userEmail: "alice@example.test", orgId: "org-1" },
    fn,
  ) as Promise<T>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockIsBlockedExtensionUrlWithDns.mockResolvedValue(false);
  mockIsTrustedSelfHostedRuntime.mockReturnValue(false);
  mockResolveSecretDetailed.mockResolvedValue({
    value: null,
    lookupFailed: false,
  });
  mockReadAppSecret.mockResolvedValue(null);
  mockGetOrgRoleForEmail.mockResolvedValue("admin");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkProviderKey: model lists per provider", () => {
  it("lists Anthropic models across pages with the key header", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          data: [{ id: "claude-a" }],
          has_more: true,
          last_id: "claude-a",
        }),
      )
      .mockResolvedValueOnce(json({ data: [{ id: "claude-b" }] }));

    const result = await asUser(() =>
      checkProviderKey({ provider: "anthropic", key: FAKE.anthropic }),
    );

    expect(result).toMatchObject({
      ok: true,
      models: ["claude-a", "claude-b"],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.anthropic.com/v1/models?limit=1000",
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "x-api-key": FAKE.anthropic,
      "anthropic-version": "2023-06-01",
    });
    expect(fetchMock.mock.calls[1][0]).toContain("after_id=claude-a");
    expect(mockClearFailure).toHaveBeenCalledWith({
      key: "ANTHROPIC_API_KEY",
      value: FAKE.anthropic,
    });
  });

  it("lists OpenAI chat models and drops audio, image, and embedding models", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { id: "gpt-5.6-sol" },
          { id: "text-embedding-3-large" },
          { id: "whisper-1" },
          { id: "dall-e-3" },
          { id: "tts-1" },
          { id: "o5-mini" },
        ],
      }),
    );

    const result = await asUser(() =>
      checkProviderKey({ provider: "openai", key: FAKE.openai, baseUrl: null }),
    );

    expect(result).toMatchObject({
      ok: true,
      models: ["gpt-5.6-sol", "o5-mini"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${FAKE.openai}` },
      }),
    );
  });

  it("lists an OpenAI-compatible gateway through the SSRF guard, unfiltered", async () => {
    mockSsrfSafeFetch.mockResolvedValueOnce(
      json({ data: [{ id: "claude-via-gateway" }, { id: "embed-x" }] }),
    );

    const result = await asUser(() =>
      checkProviderKey({
        provider: "openai",
        key: "virtual-gateway-key",
        baseUrl: "https://gateway.example/v1",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      models: ["claude-via-gateway", "embed-x"],
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://gateway.example/v1/models",
      expect.anything(),
      { allowedPrivateOrigins: [] },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the saved OpenAI endpoint when none is passed", async () => {
    mockResolveSecretDetailed.mockImplementation(async (key: string) =>
      key === "OPENAI_BASE_URL"
        ? {
            value: "https://gateway.example/v1",
            lookupFailed: false,
            source: "org",
            scopeId: "org-1",
          }
        : { value: null, lookupFailed: false },
    );
    mockSsrfSafeFetch.mockResolvedValueOnce(json({ data: [{ id: "m" }] }));

    await asUser(() =>
      checkProviderKey({ provider: "openai", key: "virtual-gateway-key" }),
    );

    expect(mockSsrfSafeFetch.mock.calls[0][0]).toBe(
      "https://gateway.example/v1/models",
    );
  });

  it("lists Gemini models that support generateContent", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        models: [
          {
            name: "models/gemini-3-1-pro",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      }),
    );

    const result = await asUser(() =>
      checkProviderKey({ provider: "google", key: FAKE.google }),
    );

    expect(result).toMatchObject({ ok: true, models: ["gemini-3-1-pro"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    );
    expect(url).not.toContain(FAKE.google);
    expect(init.headers).toEqual({ "x-goog-api-key": FAKE.google });
  });

  it("lists Groq, Mistral, and Cohere chat models", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          data: [
            { id: "llama-4-70b" },
            { id: "whisper-large-v3" },
            { id: "retired", active: false },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: "mistral-large-latest",
              capabilities: { completion_chat: true },
            },
            { id: "mistral-embed", capabilities: { completion_chat: false } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({ models: [{ name: "command-a" }], next_page_token: "" }),
      );

    await expect(
      asUser(() => checkProviderKey({ provider: "groq", key: FAKE.groq })),
    ).resolves.toMatchObject({ ok: true, models: ["llama-4-70b"] });
    await expect(
      asUser(() =>
        checkProviderKey({ provider: "mistral", key: FAKE.mistral }),
      ),
    ).resolves.toMatchObject({ ok: true, models: ["mistral-large-latest"] });
    await expect(
      asUser(() => checkProviderKey({ provider: "cohere", key: FAKE.cohere })),
    ).resolves.toMatchObject({ ok: true, models: ["command-a"] });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.groq.com/openai/v1/models",
      "https://api.mistral.ai/v1/models",
      "https://api.cohere.com/v1/models?endpoint=chat&page_size=1000",
    ]);
  });

  it("checks an OpenRouter key on the key endpoint and lists its models", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/key")
        ? json({ data: { label: "fake" } })
        : json({ data: [{ id: "anthropic/claude-sonnet-5" }] }),
    );

    const result = await asUser(() =>
      checkProviderKey({ provider: "openrouter", key: FAKE.openrouter }),
    );

    expect(result).toMatchObject({
      ok: true,
      models: ["anthropic/claude-sonnet-5"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${FAKE.openrouter}` },
      }),
    );
  });

  it("lists installed Ollama models", async () => {
    mockIsTrustedSelfHostedRuntime.mockReturnValue(true);
    mockSsrfSafeFetch.mockResolvedValueOnce(
      json({ models: [{ name: "qwen3.8:latest" }] }),
    );

    const result = await asUser(() =>
      checkProviderKey({
        provider: "ollama",
        baseUrl: "http://localhost:11434",
      }),
    );

    expect(result).toMatchObject({ ok: true, models: ["qwen3.8:latest"] });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.anything(),
      { allowedPrivateOrigins: ["http://localhost:11434"] },
    );
  });
});

describe("checkProviderKey: failures", () => {
  it("reports a generic rejection when the key has the right prefix", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { message: "invalid x-api-key sk-ant-fake…" } }, 401),
    );

    const result = await asUser(() =>
      checkProviderKey({ provider: "anthropic", key: FAKE.anthropic }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "rejected",
      status: 401,
      reason: "Anthropic rejected this key.",
      models: [],
    });
    // Provider error bodies can echo the key; nothing from them is returned.
    expect(JSON.stringify(result)).not.toContain("sk-ant-fake");
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("names the expected prefix when a rejected key lacks it", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401));

    await expect(
      asUser(() =>
        checkProviderKey({ provider: "groq", key: "not-a-groq-key" }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "rejected",
      reason: "Groq keys start with gsk_.",
      expectedPrefix: "gsk_",
    });
  });

  it("treats Google's API_KEY_INVALID 400 as a rejection", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: {
            status: "INVALID_ARGUMENT",
            details: [{ reason: "API_KEY_INVALID" }],
          },
        },
        400,
      ),
    );

    await expect(
      asUser(() => checkProviderKey({ provider: "google", key: FAKE.google })),
    ).resolves.toMatchObject({
      ok: false,
      code: "rejected",
      reason: "Google Gemini rejected this key.",
    });
  });

  it("refuses another provider's key without sending it anywhere", async () => {
    const result = await asUser(() =>
      checkProviderKey({
        provider: "openai",
        key: FAKE.anthropic,
        baseUrl: null,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "wrong-provider",
      reason: "This looks like an Anthropic key.",
      detectedProvider: "anthropic",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when a provider can't be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(
      asUser(() =>
        checkProviderKey({ provider: "mistral", key: FAKE.mistral }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "unreachable",
      reason: "Couldn't reach Mistral.",
    });
  });

  it("reports a provider outage without calling the key rejected", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503));

    await expect(
      asUser(() => checkProviderKey({ provider: "cohere", key: FAKE.cohere })),
    ).resolves.toMatchObject({
      ok: false,
      code: "provider-error",
      status: 503,
    });
  });

  it("refuses a private gateway endpoint", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValueOnce(true);

    const result = await asUser(() =>
      checkProviderKey({
        provider: "openai",
        key: FAKE.openai,
        baseUrl: "http://10.0.0.5/v1",
      }),
    );

    expect(result).toMatchObject({ ok: false, code: "invalid-endpoint" });
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("says Ollama couldn't be reached", async () => {
    mockIsTrustedSelfHostedRuntime.mockReturnValue(true);
    mockSsrfSafeFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      asUser(() => checkProviderKey({ provider: "ollama", baseUrl: null })),
    ).resolves.toMatchObject({
      ok: false,
      code: "unreachable",
      reason: "Couldn't reach Ollama.",
    });
  });
});

describe("checkProviderKey: the saved key", () => {
  it("records a rejection of the saved key so Settings shows it", async () => {
    mockResolveSecretDetailed.mockResolvedValue({
      value: FAKE.anthropic,
      lookupFailed: false,
      source: "user",
      scopeId: "alice@example.test",
    });
    fetchMock.mockResolvedValueOnce(json({}, 401));

    await asUser(() => checkProviderKey({ provider: "anthropic" }));

    expect(fetchMock.mock.calls[0][1].headers["x-api-key"]).toBe(
      FAKE.anthropic,
    );
    expect(mockRecordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "ANTHROPIC_API_KEY",
        value: FAKE.anthropic,
        status: 401,
      }),
    );
  });

  it("reads one scope's row when a scope is named", async () => {
    mockReadAppSecret.mockResolvedValue({ value: FAKE.openrouter });
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/key") ? json({}) : json({ data: [] }),
    );

    await asUser(() =>
      checkProviderKey({ provider: "openrouter", scope: "org" }),
    );

    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "OPENROUTER_API_KEY",
      scope: "org",
      scopeId: "org-1",
    });
    expect(mockResolveSecretDetailed).not.toHaveBeenCalled();
  });

  it("never checks a deployment environment key as the saved key", async () => {
    mockResolveSecretDetailed.mockResolvedValue({
      value: "sk-ant-from-env",
      lookupFailed: false,
      source: "env",
    });

    await expect(
      asUser(() => checkProviderKey({ provider: "anthropic" })),
    ).resolves.toMatchObject({
      ok: false,
      code: "missing-key",
      reason: "No Anthropic key is saved.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws instead of reporting a missing key when the store is unreadable", async () => {
    mockResolveSecretDetailed.mockResolvedValue({
      value: null,
      lookupFailed: true,
    });

    await expect(
      asUser(() => checkProviderKey({ provider: "anthropic" })),
    ).rejects.toThrow("credential store");
  });

  it("never sends a saved key to an endpoint from the request", async () => {
    mockResolveSecretDetailed.mockResolvedValue({
      value: FAKE.openai,
      lookupFailed: false,
      source: "org",
      scopeId: "org-1",
    });
    mockReadAppSecret.mockResolvedValue({ value: FAKE.openai });

    for (const input of [
      { provider: "openai" as const, baseUrl: "https://evil.example/v1" },
      {
        provider: "openai" as const,
        baseUrl: "https://evil.example/v1",
        scope: "org" as const,
      },
      { provider: "openai" as const, baseUrl: null },
    ]) {
      await expect(asUser(() => checkProviderKey(input))).rejects.toThrow(
        ProviderKeyCheckRequestError,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    expect(mockReadAppSecret).not.toHaveBeenCalled();
    expect(mockResolveSecretDetailed).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("refuses a member checking the organization's key before reading it", async () => {
    mockGetOrgRoleForEmail.mockResolvedValue("member");
    mockReadAppSecret.mockResolvedValue({ value: FAKE.openai });

    await expect(
      asUser(() => checkProviderKey({ provider: "openai", scope: "org" })),
    ).rejects.toMatchObject({
      name: "ProviderKeyCheckRequestError",
      statusCode: 403,
    });
    expect(mockGetOrgRoleForEmail).toHaveBeenCalledWith(
      "org-1",
      "alice@example.test",
    );
    expect(mockReadAppSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("records a saved OpenAI key's rejection at the endpoint chats use", async () => {
    mockResolveSecretDetailed.mockImplementation(async (key: string) => ({
      value: key === "OPENAI_BASE_URL" ? "https://gateway.example/v1" : "vk-1",
      lookupFailed: false,
      source: "org",
      scopeId: "org-1",
    }));
    mockSsrfSafeFetch.mockResolvedValueOnce(json({}, 401));

    await asUser(() => checkProviderKey({ provider: "openai" }));

    expect(mockSsrfSafeFetch.mock.calls[0][0]).toBe(
      "https://gateway.example/v1/models",
    );
    expect(mockRecordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ key: "OPENAI_API_KEY", value: "vk-1" }),
    );
  });

  it("writes no marker when the check reached another endpoint than chats use", async () => {
    // The personal row has no endpoint, so the check goes to the default
    // while chats pair the key with the organization's gateway.
    mockReadAppSecret.mockImplementation(async ({ key }: { key: string }) =>
      key === "OPENAI_API_KEY" ? { value: "vk-1" } : null,
    );
    mockResolveSecretDetailed.mockResolvedValue({
      value: "https://gateway.example/v1",
      lookupFailed: false,
      source: "org",
      scopeId: "org-1",
    });
    fetchMock.mockResolvedValueOnce(json({}, 401));

    await expect(
      asUser(() => checkProviderKey({ provider: "openai", scope: "user" })),
    ).resolves.toMatchObject({ ok: false, code: "rejected" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("never clears a marker from a pasted key checked at a pasted endpoint", async () => {
    mockSsrfSafeFetch.mockResolvedValueOnce(json({ data: [{ id: "m" }] }));

    await asUser(() =>
      checkProviderKey({
        provider: "openai",
        key: "vk-1",
        baseUrl: "https://gateway.example/v1",
      }),
    );

    expect(mockClearFailure).not.toHaveBeenCalled();
  });
});

describe("checkProviderKeyForSave", () => {
  it("folds a rejection into a 400 with the headline and reason", async () => {
    await expect(
      asUser(() =>
        checkProviderKeyForSave({
          provider: "openrouter",
          key: FAKE.anthropic,
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      statusCode: 400,
      code: "wrong-provider",
      error: "OpenRouter rejected this key. This looks like an Anthropic key.",
    });
  });

  it("refuses to store a key it couldn't verify", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      asUser(() =>
        checkProviderKeyForSave({
          provider: "openrouter",
          key: FAKE.openrouter,
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      statusCode: 502,
      code: "unreachable",
    });
  });
});

describe("POST /_agent-native/agent-engine/provider-models", () => {
  function post(body: unknown) {
    return {
      req: new Request(
        "http://localhost/_agent-native/agent-engine/provider-models",
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        },
      ),
      res: { headers: new Headers(), status: 200 },
      context: {},
    };
  }

  it("requires a session and never fetches without one", async () => {
    mockGetSession.mockResolvedValue(null);
    const event = post({ provider: "anthropic", key: FAKE.anthropic });

    await expect(
      createAgentEngineProviderModelsHandler()(event as any),
    ).resolves.toEqual({ error: "Authentication required" });
    expect(event.res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported provider", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    const event = post({ provider: "not-a-provider" });

    await expect(
      createAgentEngineProviderModelsHandler()(event as any),
    ).resolves.toEqual({ error: "Choose a supported provider." });
    expect(event.res.status).toBe(400);
  });

  it("refuses a request endpoint for the saved key with a 400 and no fetch", async () => {
    mockGetSession.mockResolvedValue({ email: "mallory@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });
    mockResolveSecretDetailed.mockResolvedValue({
      value: FAKE.openai,
      lookupFailed: false,
      source: "org",
      scopeId: "org-1",
    });
    mockReadAppSecret.mockResolvedValue({ value: FAKE.openai });
    const event = post({
      provider: "openai",
      baseUrl: "https://evil.example/v1",
    });

    const result = await createAgentEngineProviderModelsHandler()(event as any);

    expect(event.res.status).toBe(400);
    expect(result).toEqual({
      error:
        "Pass a key with baseUrl. A saved key is only checked against its saved endpoint.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("refuses a member checking the organization scope with a 403 and no fetch", async () => {
    mockGetSession.mockResolvedValue({ email: "mallory@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });
    mockGetOrgRoleForEmail.mockResolvedValue("member");
    mockReadAppSecret.mockResolvedValue({ value: FAKE.openai });
    const event = post({ provider: "openai", scope: "org" });

    const result = await createAgentEngineProviderModelsHandler()(event as any);

    expect(event.res.status).toBe(403);
    expect(result).toEqual({
      error: "Only organization owners and admins can check organization keys.",
    });
    expect(mockReadAppSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("answers a provider verdict with 200 and reads saved rows as the caller", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "admin" });
    mockReadAppSecret.mockResolvedValue({ value: FAKE.groq });
    fetchMock.mockResolvedValueOnce(json({}, 401));
    const event = post({ provider: "groq", scope: "org" });

    const result = await createAgentEngineProviderModelsHandler()(event as any);

    expect(event.res.status).toBe(200);
    expect(result).toMatchObject({ ok: false, code: "rejected" });
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "GROQ_API_KEY",
      scope: "org",
      scopeId: "org-1",
    });
  });
});
