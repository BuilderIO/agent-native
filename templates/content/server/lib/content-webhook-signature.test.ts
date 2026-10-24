import { describe, expect, it } from "vitest";

import {
  contentWebhookHeaders,
  generateContentWebhookSecret,
  signContentWebhook,
  verifyContentWebhook,
} from "./content-webhook-signature.js";

// The reference example from the Standard Webhooks specification.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TIMESTAMP = 1614265330;
const BODY = '{"test": 2432232314}';

describe("content webhook signatures", () => {
  it("matches the Standard Webhooks reference signature", () => {
    expect(
      signContentWebhook({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        body: BODY,
      }),
    ).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("verifies its own headers and rejects tampering, other keys, and stale timestamps", () => {
    const secret = generateContentWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    const headers = contentWebhookHeaders({
      secret,
      id: "evt_1",
      timestamp: TIMESTAMP,
      body: BODY,
    });
    const at = (nowSeconds: number, overrides: Record<string, string> = {}) =>
      verifyContentWebhook({
        secret,
        headers: { ...headers, ...overrides },
        body: BODY,
        nowSeconds,
      });
    expect(at(TIMESTAMP + 60)).toBe(true);
    expect(at(TIMESTAMP + 301)).toBe(false);
    expect(at(TIMESTAMP - 301)).toBe(false);
    expect(at(TIMESTAMP, { "webhook-id": "evt_2" })).toBe(false);
    expect(
      at(TIMESTAMP, {
        "webhook-signature": `v1,bm90IGl0 ${headers["webhook-signature"]}`,
      }),
    ).toBe(true);
    expect(
      verifyContentWebhook({
        secret: generateContentWebhookSecret(),
        headers,
        body: BODY,
        nowSeconds: TIMESTAMP,
      }),
    ).toBe(false);
    expect(
      verifyContentWebhook({
        secret,
        headers,
        body: `${BODY} `,
        nowSeconds: TIMESTAMP,
      }),
    ).toBe(false);
  });
});
