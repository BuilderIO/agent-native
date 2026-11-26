import { describe, expect, it } from "vitest";

import { mapSlackUserOAuthResponse } from "./slack-user-oauth.js";

const response = () => ({
  ok: true,
  app_id: "APP_SYNTHETIC",
  team: { id: "TEAM_SYNTHETIC" },
  authed_user: {
    id: "USER_SYNTHETIC",
    token_type: "user",
    access_token: "synthetic-access-token",
    scope: "channels:read",
  },
});

describe("personal authorization input bounds", () => {
  it("rejects excessive response scopes and nonprintable token bytes", () => {
    const excessive = response();
    excessive.authed_user.scope = Array.from(
      { length: 257 },
      (_, i) => `scope${i}`,
    ).join(",");
    expect(() => mapSlackUserOAuthResponse(excessive)).toThrow();
    for (const suffix of ["\0", "\u007f", "\u0001", "\n"]) {
      const invalid = response();
      invalid.authed_user.access_token += suffix;
      expect(() => mapSlackUserOAuthResponse(invalid)).toThrow();
    }
  });

  it("validates the clock for long-lived responses without fabricating expiry", () => {
    for (const now of [NaN, Infinity, 0, -1, 1.5]) {
      expect(() => mapSlackUserOAuthResponse(response(), now)).toThrow();
    }
    expect(mapSlackUserOAuthResponse(response(), 1).bundle).not.toHaveProperty(
      "expiresAt",
    );
  });
});
