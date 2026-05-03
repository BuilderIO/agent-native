import { afterEach, describe, expect, it, vi } from "vitest";
import { slackAdapter } from "./slack.js";

const originalNodeEnv = process.env.NODE_ENV;

describe("slackAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_ALLOWED_TEAM_IDS;
    delete process.env.SLACK_ALLOWED_API_APP_IDS;
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

  it("rejects Slack events in production when the team allowlist is missing", async () => {
    process.env.NODE_ENV = "production";

    await expect(
      slackAdapter().parseIncomingMessage(slackEvent({ team_id: "T999" })),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: "Slack workspace allowlist is not configured",
    });
  });

  it("rejects Slack events in production when the team allowlist is empty", async () => {
    process.env.NODE_ENV = "production";
    process.env.SLACK_ALLOWED_TEAM_IDS = " , ";

    await expect(
      slackAdapter().parseIncomingMessage(slackEvent({ team_id: "T999" })),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: "Slack workspace allowlist is not configured",
    });
  });

  it("keeps accepting Slack events without a team allowlist outside production", async () => {
    process.env.NODE_ENV = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const parsed = await slackAdapter().parseIncomingMessage(
      slackEvent({ team_id: "T999" }),
    );

    expect(parsed).toMatchObject({
      platform: "slack",
      externalThreadId: "C123:123.456",
      text: "ship it",
      senderId: "U123",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("SLACK_ALLOWED_TEAM_IDS not set"),
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

  it("keeps generated Slack section blocks within Block Kit limits", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryBodies: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("chat.postMessage")) {
          deliveryBodies.push(JSON.parse(String(init?.body ?? "{}")));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await slackAdapter().sendResponse(
      { text: "a".repeat(3605), platformContext: {} },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "ask starter",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    const sectionBlocks = deliveryBodies[0].blocks.filter(
      (block: any) => block.type === "section",
    );
    expect(sectionBlocks).toHaveLength(2);
    expect(
      sectionBlocks.every((block: any) => block.text.text.length <= 3000),
    ).toBe(true);
  });

  it("splits Slack section blocks by UTF-8 bytes, not JS character length", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryBodies: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("chat.postMessage")) {
          deliveryBodies.push(JSON.parse(String(init?.body ?? "{}")));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await slackAdapter().sendResponse(
      { text: `${"a".repeat(2994)}🗄️`, platformContext: {} },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "ask starter",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    const sectionBlocks = deliveryBodies[0].blocks.filter(
      (block: any) => block.type === "section",
    );
    expect(sectionBlocks.length).toBeGreaterThan(1);
    expect(
      sectionBlocks.every(
        (block: any) => Buffer.byteLength(block.text.text, "utf8") <= 3000,
      ),
    ).toBe(true);
  });
});

function slackEvent(overrides: Record<string, unknown> = {}) {
  return {
    context: {
      __rawBody: JSON.stringify({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event_id: "Ev123",
        event: {
          type: "message",
          channel: "C123",
          user: "U123",
          text: "<@BOT> ship it",
          ts: "123.456",
        },
        ...overrides,
      }),
    },
  } as any;
}
