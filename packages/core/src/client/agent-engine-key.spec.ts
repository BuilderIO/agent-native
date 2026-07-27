import { afterEach, describe, expect, it, vi } from "vitest";

import {
  saveAgentEngineApiKey,
  saveAgentEngineProviderSettings,
} from "./agent-engine-key.js";

afterEach(() => {
  vi.restoreAllMocks();
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
});
