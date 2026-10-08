import { describe, expect, it } from "vitest";

import {
  deriveLastTouchAttribution,
  deriveSignupAttribution,
} from "./attribution.js";
import {
  decodeMagicLinkSignupAttribution,
  encodeMagicLinkSignupAttribution,
  MAGIC_LINK_ATTRIBUTION_PARAM,
  readMagicLinkSignupAttribution,
} from "./magic-link-attribution.js";

const SECRET = "test-magic-link-attribution-secret";
const NOW = Date.parse("2026-08-12T16:00:00.000Z");

describe("magic-link attribution handoff", () => {
  it("carries every first- and last-touch property a signup can have", () => {
    const touch = {
      ref: "steve",
      via: "owner_42",
      utm_source: "youtube",
      utm_medium: "video",
      utm_campaign: "launch",
      utm_content: "intro",
      utm_term: "agents",
      gclid: "g-1",
      msclkid: "m-1",
      vector_source: "v-1",
      landing_path: "/",
      landing_referrer: "www.youtube.com",
      site_referrer: "github.com",
      capture_truncated: "1",
    };
    const attribution = {
      ...deriveSignupAttribution({ ...touch, site_landing_path: "/apps" }),
      ...deriveLastTouchAttribution({
        ...touch,
        site_landing_path: "/blog/launch",
        touched_at: "2026-08-12T15:00:00.000Z",
      }),
    };
    expect(Object.keys(attribution)).toHaveLength(34);

    const token = encodeMagicLinkSignupAttribution(
      { attribution },
      SECRET,
      NOW,
    );

    expect(decodeMagicLinkSignupAttribution(token, SECRET, NOW)).toEqual({
      attribution,
    });
  });

  it("round-trips attribution through Better Auth's verification URL", () => {
    const token = encodeMagicLinkSignupAttribution(
      {
        attribution: {
          referral_source: "external",
          utm_campaign: "launch + % & 日本語",
        },
        anonymousId: "anon_123",
        sessionId: "session_123",
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
      sessionId: "session_123",
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
