import { describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockIsTrustedSelfHostedRuntime = vi.fn(() => true);
const mockSsrfSafeFetch = vi.fn();

vi.mock("./auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: unknown[]) => mockGetOrgContext(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

// Deliberately real `request-context.js` (not mocked) — this test exists to
// prove the route establishes ambient request identity via
// `runWithRequestContext` *before* reading the saved secret, so `resolveSecret`
// here answers only when `getRequestUserEmail()` sees it, exactly like the
// production implementation. Mocking request-context.js away would hide the
// regression this test was written to catch (a route that reads secrets
// without ever setting up whose secrets to read).
vi.mock("./credential-provider.js", async () => {
  const requestContext = await vi.importActual<
    typeof import("./request-context.js")
  >("./request-context.js");
  return {
    isTrustedSelfHostedRuntime: (...args: unknown[]) =>
      mockIsTrustedSelfHostedRuntime(...args),
    resolveSecret: async (key: string): Promise<string | null> => {
      const email = requestContext.getRequestUserEmail();
      if (!email) return null;
      return key === "OLLAMA_BASE_URL" ? "http://192.168.1.68:11434" : null;
    },
  };
});

import { createAgentEngineOllamaModelsHandler } from "./agent-engine-ollama-models-route.js";

function makeEvent(url: string) {
  return {
    req: new Request(url),
    res: { headers: new Headers(), status: 200 },
  };
}

describe("agent-engine ollama-models route", () => {
  it("reads the saved Ollama endpoint instead of the localhost default for a signed-in session", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1" });
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen3.8:latest" }] }), {
        status: 200,
      }),
    );

    const handler = createAgentEngineOllamaModelsHandler();
    const result = await handler(
      makeEvent(
        "http://localhost:8080/_agent-native/agent-engine/ollama-models",
      ) as any,
    );

    expect(result).toEqual({ ok: true, models: ["qwen3.8:latest"] });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "http://192.168.1.68:11434/api/tags",
      expect.anything(),
      expect.anything(),
    );
  });

  it("rejects with 401 and never fetches when there is no signed-in session", async () => {
    mockGetSession.mockResolvedValue(null);
    mockSsrfSafeFetch.mockClear();

    const handler = createAgentEngineOllamaModelsHandler();
    const event = makeEvent(
      "http://localhost:8080/_agent-native/agent-engine/ollama-models",
    ) as any;
    const result = await handler(event);

    expect(result).toEqual({ error: "Authentication required" });
    expect(event.res.status).toBe(401);
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("prefers an explicit ?baseUrl= query param over the saved endpoint", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1" });
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const handler = createAgentEngineOllamaModelsHandler();
    await handler(
      makeEvent(
        "http://localhost:8080/_agent-native/agent-engine/ollama-models?baseUrl=http://192.168.1.129:11434",
      ) as any,
    );

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "http://192.168.1.129:11434/api/tags",
      expect.anything(),
      expect.anything(),
    );
  });

  it("silently strips a copy-pasted /v1 suffix before hitting the native API", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1" });
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const handler = createAgentEngineOllamaModelsHandler();
    await handler(
      makeEvent(
        "http://localhost:8080/_agent-native/agent-engine/ollama-models?baseUrl=http://192.168.1.129:11434/v1",
      ) as any,
    );

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "http://192.168.1.129:11434/api/tags",
      expect.anything(),
      expect.anything(),
    );
  });
});
