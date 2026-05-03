import { afterEach, describe, expect, it, vi } from "vitest";
import { slackAdapter } from "./slack.js";

describe("slackAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("answers Slack URL verification with the raw challenge string", async () => {
    const adapter = slackAdapter();
    const event = {
      context: {
        __rawBody: JSON.stringify({
          type: "url_verification",
          challenge: "qa-challenge",
        }),
      },
    } as any;

    await expect(adapter.handleVerification(event)).resolves.toEqual({
      handled: true,
      response: "qa-challenge",
    });
  });

  it("does not bold-wrap bare URLs", () => {
    const formatted = slackAdapter().formatAgentResponse(
      "**https://slides.agent-native.com/deck/deck-qa**",
    );

    expect(formatted.text).toBe(
      "<https://slides.agent-native.com/deck/deck-qa>",
    );
  });

  it("aborts hung Slack delivery requests", async () => {
    vi.useFakeTimers();
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    let deliverySignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("assistant.threads.setStatus")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true })));
        }
        deliverySignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          init?.signal?.addEventListener("abort", () => {
            resolve(new Response(JSON.stringify({ ok: true })));
          });
        });
      }),
    );

    const delivery = slackAdapter().sendResponse(
      { text: "done", platformContext: {} },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "make a deck",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await delivery;

    expect(deliverySignal?.aborted).toBe(true);
  });
});
