import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMock = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("../analytics.js", () => analyticsMock);

import {
  clearAnalyticsSessionId,
  getOrCreateAnalyticsSessionId,
  setAnalyticsSessionId,
} from "../analytics-session.js";
import { buildSafePromptMetadata } from "./prompt-metadata.js";
import { trackTurnSubmitted } from "./turn-submitted-telemetry.js";
import {
  acceptedPromptForMetadata,
  TURN_SUBMITTED_EVENT,
} from "./turn-submitted.js";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("sessionStorage", createMemoryStorage());
});

afterEach(() => {
  clearAnalyticsSessionId();
  vi.unstubAllGlobals();
});

describe("safe prompt metadata", () => {
  it("uses only the latest user message, excluding system and tool content", () => {
    expect(
      acceptedPromptForMetadata({
        initiator: "user",
        messages: [
          {
            role: "system",
            content: [{ type: "text", text: "private system instructions" }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "Earlier user request" }],
          },
          {
            role: "tool",
            content: [{ type: "text", text: "private tool output" }],
          },
          {
            role: "user",
            content: [
              { type: "image" },
              { type: "text", text: "Current accepted request" },
            ],
          },
        ],
      }),
    ).toBe("Current accepted request");
    expect(
      acceptedPromptForMetadata({
        initiator: "system",
        prompt: "internal continuation text",
        messages: [
          { role: "user", content: [{ type: "text", text: "old user ask" }] },
        ],
      }),
    ).toBeUndefined();
  });

  it("returns only coarse metadata and a keyed hash, never prompt text", async () => {
    const prompt = "Create a workspace for reviewing launch plans";
    setAnalyticsSessionId("session-one");

    const metadata = await buildSafePromptMetadata(prompt);

    expect(metadata).toMatchObject({
      prompt_category: "create",
      prompt_length_bucket: "1-50",
      prompt_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(metadata)).not.toContain(prompt);
  });

  it("keeps matching hashes within one analytics session and rotates them across sessions", async () => {
    setAnalyticsSessionId("session-one");
    expect(getOrCreateAnalyticsSessionId() === "session-one").toBe(true);
    const first = await buildSafePromptMetadata("Summarize the current plan");
    const firstStoredKey = JSON.parse(
      sessionStorage.getItem("agent-native.prompt_hash_key") ?? "{}",
    ).key;
    const sameSession = await buildSafePromptMetadata(
      "Summarize the current plan",
    );
    const nextStoredKey = JSON.parse(
      sessionStorage.getItem("agent-native.prompt_hash_key") ?? "{}",
    ).key;

    setAnalyticsSessionId("session-two");
    expect(getOrCreateAnalyticsSessionId() === "session-two").toBe(true);
    const nextSession = await buildSafePromptMetadata(
      "Summarize the current plan",
    );

    expect(firstStoredKey === nextStoredKey).toBe(true);
    expect(first.prompt_hash).toBe(sameSession.prompt_hash);
    expect(nextSession.prompt_hash).not.toBe(first.prompt_hash);
  });

  it("emits safe metadata on the shared turn event without the raw prompt", async () => {
    const send = vi.fn();
    const prompt = "Improve the opening slide";
    setAnalyticsSessionId("session-turn");

    await trackTurnSubmitted(
      {
        turnId: "turn-1",
        surface: "chat",
        initiator: "user",
        promptForMetadata: prompt,
      },
      send,
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(
      1,
      TURN_SUBMITTED_EVENT,
      expect.objectContaining({
        prompt_category: "edit",
        prompt_length_bucket: "1-50",
      }),
    );
    expect(send.mock.calls[0]?.[1]).not.toHaveProperty("prompt_hash");
    expect(send).toHaveBeenNthCalledWith(
      2,
      "agent_prompt_hash_recorded",
      expect.objectContaining({
        turn_id: "turn-1",
        prompt_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain(prompt);
  });

  it("does not classify or hash system continuations", async () => {
    const send = vi.fn();

    await trackTurnSubmitted(
      {
        turnId: "turn-system",
        surface: "chat",
        initiator: "system",
        promptForMetadata: "Internal continuation instructions",
      },
      send,
    );

    expect(send).toHaveBeenCalledWith(
      TURN_SUBMITTED_EVENT,
      expect.not.objectContaining({
        prompt_category: expect.anything(),
        prompt_length_bucket: expect.anything(),
        prompt_hash: expect.anything(),
      }),
    );
  });

  it("omits the hash when browser storage is unavailable", async () => {
    setAnalyticsSessionId("session-storage-unavailable");
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("Unavailable", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Unavailable", "SecurityError");
      },
    });

    const metadata = await buildSafePromptMetadata("Find duplicate records");

    expect(metadata).toEqual({
      prompt_category: "analyze",
      prompt_length_bucket: "1-50",
    });
  });

  it("omits the hash when Web Crypto is unavailable", async () => {
    setAnalyticsSessionId("session-crypto-unavailable");
    vi.stubGlobal("crypto", undefined);

    const metadata = await buildSafePromptMetadata("Create a project outline");

    expect(metadata).toEqual({
      prompt_category: "create",
      prompt_length_bucket: "1-50",
    });
  });
});
