import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseSlackEventsEnvelope,
  verifySlackEventSignature,
} from "./slack-events.js";

describe("Brain Slack events", () => {
  it("accepts a fresh correctly signed event and rejects replay or tampering", () => {
    const rawBody = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: { type: "message", channel: "C123", ts: "1770919200.000100" },
    });
    const timestamp = "1770919200";
    const signingSecret = "test-signing-secret";
    const signature = `v0=${crypto
      .createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    expect(
      verifySlackEventSignature({
        rawBody,
        timestamp,
        signature,
        signingSecret,
        nowMs: 1_770_919_300_000,
      }),
    ).toBe(true);
    expect(
      verifySlackEventSignature({
        rawBody: `${rawBody} `,
        timestamp,
        signature,
        signingSecret,
        nowMs: 1_770_919_300_000,
      }),
    ).toBe(false);
    expect(
      verifySlackEventSignature({
        rawBody,
        timestamp,
        signature,
        signingSecret,
        nowMs: 1_770_919_600_001,
      }),
    ).toBe(false);
  });

  it("parses only a JSON envelope and leaves provider payload handling to the verified path", () => {
    expect(parseSlackEventsEnvelope("not json")).toBeNull();
    expect(
      parseSlackEventsEnvelope(
        JSON.stringify({
          type: "url_verification",
          team_id: "T123",
          challenge: "challenge-token",
        }),
      ),
    ).toMatchObject({ type: "url_verification", team_id: "T123" });
  });
});
