import { describe, expect, it } from "vitest";

import {
  decodeMagicLinkSignupAttribution,
  encodeMagicLinkSignupAttribution,
  MAGIC_LINK_ATTRIBUTION_PARAM,
  readMagicLinkSignupAttribution,
} from "./magic-link-attribution.js";

const SECRET = "test-magic-link-attribution-secret";
const NOW = Date.parse("2026-08-12T16:00:00.000Z");

describe("magic-link attribution handoff", () => {
  it("round-trips attribution through Better Auth's verification URL", () => {
    const token = encodeMagicLinkSignupAttribution(
      {
        attribution: {
          referral_source: "external",
          utm_campaign: "launch + % & 日本語",
        },
        anonymousId: "anon_123",
      },
      SECRET,
      NOW,
    );
    expect(token).toBeTruthy();

    const callback = new URL(
      "https://app.example.com/_agent-native/auth/magic-link/new-user?return=%2F",
    );
    callback.searchParams.set(MAGIC_LINK_ATTRIBUTION_PARAM, token!);
    const verification = new URL(
      "https://app.example.com/_agent-native/auth/ba/magic-link/verify?token=mail-token",
    );
    verification.searchParams.set("newUserCallbackURL", callback.toString());

    expect(
      readMagicLinkSignupAttribution(verification.toString(), SECRET, NOW),
    ).toEqual({
      attribution: {
        referral_source: "external",
        utm_campaign: "launch + % & 日本語",
      },
      anonymousId: "anon_123",
    });
  });

  it("rejects a tampered or expired handoff", () => {
    const token = encodeMagicLinkSignupAttribution(
      { anonymousId: "anon_123" },
      SECRET,
      NOW,
    )!;
    const [payload, signature] = token.split(".");

    expect(
      decodeMagicLinkSignupAttribution(`${payload}x.${signature}`, SECRET, NOW),
    ).toBeNull();
    expect(
      decodeMagicLinkSignupAttribution(token, SECRET, NOW + 11 * 60 * 1000),
    ).toBeNull();
  });

  it("does not mint a token without attribution context", () => {
    expect(encodeMagicLinkSignupAttribution({}, SECRET, NOW)).toBeUndefined();
  });

  it("only extracts from Better Auth's magic-link verification route", () => {
    const token = encodeMagicLinkSignupAttribution(
      { anonymousId: "anon_123" },
      SECRET,
      NOW,
    )!;
    const callback = new URL("https://app.example.com/_agent-native/new-user");
    callback.searchParams.set(MAGIC_LINK_ATTRIBUTION_PARAM, token);
    const nonVerificationUrl = new URL(
      "https://app.example.com/_agent-native/auth/register",
    );
    nonVerificationUrl.searchParams.set(
      "newUserCallbackURL",
      callback.toString(),
    );

    expect(
      readMagicLinkSignupAttribution(
        nonVerificationUrl.toString(),
        SECRET,
        NOW,
      ),
    ).toBeUndefined();
  });
});
