import type { H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockIsBlockedExtensionUrlWithDns = vi.fn();
const mockWriteAppSecret = vi.fn();

vi.mock("./auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
}));

vi.mock("../secrets/storage.js", () => ({
  writeAppSecret: (...args: unknown[]) => mockWriteAppSecret(...args),
  deleteAppSecret: vi.fn(),
}));

vi.mock("../extensions/url-safety.js", () => ({
  isBlockedExtensionUrlWithDns: (...args: unknown[]) =>
    mockIsBlockedExtensionUrlWithDns(...args),
}));

import { validateProviderBaseUrl } from "../agent/engine/provider-endpoint-validation.js";
import {
  createAgentEngineApiKeyHandler,
  normalizeAgentEngineApiKeyPayload,
  resolveAgentEngineApiKeyWriteTarget,
} from "./agent-engine-api-key-route.js";

describe("agent engine api-key route helpers", () => {
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
