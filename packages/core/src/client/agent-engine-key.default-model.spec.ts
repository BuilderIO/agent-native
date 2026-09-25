import { afterEach, describe, expect, it, vi } from "vitest";

import {
  saveAgentEngineProviderSettings,
  setAgentEngineProvider,
} from "./agent-engine-key.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("saving a key picks the default model", () => {
  it("sends the provider's engine and reports the server's selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        key: "OPENAI_API_KEY",
        scope: "org",
        defaultModel: {
          status: "selected",
          engine: "ai-sdk:openai",
          model: "gpt-5.5",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveAgentEngineProviderSettings({
        provider: "openai",
        apiKey: "sk-obviously-fake",
        scope: "org",
        defaultModel: { model: " gpt-5.5 " },
      }),
    ).resolves.toEqual({
      defaultModel: {
        status: "selected",
        engine: "ai-sdk:openai",
        model: "gpt-5.5",
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      key: "OPENAI_API_KEY",
      value: "sk-obviously-fake",
      scope: "org",
      defaultModel: { engine: "ai-sdk:openai", model: "gpt-5.5" },
    });
  });

  it("passes through a member's key-only save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          defaultModel: { status: "skipped", reason: "not-allowed" },
        }),
      ),
    );

    await expect(
      saveAgentEngineProviderSettings({
        provider: "anthropic",
        apiKey: "sk-ant-obviously-fake",
        defaultModel: {},
      }),
    ).resolves.toEqual({
      defaultModel: { status: "skipped", reason: "not-allowed" },
    });
  });

  it("treats a missing default-model answer as a failure, not a selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
    );

    await expect(
      saveAgentEngineProviderSettings({
        provider: "anthropic",
        apiKey: "sk-ant-obviously-fake",
        defaultModel: {},
      }),
    ).resolves.toEqual({
      defaultModel: {
        status: "failed",
        error:
          "The key was saved, but the default model could not be confirmed.",
      },
    });
  });

  it("omits defaultModel and returns no outcome when not requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveAgentEngineProviderSettings({
        provider: "anthropic",
        apiKey: "sk-ant-obviously-fake",
      }),
    ).resolves.toEqual({});
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty(
      "defaultModel",
    );
  });
});

describe("setAgentEngineProvider", () => {
  it("throws the server's refusal for a member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error:
              "Only organization owners and admins can change the default model.",
            errorCode: "default_model_admin_required",
          },
          403,
        ),
      ),
    );

    await expect(
      setAgentEngineProvider({ provider: "openai", model: "gpt-5.5" }),
    ).rejects.toThrow(
      "Only organization owners and admins can change the default model.",
    );
  });
});
