import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  header: undefined as string | undefined,
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    // verifyWebhook reads the Telegram secret header through h3.getHeader.
    getHeader: vi.fn(() => hoisted.header),
  };
});

// telegram.ts reads the request body via the core readBody helper; the parser
// uses the body cached on event.context.__rawBody when present, so tests set
// that directly and never need the real h3 stream.
vi.mock("../../server/h3-helpers.js", () => ({
  readBody: vi.fn(async (event: any) => event.context.__rawBody ?? {}),
}));

import { telegramAdapter } from "./telegram.js";

/** Event whose pre-cached body is the given Telegram update object. */
function eventWithBody(body: unknown): any {
  return { context: { __rawBody: body } };
}

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hoisted.header = undefined;
  process.env.NODE_ENV = originalNodeEnv;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS;
});

describe("telegramAdapter parseIncomingMessage", () => {
  function update(extra: Record<string, unknown> = {}) {
    return {
      message: {
        message_id: 42,
        date: 1700000000,
        chat: { id: 555, type: "private" },
        from: { id: 777, first_name: "Ada", username: "ada_l" },
        text: "ship it",
        ...extra,
      },
    };
  }

  it("normalizes a valid text message", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(update()),
    );

    expect(msg).toMatchObject({
      platform: "telegram",
      externalThreadId: "chat:555",
      text: "ship it",
      senderName: "Ada",
      senderId: "777",
      replyRef: "42",
      timestamp: 1700000000 * 1000,
    });
    expect(msg?.platformContext).toMatchObject({
      chatId: 555,
      chatType: "private",
      messageId: 42,
      rawText: "ship it",
      fromId: 777,
      fromUsername: "ada_l",
    });
  });

  it("uses the Telegram topic as canonical thread identity", async () => {
    const adapter = telegramAdapter();
    const msg = await adapter.parseIncomingMessage(
      eventWithBody(update({ message_thread_id: 99 })),
    );

    expect(msg).toMatchObject({
      externalThreadId: "chat:555:thread:99",
      threadRef: "99",
      replyRef: "42",
      platformContext: { messageThreadId: 99 },
    });
    expect(adapter.getLegacyExternalThreadIds?.(msg!)).toEqual(["555"]);
  });

  it("joins first and last name for senderName", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(
        update({ from: { id: 1, first_name: "Ada", last_name: "Lovelace" } }),
      ),
    );
    expect(msg?.senderName).toBe("Ada Lovelace");
  });

  it("handles edited_message updates", async () => {
    const body = {
      edited_message: {
        message_id: 9,
        date: 1700000001,
        chat: { id: 1, type: "group" },
        from: { id: 2, first_name: "Edited" },
        text: "fixed typo",
      },
    };
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(body),
    );
    expect(msg?.text).toBe("fixed typo");
    expect(msg?.platformContext.messageId).toBe(9);
  });

  it("maps /start to a friendly greeting", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(update({ text: "/start" })),
    );
    expect(msg?.text).toBe("Hello! I'm ready to chat.");
    // rawText preserves the original command.
    expect(msg?.platformContext.rawText).toBe("/start");
  });

  it("strips a leading bot command prefix", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(update({ text: "/ask what's the weather" })),
    );
    expect(msg?.text).toBe("what's the weather");
    expect(msg?.platformContext.rawText).toBe("/ask what's the weather");
  });

  it("falls back to the raw text when stripping a command leaves nothing", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(update({ text: "/help" })),
    );
    expect(msg?.text).toBe("/help");
  });

  it("returns null for a non-message update (no message/edited_message)", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody({ callback_query: { id: "abc" } }),
    );
    expect(msg).toBeNull();
  });

  it("returns null for a non-text message (e.g. photo only)", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(update({ text: undefined, photo: [{ file_id: "x" }] })),
    );
    expect(msg).toBeNull();
  });

  it("returns null for a whitespace-only message", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(update({ text: "   \n  " })),
    );
    expect(msg).toBeNull();
  });

  it("returns null when the body is empty", async () => {
    const msg = await telegramAdapter().parseIncomingMessage(
      eventWithBody(null),
    );
    expect(msg).toBeNull();
  });
});

describe("telegramAdapter getStatus", () => {
  it("requires both the bot token and webhook secret", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, result: { username: "example_bot" } }),
          ),
      ),
    );

    const status = await telegramAdapter().getStatus();

    expect(status.configured).toBe(false);
    expect(status.details).toMatchObject({
      hasToken: true,
      hasWebhookSecret: false,
      botUsername: "example_bot",
    });
    expect(status.error).toContain("TELEGRAM_WEBHOOK_SECRET");
  });

  it("reports configured only when the webhook secret is present", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-webhook-secret-example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    );

    const status = await telegramAdapter().getStatus();

    expect(status.configured).toBe(true);
    expect(status.details).toMatchObject({
      hasToken: true,
      hasWebhookSecret: true,
    });
    expect(status.error).toBeUndefined();
  });
});

describe("telegramAdapter handleVerification", () => {
  it("caches the raw body and never short-circuits", async () => {
    const event: any = { context: {} };
    const readBody = await import("../../server/h3-helpers.js");
    (readBody.readBody as any).mockResolvedValueOnce({
      message: { text: "hi" },
    });

    const result = await telegramAdapter().handleVerification(event);

    expect(result).toEqual({ handled: false });
    expect(event.context.__rawBody).toEqual({ message: { text: "hi" } });
  });

  it("does not re-read a body that is already cached", async () => {
    const event: any = { context: { __rawBody: { message: { text: "x" } } } };
    const readBody = await import("../../server/h3-helpers.js");
    (readBody.readBody as any).mockClear();

    await telegramAdapter().handleVerification(event);

    expect(readBody.readBody as any).not.toHaveBeenCalled();
  });
});

