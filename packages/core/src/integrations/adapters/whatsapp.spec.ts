import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  header: undefined as string | undefined,
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    // The adapter reads the raw body via h3.readRawBody and caches it on
    // event.context.__rawBody. Return the cached string (set per test).
    readRawBody: vi.fn(async (event: any) => event.context.__rawBody),
    getQuery: vi.fn(() => hoisted.query),
    getHeader: vi.fn(() => hoisted.header),
  };
});

import { whatsappAdapter } from "./whatsapp.js";

/** Event whose raw body is the given JSON string (already stringified). */
function eventWithRaw(raw: string | undefined, method = "POST"): any {
  return { context: { __rawBody: raw }, node: { req: { method } } };
}

/** A well-formed WhatsApp Cloud API text-message webhook payload. */
function textWebhook(overrides: Record<string, any> = {}) {
  return {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                phone_number_id: "PNID",
                display_phone_number: "+15550000000",
              },
              contacts: [{ profile: { name: "Grace" } }],
              messages: [
                {
                  id: "wamid.1",
                  type: "text",
                  from: "15551234567",
                  timestamp: "1700000000",
                  text: { body: "ship it" },
                  ...overrides.message,
                },
              ],
            },
          },
        ],
      },
    ],
    ...overrides.top,
  };
}

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hoisted.query = {};
  hoisted.header = undefined;
  process.env.NODE_ENV = originalNodeEnv;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS;
});

describe("whatsappAdapter parseIncomingMessage", () => {
  it("normalizes a valid text message", async () => {
    const adapter = whatsappAdapter();
    const msg = await adapter.parseIncomingMessage(
      eventWithRaw(JSON.stringify(textWebhook())),
    );

    expect(msg).toMatchObject({
      platform: "whatsapp",
      externalThreadId: "phone:PNID:user:15551234567",
      text: "ship it",
      senderName: "Grace",
      senderId: "15551234567",
      replyRef: "wamid.1",
      timestamp: 1700000000 * 1000,
    });
    expect(msg?.platformContext).toMatchObject({
      phoneNumberId: "PNID",
      displayPhoneNumber: "+15550000000",
      messageId: "wamid.1",
      from: "15551234567",
      timestamp: "1700000000",
    });
    expect(adapter.getLegacyExternalThreadIds?.(msg!)).toEqual(["15551234567"]);
  });

  it("returns null for malformed JSON", async () => {
    const msg = await whatsappAdapter().parseIncomingMessage(
      eventWithRaw("{not json"),
    );
    expect(msg).toBeNull();
  });

  it("returns null when the body is empty", async () => {
    const msg = await whatsappAdapter().parseIncomingMessage(eventWithRaw(""));
    expect(msg).toBeNull();
  });

  it("returns null when the change field is not 'messages' (e.g. statuses)", async () => {
    const payload = textWebhook();
    payload.entry[0].changes[0].field = "statuses";
    const msg = await whatsappAdapter().parseIncomingMessage(
      eventWithRaw(JSON.stringify(payload)),
    );
    expect(msg).toBeNull();
  });

  it("returns null for non-text message types (e.g. image)", async () => {
    const msg = await whatsappAdapter().parseIncomingMessage(
      eventWithRaw(
        JSON.stringify(
          textWebhook({ message: { type: "image", text: undefined } }),
        ),
      ),
    );
    expect(msg).toBeNull();
  });

  it("returns null when the text body is whitespace only", async () => {
    const msg = await whatsappAdapter().parseIncomingMessage(
      eventWithRaw(
        JSON.stringify(textWebhook({ message: { text: { body: "   " } } })),
      ),
    );
    expect(msg).toBeNull();
  });

  it("returns null when there is no entry (delivery callback shape)", async () => {
    const msg = await whatsappAdapter().parseIncomingMessage(
      eventWithRaw(JSON.stringify({ object: "whatsapp_business_account" })),
    );
    expect(msg).toBeNull();
  });

  it("trims surrounding whitespace from the message text", async () => {
    const msg = await whatsappAdapter().parseIncomingMessage(
      eventWithRaw(
        JSON.stringify(textWebhook({ message: { text: { body: "  hi  " } } })),
      ),
    );
    expect(msg?.text).toBe("hi");
  });
});

