import { describe, it, expect } from "vitest";
import {
  deriveReferralSource,
  deriveSignupAttribution,
  parseCookieHeader,
  readFirstTouchAttribution,
  signupAttributionFromCookieHeader,
  type FirstTouchAttribution,
} from "./attribution.js";

/** Build an `an_ft` cookie header from a first-touch object (matches client). */
function ftCookie(ft: FirstTouchAttribution): string {
  return `an_ft=${encodeURIComponent(JSON.stringify(ft))}`;
}

describe("parseCookieHeader", () => {
  it("returns empty for missing/blank input", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });

  it("parses multiple cookies and trims whitespace", () => {
    expect(parseCookieHeader("a=1; b=2 ;  c=3")).toEqual({
      a: "1",
      b: "2",
      c: "3",
    });
  });

  it("keeps `=` inside values and ignores malformed pairs", () => {
    expect(parseCookieHeader("token=ab=cd; junk; x=1")).toEqual({
      token: "ab=cd",
      x: "1",
    });
  });

  it("first write wins for duplicate names", () => {
    expect(parseCookieHeader("a=first; a=second")).toEqual({ a: "first" });
  });
});

describe("readFirstTouchAttribution", () => {
  it("decodes a well-formed an_ft cookie", () => {
    const ft = { ref: "clip_share", via: "user_123", landing_path: "/share/x" };
    const parsed = readFirstTouchAttribution(ftCookie(ft));
    expect(parsed).toEqual(ft);
  });

  it("returns null when an_ft is absent", () => {
    expect(readFirstTouchAttribution("other=1; foo=bar")).toBeNull();
  });

  it("returns null for malformed JSON (safe empty)", () => {
    expect(readFirstTouchAttribution("an_ft=not-json")).toBeNull();
    expect(readFirstTouchAttribution("an_ft=%7Bbroken")).toBeNull();
  });

  it("returns null for a JSON array (not an object)", () => {
    expect(
      readFirstTouchAttribution(`an_ft=${encodeURIComponent("[1,2,3]")}`),
    ).toBeNull();
  });

  it("drops non-string / unknown fields and truncates long values", () => {
    const raw = JSON.stringify({
      ref: "x".repeat(200),
      via: 42,
      extra: "ignored",
      landing_path: "/p/abc",
    });
    const parsed = readFirstTouchAttribution(
      `an_ft=${encodeURIComponent(raw)}`,
    );
    expect(parsed?.ref).toHaveLength(120);
    expect(parsed?.via).toBeUndefined();
    expect((parsed as Record<string, unknown>)?.extra).toBeUndefined();
    expect(parsed?.landing_path).toBe("/p/abc");
  });
});

describe("deriveReferralSource", () => {
  it("explicit ref wins over everything else", () => {
    expect(
      deriveReferralSource({
        ref: "newsletter",
        landing_path: "/share/x",
        landing_referrer: "twitter.com",
      }),
    ).toBe("newsletter");
  });

  it("/share/ path derives clip_share", () => {
    expect(deriveReferralSource({ landing_path: "/share/abc123" })).toBe(
      "clip_share",
    );
  });

  it("plan public paths derive plan_share", () => {
    expect(deriveReferralSource({ landing_path: "/p/abc" })).toBe("plan_share");
    expect(deriveReferralSource({ landing_path: "/plan/abc" })).toBe(
      "plan_share",
    );
    expect(deriveReferralSource({ landing_path: "/share-plan/abc" })).toBe(
      "plan_share",
    );
  });

  it("external referrer derives external", () => {
    expect(
      deriveReferralSource({
        landing_path: "/",
        landing_referrer: "news.ycombinator.com",
      }),
    ).toBe("external");
  });

  it("nothing derives direct", () => {
    expect(deriveReferralSource(null)).toBe("direct");
    expect(deriveReferralSource({})).toBe("direct");
    expect(
      deriveReferralSource({ landing_path: "/", landing_referrer: "" }),
    ).toBe("direct");
  });
});

describe("deriveSignupAttribution", () => {
  it("passes through via and utm fields with derived medium/campaign", () => {
    const ft: FirstTouchAttribution = {
      ref: "plan_share",
      via: "owner_42",
      utm_source: "twitter",
      utm_medium: "social",
      utm_campaign: "launch",
      utm_content: "card-a",
      utm_term: "agents",
      landing_path: "/plan/xyz",
      landing_referrer: "t.co",
    };
    expect(deriveSignupAttribution(ft)).toEqual({
      referral_source: "plan_share",
      referrer_user: "owner_42",
      referral_medium: "social",
      referral_campaign: "launch",
      utm_source: "twitter",
      utm_medium: "social",
      utm_campaign: "launch",
      utm_content: "card-a",
      utm_term: "agents",
      first_touch_path: "/plan/xyz",
      landing_referrer: "t.co",
    });
  });

  it("defaults to direct with no input and omits undefined fields", () => {
    expect(deriveSignupAttribution(null)).toEqual({
      referral_source: "direct",
    });
  });

  it("derives clip_share from a /share/ landing and keeps the path", () => {
    expect(deriveSignupAttribution({ landing_path: "/share/clip-1" })).toEqual({
      referral_source: "clip_share",
      first_touch_path: "/share/clip-1",
    });
  });
});

describe("signupAttributionFromCookieHeader", () => {
  it("end-to-end derives from a cookie header", () => {
    const ft = {
      via: "owner_9",
      landing_path: "/share/c",
      utm_medium: "email",
    };
    expect(signupAttributionFromCookieHeader(ftCookie(ft))).toEqual({
      referral_source: "clip_share",
      referrer_user: "owner_9",
      referral_medium: "email",
      utm_medium: "email",
      first_touch_path: "/share/c",
    });
  });

  it("malformed cookie falls back to direct", () => {
    expect(signupAttributionFromCookieHeader("an_ft=%E0%A4%A")).toEqual({
      referral_source: "direct",
    });
    expect(signupAttributionFromCookieHeader(undefined)).toEqual({
      referral_source: "direct",
    });
  });
});
