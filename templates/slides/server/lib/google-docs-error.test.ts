import { describe, expect, it } from "vitest";

import { formatGoogleOAuthError } from "./google-docs-error";

describe("formatGoogleOAuthError", () => {
  it("turns common Google OAuth setup failures into actionable messages", () => {
    expect(
      formatGoogleOAuthError(new Error("redirect_uri_mismatch")),
    ).toContain("current Slides callback URL");
    expect(formatGoogleOAuthError(new Error("access_denied"))).toContain(
      "Connect Google again",
    );
    expect(formatGoogleOAuthError(new Error("invalid_grant"))).toContain(
      "connection expired",
    );
    expect(
      formatGoogleOAuthError(new Error("access blocked: unverified app")),
    ).toContain("unverified");
  });

  it("keeps configured-credential guidance intact", () => {
    expect(
      formatGoogleOAuthError(
        new Error(
          "Google OAuth is not configured. Save GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in settings.",
        ),
      ),
    ).toContain("GOOGLE_CLIENT_ID");
  });
});
