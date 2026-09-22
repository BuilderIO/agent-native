import { describe, it, expect } from "vitest";

import {
  addSignupAttributionHeader,
  decodeSignupAttributionContext,
  deriveReferralSource,
  deriveSignupAttribution,
  encodeSignupAttributionContext,
  parseCookieHeader,
  SIGNUP_ATTRIBUTION_HEADER_NAME,
  readAnalyticsAnonymousId,
  readFirstTouchAttribution,
  signupAttributionContextFromCookieHeader,
  signupAttributionContextFromHeaders,
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

describe("readAnalyticsAnonymousId", () => {
  it("reads a valid browser identity handoff without changing attribution", () => {
    expect(readAnalyticsAnonymousId("an_aid=anon_123-abc")).toBe(
      "anon_123-abc",
    );
    expect(readFirstTouchAttribution("an_aid=anon_123-abc")).toBeNull();
  });

  it("rejects absent, malformed, and duplicate identity cookies", () => {
    expect(readAnalyticsAnonymousId(undefined)).toBeUndefined();
    expect(readAnalyticsAnonymousId("an_aid=has%20space")).toBeUndefined();
    expect(readAnalyticsAnonymousId("an_aid=first; an_aid=second")).toBe(
      "first",
    );
    expect(
      readAnalyticsAnonymousId(`an_aid=${"a".repeat(129)}`),
    ).toBeUndefined();
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
    expect(deriveReferralSource({ landing_path: "/plans/abc" })).toBe(
      "plan_share",
    );
    expect(deriveReferralSource({ landing_path: "/recaps/abc" })).toBe(
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

describe("signupAttributionContextFromCookieHeader", () => {
  it("captures attribution and the anonymous identity handoff together", () => {
    const ft = {
      ref: "clip_share",
      via: "owner_9",
      landing_path: "/share/c",
      utm_campaign: "launch",
    };

    expect(
      signupAttributionContextFromCookieHeader(
        `${ftCookie(ft)}; an_aid=anon_123-abc`,
      ),
    ).toEqual({
      attribution: {
        referral_source: "clip_share",
        referrer_user: "owner_9",
        referral_campaign: "launch",
        utm_campaign: "launch",
        first_touch_path: "/share/c",
      },
      anonymousId: "anon_123-abc",
    });
  });

  it("keeps malformed browser identity input out of the context", () => {
    expect(
      signupAttributionContextFromCookieHeader("an_aid=has%20space"),
    ).toBeUndefined();
  });

  // A browser that ran our client script always has `an_ft`, so no cookies at
  // all means no browser. Reporting that as "direct" is what made an
  // unattributable server-side row indistinguishable from a real visitor who
  // arrived with no campaign — and it is why 94% of `better-auth` signups read
  // as direct traffic nobody could trace.
  it("reports no browser context rather than direct attribution", () => {
    expect(signupAttributionContextFromCookieHeader(null)).toBeUndefined();
    expect(signupAttributionContextFromCookieHeader("")).toBeUndefined();
    expect(
      signupAttributionContextFromCookieHeader("other=1; session=abc"),
    ).toBeUndefined();
  });

  it("still reports direct for a real visitor carrying no campaign", () => {
    expect(
      signupAttributionContextFromCookieHeader(
        `${ftCookie({ landing_path: "/" })}; an_aid=anon_1`,
      ),
    ).toEqual({
      attribution: { referral_source: "direct", first_touch_path: "/" },
      anonymousId: "anon_1",
    });
  });
});

describe("signup attribution request handoff", () => {
  it("round-trips through the explicit Better Auth header", () => {
    const context = {
      attribution: { referral_source: "clip_share", utm_campaign: "launch" },
      anonymousId: "anon_signup_1",
    };
    const headers = addSignupAttributionHeader(
      { cookie: "an_aid=wrong-client-value" },
      context,
    );

    expect(signupAttributionContextFromHeaders(headers)).toEqual(context);
    expect(
      decodeSignupAttributionContext(encodeSignupAttributionContext(context)),
    ).toEqual(context);
  });

  it("distinguishes malformed handoffs from direct attribution", () => {
    expect(decodeSignupAttributionContext("not-json")).toBeUndefined();
    expect(signupAttributionContextFromHeaders(new Headers())).toBeUndefined();
  });

  // The handoff header is unsigned and outranks the request cookie in the
  // user-create hook, so an inbound copy lets a stranger write the
  // `anonymous_id` and campaign onto somebody else's signup row.
  it("drops an inbound handoff when there is nothing of ours to stamp", () => {
    const spoofed = addSignupAttributionHeader(
      {
        [SIGNUP_ATTRIBUTION_HEADER_NAME]: encodeSignupAttributionContext({
          attribution: { utm_campaign: "attacker" },
          anonymousId: "anon_attacker",
        }),
      },
      undefined,
    );

    expect(spoofed.get(SIGNUP_ATTRIBUTION_HEADER_NAME)).toBeNull();
    expect(signupAttributionContextFromHeaders(spoofed)).toBeUndefined();
  });
});
