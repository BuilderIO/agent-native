import { afterEach, describe, expect, it, vi } from "vitest";

import {
  saveAgentEngineApiKey,
  saveAgentEngineProviderSettings,
  setAgentEngineProvider,
} from "./agent-engine-key.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saveAgentEngineApiKey", () => {
  it("stores provider keys through the scoped agent-engine API key route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveAgentEngineApiKey({
      provider: "openai",
      apiKey: " sk-example ",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/agent-engine/api-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "OPENAI_API_KEY",
          value: "sk-example",
        }),
      },
    );
  });

  it("stores OpenAI endpoint settings without requiring a new API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveAgentEngineProviderSettings({
      provider: "openai",
      baseUrl: " https://gateway.example/v1 ",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/agent-engine/api-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "OPENAI_API_KEY",
          baseUrl: "https://gateway.example/v1",
        }),
      },
    );
  });

  it("preserves plain-text relay errors for the setup UI", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          "Desktop app chat relay failed. Update or restart the desktop app, then try again.",
          { status: 502 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveAgentEngineProviderSettings({
        provider: "openrouter",
        apiKey: "sk-or-example",
      }),
    ).rejects.toThrow(
      "Desktop app chat relay failed. Update or restart the desktop app, then try again.",
    );
  });

  it("uses the HTTP fallback for primitive JSON error bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("null", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveAgentEngineProviderSettings({
        provider: "openrouter",
        apiKey: "sk-or-example",
      }),
    ).rejects.toThrow("Could not save provider settings (HTTP 502).");
  });
});

describe("setAgentEngineProvider", () => {
  function response(body: unknown, status = 200): Response {
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status },
    );
  }

  function observeConfiguredChanges(): ReturnType<typeof vi.fn> {
    const dispatchEvent = vi.fn();
    class FakeCustomEvent {
      constructor(readonly type: string) {}
    }
    vi.stubGlobal("window", {
      dispatchEvent,
      location: { pathname: "/settings" },
    });
    vi.stubGlobal("CustomEvent", FakeCustomEvent);
    return dispatchEvent;
  }

  it.each([
    {
      name: "a bare result",
      body: { ok: true, engine: "ai-sdk:openai", model: "gpt-5.4" },
    },
    {
      name: "an enveloped result",
      body: {
        result: {
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        },
      },
    },
    {
      name: "a stringified result",
      body: JSON.stringify(
        JSON.stringify({
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        }),
      ),
    },
    {
      name: "an enveloped stringified result",
      body: {
        result: JSON.stringify({
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        }),
      },
    },
  ])("accepts $name and returns the saved selection", async ({ body }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    const dispatchEvent = observeConfiguredChanges();

    await expect(
      setAgentEngineProvider({ provider: "openai", model: "gpt-4o" }),
    ).resolves.toEqual({ engine: "ai-sdk:openai", model: "gpt-5.4" });
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: "agent-engine:configured-changed",
    });
  });

  it.each([
    ["bare error", "Error: optional packages are not installed"],
    ["bare warning", "Warning: credentials are not configured"],
    ["enveloped error", { error: "Engine selection failed" }],
    [
      "failed envelope with an actionable error",
      { ok: false, error: "Engine selection failed" },
    ],
    [
      "warning envelope",
      {
        warning: "Credentials are not configured",
        result: {
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        },
      },
    ],
    ["nested error", { result: "Error: engine unavailable" }],
    [
      "contradictory failed envelope",
      {
        ok: false,
        result: {
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        },
      },
    ],
    [
      "structured envelope error",
      {
        error: { message: "Engine selection failed" },
        result: {
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        },
      },
    ],
    [
      "nested failed envelope",
      {
        result: {
          ok: false,
          result: {
            ok: true,
            engine: "ai-sdk:openai",
            model: "gpt-5.4",
          },
        },
      },
    ],
    [
      "null envelope error",
      {
        error: null,
        result: {
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        },
      },
    ],
    [
      "malformed envelope success marker",
      {
        ok: "true",
        result: {
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        },
      },
    ],
    [
      "explicit failure",
      { ok: false, engine: "ai-sdk:openai", model: "gpt-5.4" },
    ],
    ["missing success marker", { engine: "ai-sdk:openai", model: "gpt-5.4" }],
    ["wrong engine", { ok: true, engine: "anthropic", model: "gpt-5.4" }],
    ["missing model", { ok: true, engine: "ai-sdk:openai" }],
    ["empty response", ""],
    ["truncated response", '{"ok":true,"engine":"ai-sdk:openai"'],
  ])(
    "rejects %s without dispatching a configured event",
    async (_name, body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
      const dispatchEvent = observeConfiguredChanges();

      await expect(
        setAgentEngineProvider({ provider: "openai", model: "gpt-4o" }),
      ).rejects.toThrow();
      expect(dispatchEvent).not.toHaveBeenCalled();
    },
  );

  it("preserves a bare HTTP-200 action error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response(
            'Error: Engine "ai-sdk:openai" requires optional packages that are not installed in this app.',
          ),
        ),
    );

    await expect(
      setAgentEngineProvider({ provider: "openai", model: "gpt-4o" }),
    ).rejects.toThrow("requires optional packages");
  });
});