describe("whatsappAdapter getStatus", () => {
  it("requires the app secret in addition to delivery credentials", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "example-access-token";
    process.env.WHATSAPP_VERIFY_TOKEN = "example-verify-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "example-phone-id";

    const status = await whatsappAdapter().getStatus();

    expect(status.configured).toBe(false);
    expect(status.details).toMatchObject({
      hasAccessToken: true,
      hasVerifyToken: true,
      hasPhoneNumberId: true,
      hasAppSecret: false,
    });
    expect(status.error).toContain("WHATSAPP_APP_SECRET");
  });

  it("reports configured when all four required secrets are present", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "example-access-token";
    process.env.WHATSAPP_VERIFY_TOKEN = "example-verify-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "example-phone-id";
    process.env.WHATSAPP_APP_SECRET = "example-app-secret";

    const status = await whatsappAdapter().getStatus();

    expect(status.configured).toBe(true);
    expect(status.details).toMatchObject({ hasAppSecret: true });
    expect(status.error).toBeUndefined();
  });
});

describe("whatsappAdapter handleVerification (GET challenge handshake)", () => {
  function getEvent(): any {
    return { context: {}, node: { req: { method: "GET" } } };
  }

  it("echoes the challenge when the verify token matches", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "my-verify-token";
    hoisted.query = {
      "hub.mode": "subscribe",
      "hub.verify_token": "my-verify-token",
      "hub.challenge": "challenge-123",
    };

    await expect(
      whatsappAdapter().handleVerification(getEvent()),
    ).resolves.toEqual({ handled: true, response: "challenge-123" });
  });

  it("does not handle when the verify token mismatches (same length)", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "my-verify-token";
    hoisted.query = {
      "hub.mode": "subscribe",
      "hub.verify_token": "XX-verify-token",
      "hub.challenge": "challenge-123",
    };

    await expect(
      whatsappAdapter().handleVerification(getEvent()),
    ).resolves.toEqual({ handled: false });
  });

  it("does not handle when the verify token length differs", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "my-verify-token";
    hoisted.query = {
      "hub.mode": "subscribe",
      "hub.verify_token": "short",
      "hub.challenge": "challenge-123",
    };

    await expect(
      whatsappAdapter().handleVerification(getEvent()),
    ).resolves.toEqual({ handled: false });
  });

  it("does not handle when mode is not 'subscribe'", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "my-verify-token";
    hoisted.query = {
      "hub.mode": "unsubscribe",
      "hub.verify_token": "my-verify-token",
      "hub.challenge": "challenge-123",
    };

    await expect(
      whatsappAdapter().handleVerification(getEvent()),
    ).resolves.toEqual({ handled: false });
  });

  it("pre-caches the raw body once on POST so the consume-once stream is not double-read", async () => {
    // POST must NOT take the GET challenge path even when verify-token query
    // params are present — it pre-reads the raw body and returns handled:false.
    process.env.WHATSAPP_VERIFY_TOKEN = "my-verify-token";
    hoisted.query = {
      "hub.mode": "subscribe",
      "hub.verify_token": "my-verify-token",
      "hub.challenge": "challenge-123",
    };
    const h3 = await import("h3");
    const readRawBody = h3.readRawBody as unknown as ReturnType<typeof vi.fn>;
    // Event has no cached body yet; the source wrapper reads via h3 once and
    // caches the bytes on event.context.__rawBody (M3 consume-once guard).
    const event: any = { context: {}, node: { req: { method: "POST" } } };
    readRawBody.mockResolvedValueOnce('{"entry":[]}');

    const result = await whatsappAdapter().handleVerification(event);

    expect(result).toEqual({ handled: false });
    expect(event.context.__rawBody).toBe('{"entry":[]}');

    // A second read (e.g. from verifyWebhook/parseIncomingMessage) is served
    // from the cache and never re-streams the request.
    readRawBody.mockClear();
    await whatsappAdapter().parseIncomingMessage(event);
    expect(readRawBody).not.toHaveBeenCalled();
  });
});

