import { describe, expect, it } from "vitest";

import {
  resolveDesktopUpdateSupport,
  resolveDesktopUserDataDirectoryName,
} from "./update-policy.js";

describe("resolveDesktopUpdateSupport", () => {
  it("disables updates in development", () => {
    expect(resolveDesktopUpdateSupport(false, "0.1.150")).toEqual({
      supported: false,
      reason: "Auto-update is unavailable for local development builds",
    });
  });

  it("disables updates for packaged local builds", () => {
    expect(resolveDesktopUpdateSupport(true, "0.1.150", "dev")).toEqual({
      supported: false,
      reason: "Auto-update is unavailable for local packaged builds",
    });
  });

  it("disables updates for explicitly isolated build channels", () => {
    expect(resolveDesktopUpdateSupport(true, "0.1.150", "canary")).toEqual({
      supported: false,
      reason: "Auto-update is unavailable for this Desktop build channel",
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

  it("isolates development and Desktop SSO canary profiles from stable Desktop", () => {
    expect(resolveDesktopUserDataDirectoryName(false, "0.1.150")).toBe(
      "Agent Native Dev",
    );
    expect(
      resolveDesktopUserDataDirectoryName(
        true,
        "0.1.150-desktop-sso-canary.19",
      ),
    ).toBe("Agent Native SSO Canary");
    expect(resolveDesktopUserDataDirectoryName(true, "0.1.150")).toBeNull();
    expect(
      resolveDesktopUserDataDirectoryName(
        true,
        "0.1.150-desktop-sso-canary.not-a-run",
      ),
    ).toBeNull();
  });
});
