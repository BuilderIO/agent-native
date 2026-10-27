import { describe, expect, it } from "vitest";

import {
  applyMcpSignupAttribution,
  decodeMcpSignupAttribution,
  encodeMcpSignupAttribution,
  readMcpSignupContextFromCookieHeader,
  serializeMcpSignupAttributionCookie,
} from "./mcp-signup-attribution.js";

const SECRET = "test-mcp-signup-attribution-secret";
const NOW = Date.parse("2026-10-26T12:00:00.000Z");

describe("MCP signup attribution", () => {
  it("signs short-lived vendor and browser context", () => {
    const token = encodeMcpSignupAttribution(
      {
        vendor: "openai",
        anonymousId: "anon_mcp_1",
        sessionId: "session_mcp_1",
        firstTouchPathAllowed: true,
      },
      SECRET,
      NOW,
    );

    expect(decodeMcpSignupAttribution(token, SECRET, NOW)).toEqual({
      vendor: "openai",
      anonymousId: "anon_mcp_1",
      sessionId: "session_mcp_1",
      firstTouchPathAllowed: true,
    });
    expect(
      decodeMcpSignupAttribution(token, SECRET, NOW + 31 * 60 * 1000),
    ).toBeNull();
  });

  it("rejects a tampered token and a different server secret", () => {
    const token = encodeMcpSignupAttribution(
      { vendor: "claude", sessionId: "session_mcp_2" },
      SECRET,
      NOW,
    )!;
    const [data, signature] = token.split(".");

    expect(
      decodeMcpSignupAttribution(`${data}x.${signature}`, SECRET, NOW),
    ).toBeNull();
    expect(
      decodeMcpSignupAttribution(token, `${SECRET}-other`, NOW),
    ).toBeNull();
  });

  it("keeps signed flow facts while honoring a targeting opt-out", () => {
    const cookie = serializeMcpSignupAttributionCookie(
      {
        vendor: "openai",
        sessionId: "session_mcp_3",
        firstTouchPathAllowed: true,
      },
      SECRET,
      true,
      NOW,
    )!;
    const value = cookie.split("=", 2)[1].split(";", 1)[0];

    expect(
      readMcpSignupContextFromCookieHeader(
        `an_consent=1.p1.t1; an_mcp_signup=${value}`,
        SECRET,
        NOW,
      ),
    ).toEqual({
      vendor: "openai",
      sessionId: "session_mcp_3",
      firstTouchPathAllowed: true,
    });
    expect(
      readMcpSignupContextFromCookieHeader(
        `an_consent=1.p1.t0; an_mcp_signup=${value}`,
        SECRET,
        NOW,
      ),
    ).toEqual({
      vendor: "openai",
      sessionId: "session_mcp_3",
      firstTouchPathAllowed: false,
    });
  });

  it("drops the anonymous id when performance consent is revoked", () => {
    const cookie = serializeMcpSignupAttributionCookie(
      {
        vendor: "openai",
        anonymousId: "anon_mcp_4",
        sessionId: "session_mcp_4",
        firstTouchPathAllowed: true,
      },
      SECRET,
      true,
      NOW,
    )!;
    const value = cookie.split("=", 2)[1].split(";", 1)[0];

    expect(
      readMcpSignupContextFromCookieHeader(
        `an_consent=1.p0.t1; an_mcp_signup=${value}`,
        SECRET,
        NOW,
      ),
    ).toEqual({
      vendor: "openai",
      sessionId: "session_mcp_4",
      firstTouchPathAllowed: true,
    });
  });

  it("fills a missing first-touch path and keeps an existing one", () => {
    const mcpSignup = { vendor: "openai", firstTouchPathAllowed: true };

    expect(applyMcpSignupAttribution(undefined, mcpSignup)).toEqual({
      first_touch_path: "/mcp/oauth/authorize",
      $mcp_vendor_client: "openai",
    });
    expect(
      applyMcpSignupAttribution(
        { first_touch_path: "/docs/actions" },
        mcpSignup,
      ),
    ).toEqual({
      first_touch_path: "/docs/actions",
      $mcp_vendor_client: "openai",
    });
    expect(
      applyMcpSignupAttribution(undefined, {
        vendor: "openai",
        firstTouchPathAllowed: false,
      }),
    ).toEqual({ $mcp_vendor_client: "openai" });
  });
});