describe("telegramAdapter verifyWebhook (security)", () => {
  it("refuses webhooks in production when no secret is set (fail closed)", async () => {
    process.env.NODE_ENV = "production";
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";

    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      false,
    );
  });

  it("accepts unverified webhooks in production when explicitly opted in", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS = "1";
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";

    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      true,
    );
  });

  it("in dev without a secret, accepts only when the bot token is configured", async () => {
    process.env.NODE_ENV = "development";

    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      false,
    );

    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      true,
    );
  });

  it("with a secret set, accepts only a matching header (timing-safe)", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t-token";
    hoisted.header = "s3cr3t-token";

    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      true,
    );
  });

  it("with a secret set, rejects a same-length mismatched header (timingSafeEqual returns false)", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t-token";
    hoisted.header = "wrong--token"; // same 12-char length, different content

    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      false,
    );
  });

  it("with a secret set, rejects a different-length header (timingSafeEqual throws, caught)", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t-token";
    hoisted.header = "wrong-token"; // 11 chars vs 12 — length mismatch path

    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      false,
    );
  });

  it("with a secret set, rejects when no header is present", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t-token";
    hoisted.header = undefined;

    await expect(telegramAdapter().verifyWebhook({} as any)).resolves.toBe(
      false,
    );
  });
});

describe("telegramAdapter formatAgentResponse", () => {
  it("downconverts **double** asterisk bold to Telegram's *single* bold", () => {
    const out = telegramAdapter().formatAgentResponse(
      "**Important** and **also this**",
    );
    expect(out.text).toBe("*Important* and *also this*");
    expect(out.platformContext.parse_mode).toBe("Markdown");
  });

  it("rewrites bold spanning multiple lines", () => {
    const out = telegramAdapter().formatAgentResponse("**line one\nline two**");
    expect(out.text).toBe("*line one\nline two*");
  });
});

describe("telegramAdapter sendResponse", () => {
  it("does nothing without a bot token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await telegramAdapter().sendResponse(
      { text: "hi", platformContext: {} },
      {
        platform: "telegram",
        externalThreadId: "555",
        text: "q",
        timestamp: 1,
        platformContext: { chatId: 555 },
      },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the message with Markdown parse_mode to the chat", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const calls: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await telegramAdapter().sendResponse(
      { text: "*hi*", platformContext: {} },
      {
        platform: "telegram",
        externalThreadId: "555",
        text: "q",
        timestamp: 1,
        platformContext: { chatId: 555 },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/bot123:abc/sendMessage");
    expect(calls[0].body).toMatchObject({
      chat_id: 555,
      text: "*hi*",
      parse_mode: "Markdown",
    });
  });

  it("preserves topic and contextual reply references", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "example-token";
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await telegramAdapter().sendResponse(
      { text: "reply", platformContext: {} },
      {
        platform: "telegram",
        externalThreadId: "chat:555:thread:99",
        text: "question",
        threadRef: "99",
        replyRef: "42",
        timestamp: 1,
        platformContext: { chatId: 555 },
      },
    );

    expect(body).toMatchObject({
      chat_id: 555,
      message_thread_id: 99,
      reply_parameters: {
        message_id: 42,
        allow_sending_without_reply: true,
      },
    });
  });

  it("retries without Markdown when Telegram reports a parse error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const bodies: any[] = [];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        call += 1;
        const ok = call > 1; // first attempt fails with a parse error
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok,
              description: ok ? undefined : "Bad Request: can't parse entities",
            }),
          ),
        );
      }),
    );

    await telegramAdapter().sendResponse(
      { text: "*broken", platformContext: {} },
      {
        platform: "telegram",
        externalThreadId: "555",
        text: "q",
        timestamp: 1,
        platformContext: { chatId: 555 },
      },
    );

    expect(bodies).toHaveLength(2);
    expect(bodies[0].parse_mode).toBe("Markdown");
    // retry strips parse_mode entirely
    expect(bodies[1].parse_mode).toBeUndefined();
    expect(bodies[1].text).toBe("*broken");
  });

  it("splits messages longer than the Telegram length limit", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    const long = `${"a".repeat(4096)} ${"b".repeat(20)}`;
    await telegramAdapter().sendResponse(
      { text: long, platformContext: {} },
      {
        platform: "telegram",
        externalThreadId: "555",
        text: "q",
        timestamp: 1,
        platformContext: { chatId: 555 },
      },
    );

    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.every((b) => b.text.length <= 4096)).toBe(true);
  });
});

describe("telegramAdapter sendMessageToTarget", () => {
  it("posts to the target destination and includes a thread id when given", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await telegramAdapter().sendMessageToTarget!(
      { text: "ping", platformContext: {} },
      { destination: "999", threadRef: "12" },
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      chat_id: "999",
      text: "ping",
      message_thread_id: "12",
    });
  });

  it("omits message_thread_id when no threadRef is given", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await telegramAdapter().sendMessageToTarget!(
      { text: "ping", platformContext: {} },
      { destination: "999" },
    );

    expect(body).not.toHaveProperty("message_thread_id");
  });

  it("throws when the Telegram API reports failure", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, description: "chat not found" }),
          ),
        ),
      ),
    );

    await expect(
      telegramAdapter().sendMessageToTarget!(
        { text: "ping", platformContext: {} },
        { destination: "999" },
      ),
    ).rejects.toThrow("chat not found");
  });
});
