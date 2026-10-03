import { describe, expect, it } from "vitest";

import {
  hasAttributionSource,
  isFirstPartyHost,
  shareLandingSource,
} from "./attribution-source.js";

describe("hasAttributionSource", () => {
  it("counts tags, share links, and outside referrers", () => {
    expect(hasAttributionSource({ ref: "steve" })).toBe(true);
    expect(hasAttributionSource({ utm_medium: "video" })).toBe(true);
    expect(hasAttributionSource({ gclid: "click-1" })).toBe(true);
    expect(hasAttributionSource({ landing_path: "/share/clip" })).toBe(true);
    expect(hasAttributionSource({ landing_referrer: "github.com" })).toBe(true);
    expect(hasAttributionSource({ site_referrer: "www.youtube.com" })).toBe(
      true,
    );
  });

  it("does not count our own hosts, Google sign-in, or blanks", () => {
    expect(hasAttributionSource(null)).toBe(false);
    expect(hasAttributionSource({ landing_path: "/" })).toBe(false);
    expect(hasAttributionSource({ ref: "  " })).toBe(false);
    expect(
      hasAttributionSource({ landing_referrer: "mail.agent-native.com" }),
    ).toBe(false);
    expect(hasAttributionSource({ site_referrer: "agent-native.com" })).toBe(
      false,
    );
    expect(
      hasAttributionSource({ landing_referrer: "Accounts.Google.com" }),
    ).toBe(false);
  });
});

describe("isFirstPartyHost", () => {
  it("matches agent-native.com and its subdomains only", () => {
    expect(isFirstPartyHost("agent-native.com")).toBe(true);
    expect(isFirstPartyHost("plan.agent-native.com.")).toBe(true);
    expect(isFirstPartyHost("notagent-native.com")).toBe(false);
    expect(isFirstPartyHost(undefined)).toBe(false);
  });
});

describe("shareLandingSource", () => {
  it("names clip and plan share landings", () => {
    expect(shareLandingSource("/share/abc")).toBe("clip_share");
    expect(shareLandingSource("/recaps/abc")).toBe("plan_share");
    expect(shareLandingSource("/inbox")).toBeUndefined();
  });
});
