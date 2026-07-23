import { describe, expect, it } from "vitest";

import { resolveDesktopUpdateSupport } from "./update-policy.js";

describe("resolveDesktopUpdateSupport", () => {
  it("disables updates in development", () => {
    expect(resolveDesktopUpdateSupport(false, "0.1.150")).toEqual({
      supported: false,
      reason: "Auto-update is disabled in development",
    });
  });

  it("disables updates for the exact Desktop SSO canary version family", () => {
    expect(
      resolveDesktopUpdateSupport(
        true,
        "0.1.150-desktop-sso-canary.30005696742",
      ),
    ).toEqual({
      supported: false,
      reason: "Auto-update is disabled for this Desktop SSO canary build",
    });
  });

  it.each([
    "0.1.150",
    "0.1.150-beta.4",
    "0.1.150-desktop-sso-canary",
    "0.1.150-desktop-sso-canary.not-a-run",
    "0.1.150-other-canary.4",
  ])("preserves normal updater behavior for %s", (version) => {
    expect(resolveDesktopUpdateSupport(true, version)).toEqual({
      supported: true,
    });
  });
});