describe("whatsappAdapter verifyWebhook (security)", () => {
  it("refuses webhooks in production when no app secret is set (fail closed)", async () => {
    process.env.NODE_ENV = "production";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";

    await expect(whatsappAdapter().verifyWebhook({} as any)).resolves.toBe(
      false,
    );
  });

  it("accepts unverified webhooks in production when explicitly opted in", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS = "1";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";

    await expect(whatsappAdapter().verifyWebhook({} as any)).resolves.toBe(
      true,
    );
  });

  it("in dev without a secret, accepts only when the access token is configured", async () => {
    process.env.NODE_ENV = "development";

    await expect(whatsappAdapter().verifyWebhook({} as any)).resolves.toBe(
      false,
    );

    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    await expect(whatsappAdapter().verifyWebhook({} as any)).resolves.toBe(
      true,
    );
  });

  it("accepts a request whose HMAC-SHA256 signature matches the app secret", async () => {
    process.env.WHATSAPP_APP_SECRET = "shh";
    const raw = JSON.stringify(textWebhook());
    const crypto = await import("node:crypto");
    const expected =
      "sha256=" + crypto.createHmac("sha256", "shh").update(raw).digest("hex");
    hoisted.header = expected;

    await expect(
      whatsappAdapter().verifyWebhook(eventWithRaw(raw)),
    ).resolves.toBe(true);
  });

  it("rejects a request whose signature does not match", async () => {
    process.env.WHATSAPP_APP_SECRET = "shh";
    const raw = JSON.stringify(textWebhook());
    // signature computed over a DIFFERENT body — must fail
    const crypto = await import("node:crypto");
    hoisted.header =
      "sha256=" +
      crypto.createHmac("sha256", "shh").update("tampered").digest("hex");

    await expect(
      whatsappAdapter().verifyWebhook(eventWithRaw(raw)),
    ).resolves.toBe(false);
  });

  it("rejects when the signature header is absent", async () => {
    process.env.WHATSAPP_APP_SECRET = "shh";
    hoisted.header = undefined;

    await expect(
      whatsappAdapter().verifyWebhook(eventWithRaw("{}")),
    ).resolves.toBe(false);
  });

  it("verifies over the exact raw bytes, not a JSON-equivalent re-serialization (M2)", async () => {
    // Meta signs the exact bytes it sent. A signature minted over a byte
    // variant (extra whitespace, same JSON value) must be rejected — the
    // adapter must NOT re-stringify a parsed body before comparing.
    process.env.WHATSAPP_APP_SECRET = "shh";
    const sentBytes = '{"a":1,"b":2}';
    const reserializedBytes = '{ "a": 1, "b": 2 }'; // same value, different bytes
    const crypto = await import("node:crypto");
    hoisted.header =
      "sha256=" +
      crypto
        .createHmac("sha256", "shh")
        .update(reserializedBytes)
        .digest("hex");

    await expect(
      whatsappAdapter().verifyWebhook(eventWithRaw(sentBytes)),
    ).resolves.toBe(false);
  });
});

describe("whatsappAdapter sendResponse", () => {
  it("does nothing when access token or phone number id is missing", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    // no phone number id
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await whatsappAdapter().sendResponse(
      { text: "hi", platformContext: {} },
      {
        platform: "whatsapp",
        externalThreadId: "15551234567",
        text: "q",
        senderId: "15551234567",
        timestamp: 1,
        platformContext: {},
      },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts a text message to the recipient via the Graph API", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID";
    const calls: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({
          url,
          headers: init?.headers,
          body: JSON.parse(String(init?.body)),
        });
        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      }),
    );

    await whatsappAdapter().sendResponse(
      { text: "hello there", platformContext: {} },
      {
        platform: "whatsapp",
        externalThreadId: "15551234567",
        text: "q",
        senderId: "15551234567",
        timestamp: 1,
        platformContext: {},
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v25.0/PNID/messages");
    expect((calls[0].headers as any).Authorization).toBe("Bearer tok");
    expect(calls[0].body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "15551234567",
      type: "text",
      text: { body: "hello there" },
    });
  });

  it("quotes the inbound wamid for a contextual reply", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "example-access-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID";
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      }),
    );

    await whatsappAdapter().sendResponse(
      { text: "contextual reply", platformContext: {} },
      {
        platform: "whatsapp",
        externalThreadId: "phone:PNID:user:15551234567",
        text: "question",
        senderId: "15551234567",
        replyRef: "wamid.example",
        timestamp: 1,
        platformContext: { phoneNumberId: "PNID" },
      },
    );

    expect(body.context).toEqual({ message_id: "wamid.example" });
  });

  it("splits replies longer than the WhatsApp length limit", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID";
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      }),
    );

    const long = `${"x".repeat(4096)} ${"y".repeat(50)}`;
    await whatsappAdapter().sendResponse(
      { text: long, platformContext: {} },
      {
        platform: "whatsapp",
        externalThreadId: "15551234567",
        text: "q",
        senderId: "15551234567",
        timestamp: 1,
        platformContext: {},
      },
    );

    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.every((b) => b.text.body.length <= 4096)).toBe(true);
  });
});

describe("whatsappAdapter formatAgentResponse", () => {
  it("passes text through unchanged (WhatsApp uses plain text)", () => {
    const out = whatsappAdapter().formatAgentResponse("**bold** _italic_");
    expect(out.text).toBe("**bold** _italic_");
    expect(out.platformContext).toEqual({});
  });
});
